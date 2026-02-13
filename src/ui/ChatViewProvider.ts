import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SlashCommands } from '../commands/SlashCommands';
import { ContextEngine, ContextTag, ContextTagType } from '../context/ContextEngine';
import { MultiAgentOrchestrator } from '../orchestrator/MultiAgentOrchestrator';
import { PipelineCallbacks, StepProgress, PipelineProgress } from '../orchestrator/types';
import { AIProviderManager, AITextResponse } from '../providers/AIProviderManager';
import { OpenAIProvider } from '../providers/OpenAIProvider';

type ChatRole = 'user' | 'assistant';

interface ChatTurn {
    role: ChatRole;
    content: string;
}

interface IncomingContextTag {
    id: string;
    type: ContextTagType;
    value: string;
    label: string;
}

interface ToolEvent {
    id: string;
    name: string;
    args: string;
    phase: 'start' | 'end';
    status?: 'running' | 'success' | 'error';
    output?: string;
}

const CHAT_SYSTEM_PROMPT = `You are GiuseCoder, an elite software engineering assistant integrated in VS Code.

Principles:
- Provide precise, production-grade answers.
- Prefer actionable solutions and concrete code.
- Keep responses concise but complete.
- Respect existing project style and architecture.
- When providing file edits, explain intent and expected impact first.
- Never output secrets.
- For code, prioritize correctness, safety, and performance.`;

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'giuseCoder.chatView';

    private view: vscode.WebviewView | null = null;
    private currentAbort: AbortController | null = null;
    private history: ChatTurn[] = [];
    private model: string;
    private activeTags: ContextTag[] = [];

    private orchestrator: MultiAgentOrchestrator | null = null;
    private openaiProvider: OpenAIProvider | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly aiProvider: AIProviderManager,
        private readonly contextEngine: ContextEngine,
        private readonly slashCommands: SlashCommands
    ) {
        this.model = vscode.workspace
            .getConfiguration('giuseCoder.chat')
            .get<string>('model', 'claude-sonnet-4-20250514');

        this.context.subscriptions.push(
            vscode.languages.onDidChangeDiagnostics(() => {
                void this.pushContextSummary();
            })
        );
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview'),
                vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
                vscode.Uri.joinPath(this.context.extensionUri, 'node_modules')
            ]
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async (message: unknown) => {
                try {
                    await this.handleWebviewMessage(message);
                } catch (error: unknown) {
                    const messageText = error instanceof Error ? error.message : 'Unknown error';
                    this.post({
                        type: 'chat.error',
                        message: messageText
                    });
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    public clearChat(): void {
        this.history = [];
        this.activeTags = [];
        this.currentAbort?.abort();
        this.currentAbort = null;

        this.post({ type: 'chat.cleared' });
        void this.pushContextSummary();
    }

    public focusInput(prefill = ''): void {
        this.post({
            type: 'chat.focusInput',
            prefill
        });
    }

    public setModel(model: string): void {
        this.model = model;
        this.post({
            type: 'chat.model',
            model
        });
    }

    public getModel(): string {
        return this.model;
    }

    private async handleWebviewMessage(rawMessage: unknown): Promise<void> {
        if (!rawMessage || typeof rawMessage !== 'object') {
            return;
        }

        const message = rawMessage as Record<string, unknown>;
        const type = String(message.type ?? '');

        switch (type) {
            case 'ready': {
                this.post({
                    type: 'chat.bootstrap',
                    model: this.model,
                    usage: this.aiProvider.getSessionUsage()
                });
                await this.pushContextSummary();
                break;
            }
            case 'chat.send': {
                const text = String(message.text ?? '').trim();
                const tags = this.normalizeTags(message.tags);
                const model = String(message.model ?? this.model).trim() || this.model;
                await this.handleSend(text, model, tags);
                break;
            }
            case 'chat.clear': {
                this.clearChat();
                break;
            }
            case 'chat.cancel': {
                this.currentAbort?.abort();
                this.currentAbort = null;
                this.post({
                    type: 'chat.notice',
                    message: 'Streaming cancelled.'
                });
                break;
            }
            case 'chat.setModel': {
                const requestedModel = String(message.model ?? '').trim();
                if (requestedModel) {
                    this.setModel(requestedModel);
                }
                break;
            }
            case 'context.searchMentions': {
                const requestId = String(message.requestId ?? '');
                const query = String(message.query ?? '');
                const items = await this.contextEngine.findMentionCandidates(query);
                this.post({
                    type: 'context.mentionResults',
                    requestId,
                    items
                });
                break;
            }
            case 'context.requestSummary': {
                await this.pushContextSummary();
                break;
            }
            case 'context.setActiveTags': {
                this.activeTags = this.normalizeTags(message.tags);
                await this.pushContextSummary();
                break;
            }
            case 'code.apply': {
                const code = String(message.code ?? '');
                const relativePath = typeof message.path === 'string' ? message.path : undefined;
                await this.applyCode(relativePath, code);
                break;
            }
            case 'code.previewDiff': {
                const code = String(message.code ?? '');
                const relativePath = typeof message.path === 'string' ? message.path : undefined;
                const messageId = String(message.messageId ?? '');
                await this.previewDiff(relativePath, code, messageId);
                break;
            }
            case 'open.external': {
                const target = String(message.url ?? '');
                if (target) {
                    await vscode.env.openExternal(vscode.Uri.parse(target));
                }
                break;
            }
            case 'settings.getStatus': {
                await this.sendSettingsStatus();
                break;
            }
            case 'settings.setAnthropicKey': {
                const key = String(message.key ?? '').trim();
                if (!key) {
                    break;
                }
                try {
                    await this.aiProvider.setApiKey(key);
                    this.post({ type: 'settings.keySaved', provider: 'anthropic' });
                } catch (error: unknown) {
                    this.post({ type: 'settings.keyError', provider: 'anthropic', message: error instanceof Error ? error.message : 'Failed' });
                }
                break;
            }
            case 'settings.setOpenaiKey': {
                const key = String(message.key ?? '').trim();
                if (!key) {
                    break;
                }
                try {
                    if (this.openaiProvider) {
                        await this.openaiProvider.setApiKey(key);
                        this.post({ type: 'settings.keySaved', provider: 'openai' });
                    }
                } catch (error: unknown) {
                    this.post({ type: 'settings.keyError', provider: 'openai', message: error instanceof Error ? error.message : 'Failed' });
                }
                break;
            }
            case 'settings.setConfig': {
                const configKey = String(message.key ?? '');
                const configValue = message.value;
                if (configKey) {
                    const parts = configKey.split('.');
                    const section = parts.slice(0, -1).join('.');
                    const property = parts[parts.length - 1];
                    await vscode.workspace.getConfiguration(section).update(property, configValue, vscode.ConfigurationTarget.Global);
                }
                break;
            }
            case 'settings.setModels': {
                const models = message.models as Record<string, string> | undefined;
                if (models) {
                    const cfg = vscode.workspace.getConfiguration('giuseCoder.orchestrator.models');
                    if (models.haiku) { await cfg.update('haiku', models.haiku, vscode.ConfigurationTarget.Global); }
                    if (models.sonnet) { await cfg.update('sonnet', models.sonnet, vscode.ConfigurationTarget.Global); }
                    if (models.opus) { await cfg.update('opus', models.opus, vscode.ConfigurationTarget.Global); }
                    if (models.codex) { await cfg.update('codex', models.codex, vscode.ConfigurationTarget.Global); }
                    this.post({ type: 'settings.modelsSaved' });
                }
                break;
            }
            default:
                break;
        }
    }

    private async handleSend(text: string, model: string, tags: ContextTag[]): Promise<void> {
        if (!text) {
            return;
        }

        this.activeTags = tags;
        await this.pushContextSummary();

        const slashResolution = await this.slashCommands.resolve(text);
        if (slashResolution.notice) {
            this.post({
                type: 'chat.notice',
                message: slashResolution.notice
            });
        }

        if (slashResolution.action?.type === 'clear') {
            this.clearChat();
            return;
        }

        if (slashResolution.action?.type === 'cost') {
            this.post({
                type: 'chat.costReport',
                usage: this.aiProvider.getSessionUsage()
            });
            return;
        }

        if (slashResolution.action?.type === 'setModel' && slashResolution.action.value) {
            this.setModel(slashResolution.action.value);
            return;
        }

        const finalPrompt = slashResolution.rewrittenPrompt ?? text;
        if (slashResolution.consumed && !slashResolution.rewrittenPrompt) {
            return;
        }

        if (!(await this.aiProvider.hasApiKey())) {
            this.post({
                type: 'chat.error',
                message: 'Anthropic API key not configured. Run "GiuseCoder: Set Anthropic API Key" first.'
            });
            return;
        }

        const orchestratorEnabled = this.orchestrator !== null
            && vscode.workspace.getConfiguration('giuseCoder.orchestrator').get<boolean>('enabled', true)
            && vscode.workspace.getConfiguration('giuseCoder.orchestrator').get<string>('defaultMode', 'orchestrated') === 'orchestrated';

        if (orchestratorEnabled) {
            await this.handleOrchestratedSend(finalPrompt, text, tags);
            return;
        }

        const assistantMessageId = this.makeId('assistant');
        this.currentAbort?.abort();
        const abortController = new AbortController();
        this.currentAbort = abortController;

        this.post({
            type: 'chat.startAssistant',
            message: {
                id: assistantMessageId,
                model,
                timestamp: Date.now(),
                sourcePrompt: text
            }
        });

        const contextToolId = this.makeId('tool-context');
        this.emitToolEvent(assistantMessageId, {
            id: contextToolId,
            name: 'resolve_context',
            args: `${tags.length} tag(s)`,
            phase: 'start',
            status: 'running'
        });

        const contextPayloads = await this.contextEngine.resolveTags(tags);

        this.emitToolEvent(assistantMessageId, {
            id: contextToolId,
            name: 'resolve_context',
            args: `${tags.length} tag(s)`,
            phase: 'end',
            status: 'success',
            output: contextPayloads.length
                ? `Resolved ${contextPayloads.length} context payload(s).`
                : 'No additional context selected.'
        });

        const chatToolId = this.makeId('tool-chat');
        this.emitToolEvent(assistantMessageId, {
            id: chatToolId,
            name: 'chat_completion',
            args: model,
            phase: 'start',
            status: 'running'
        });

        const prompt = this.composePrompt(finalPrompt, contextPayloads);
        let streamedText = '';

        let response: AITextResponse;
        try {
            response = await this.aiProvider.streamChat({
                prompt,
                model,
                systemPrompt: CHAT_SYSTEM_PROMPT,
                maxTokens: vscode.workspace.getConfiguration('giuseCoder.chat').get<number>('maxOutputTokens', 4096),
                temperature: vscode.workspace.getConfiguration('giuseCoder.chat').get<number>('temperature', 0.2),
                signal: abortController.signal,
                onToken: (token) => {
                    streamedText += token;
                    this.post({
                        type: 'chat.streamToken',
                        messageId: assistantMessageId,
                        token
                    });
                }
            });
        } catch (error: unknown) {
            const aborted = this.isAbortError(error) || abortController.signal.aborted;
            this.emitToolEvent(assistantMessageId, {
                id: chatToolId,
                name: 'chat_completion',
                args: model,
                phase: 'end',
                status: 'error',
                output: aborted ? 'Request cancelled by user.' : this.getErrorMessage(error)
            });

            const fallbackText = aborted
                ? streamedText || '*Generation cancelled.*'
                : streamedText || '*Generation failed before producing output.*';

            this.post({
                type: 'chat.complete',
                messageId: assistantMessageId,
                text: fallbackText,
                model,
                cancelled: aborted,
                failed: !aborted,
                usage: this.aiProvider.getSessionUsage(),
                turnUsage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    costUsd: 0
                }
            });

            if (!aborted) {
                this.post({
                    type: 'chat.error',
                    message: this.getErrorMessage(error)
                });
            }

            if (this.currentAbort === abortController) {
                this.currentAbort = null;
            }
            await this.pushContextSummary();
            return;
        }

        this.emitToolEvent(assistantMessageId, {
            id: chatToolId,
            name: 'chat_completion',
            args: model,
            phase: 'end',
            status: 'success',
            output: `input=${response.inputTokens} output=${response.outputTokens}`
        });

        this.history.push({ role: 'user', content: finalPrompt });
        this.history.push({ role: 'assistant', content: response.text });

        if (this.history.length > 24) {
            this.history = this.history.slice(this.history.length - 24);
        }

        this.post({
            type: 'chat.complete',
            messageId: assistantMessageId,
            text: response.text,
            model: response.model,
            cancelled: false,
            failed: false,
            usage: this.aiProvider.getSessionUsage(),
            turnUsage: {
                inputTokens: response.inputTokens,
                outputTokens: response.outputTokens,
                costUsd: response.costUsd
            }
        });

        if (this.currentAbort === abortController) {
            this.currentAbort = null;
        }
        await this.pushContextSummary();
    }

    public setOrchestrator(orchestrator: MultiAgentOrchestrator): void {
        this.orchestrator = orchestrator;
    }

    public setOpenaiProvider(provider: OpenAIProvider): void {
        this.openaiProvider = provider;
    }

    private async sendSettingsStatus(): Promise<void> {
        const anthropicKeySet = await this.aiProvider.hasApiKey();
        const openaiKeySet = this.openaiProvider ? await this.openaiProvider.hasApiKey() : false;

        const orchCfg = vscode.workspace.getConfiguration('giuseCoder.orchestrator');
        const modelsCfg = vscode.workspace.getConfiguration('giuseCoder.orchestrator.models');

        this.post({
            type: 'settings.status',
            anthropicKeySet,
            openaiKeySet,
            orchestrator: {
                enabled: orchCfg.get<boolean>('enabled', true),
                autoReview: orchCfg.get<boolean>('autoReview', true),
                autoFix: orchCfg.get<boolean>('autoFix', true),
                parallelExecution: orchCfg.get<boolean>('parallelExecution', true)
            },
            models: {
                haiku: modelsCfg.get<string>('haiku', 'claude-haiku-4-5-20251001'),
                sonnet: modelsCfg.get<string>('sonnet', 'claude-sonnet-4-20250514'),
                opus: modelsCfg.get<string>('opus', 'claude-opus-4-6'),
                codex: modelsCfg.get<string>('codex', 'gpt-5.3-codex')
            }
        });
    }

    private async handleOrchestratedSend(finalPrompt: string, originalText: string, tags: ContextTag[]): Promise<void> {
        if (!this.orchestrator) {
            return;
        }

        const assistantMessageId = this.makeId('assistant');
        this.currentAbort?.abort();
        const abortController = new AbortController();
        this.currentAbort = abortController;

        this.post({
            type: 'chat.startAssistant',
            message: {
                id: assistantMessageId,
                model: 'orchestrator',
                timestamp: Date.now(),
                sourcePrompt: originalText
            }
        });

        const contextToolId = this.makeId('tool-context');
        this.emitToolEvent(assistantMessageId, {
            id: contextToolId,
            name: 'resolve_context',
            args: `${tags.length} tag(s)`,
            phase: 'start',
            status: 'running'
        });

        const contextPayloads = await this.contextEngine.resolveTags(tags);

        this.emitToolEvent(assistantMessageId, {
            id: contextToolId,
            name: 'resolve_context',
            args: `${tags.length} tag(s)`,
            phase: 'end',
            status: 'success',
            output: contextPayloads.length
                ? `Resolved ${contextPayloads.length} context payload(s).`
                : 'No additional context selected.'
        });

        const contextText = contextPayloads
            .map((p) => `### ${p.title}\nsource: ${p.source}\n\n${p.content}`)
            .join('\n\n---\n\n');

        const activeStepTools = new Map<string, string>();

        const callbacks: PipelineCallbacks = {
            onStepStart: (step: StepProgress) => {
                const toolId = this.makeId(`tool-${step.stepId}`);
                activeStepTools.set(step.stepId, toolId);
                this.emitToolEvent(assistantMessageId, {
                    id: toolId,
                    name: `${step.agent}_${step.stepId}`,
                    args: step.label,
                    phase: 'start',
                    status: 'running'
                });
                this.post({
                    type: 'pipeline.stepStart',
                    messageId: assistantMessageId,
                    step
                });
            },
            onStepComplete: (step: StepProgress) => {
                const toolId = activeStepTools.get(step.stepId) ?? this.makeId(`tool-${step.stepId}`);
                this.emitToolEvent(assistantMessageId, {
                    id: toolId,
                    name: `${step.agent}_${step.stepId}`,
                    args: step.label,
                    phase: 'end',
                    status: 'success',
                    output: `cost=$${(step.costUsd ?? 0).toFixed(4)} duration=${((step.durationMs ?? 0) / 1000).toFixed(1)}s`
                });
                this.post({
                    type: 'pipeline.stepComplete',
                    messageId: assistantMessageId,
                    step
                });
            },
            onStepFailed: (step: StepProgress, error: string) => {
                const toolId = activeStepTools.get(step.stepId) ?? this.makeId(`tool-${step.stepId}`);
                this.emitToolEvent(assistantMessageId, {
                    id: toolId,
                    name: `${step.agent}_${step.stepId}`,
                    args: step.label,
                    phase: 'end',
                    status: 'error',
                    output: error
                });
                this.post({
                    type: 'pipeline.stepFailed',
                    messageId: assistantMessageId,
                    step,
                    error
                });
            },
            onToken: (stepId: string, token: string) => {
                this.post({
                    type: 'chat.streamToken',
                    messageId: assistantMessageId,
                    token
                });
            },
            onProgress: (progress: PipelineProgress) => {
                this.post({
                    type: 'pipeline.progress',
                    messageId: assistantMessageId,
                    progress
                });
            }
        };

        try {
            const result = await this.orchestrator.process({
                userPrompt: finalPrompt,
                context: contextText,
                signal: abortController.signal,
                callbacks
            });

            this.history.push({ role: 'user', content: finalPrompt });
            this.history.push({ role: 'assistant', content: result.text });

            if (this.history.length > 24) {
                this.history = this.history.slice(this.history.length - 24);
            }

            this.post({
                type: 'chat.complete',
                messageId: assistantMessageId,
                text: result.text,
                model: `orchestrator (${result.taskType})`,
                cancelled: false,
                failed: false,
                usage: this.aiProvider.getSessionUsage(),
                turnUsage: {
                    inputTokens: result.results.reduce((s, r) => s + r.inputTokens, 0),
                    outputTokens: result.results.reduce((s, r) => s + r.outputTokens, 0),
                    costUsd: result.totalCostUsd
                }
            });
        } catch (error: unknown) {
            const aborted = this.isAbortError(error) || abortController.signal.aborted;

            this.post({
                type: 'chat.complete',
                messageId: assistantMessageId,
                text: aborted ? '*Orchestration cancelled.*' : '*Orchestration failed.*',
                model: 'orchestrator',
                cancelled: aborted,
                failed: !aborted,
                usage: this.aiProvider.getSessionUsage(),
                turnUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
            });

            if (!aborted) {
                this.post({
                    type: 'chat.error',
                    message: this.getErrorMessage(error)
                });
            }
        } finally {
            if (this.currentAbort === abortController) {
                this.currentAbort = null;
            }
            await this.pushContextSummary();
        }
    }

    private composePrompt(userPrompt: string, contextPayloads: Array<{ type: ContextTagType; title: string; source: string; content: string }>): string {
        const recentTurns = this.history.slice(-12);
        const conversationContext = recentTurns
            .map((turn) => `${turn.role.toUpperCase()}:\n${turn.content}`)
            .join('\n\n');

        const contextSections = contextPayloads
            .map((payload) => `### ${payload.title}\nsource: ${payload.source}\n\n${payload.content}`)
            .join('\n\n---\n\n');

        const sections: string[] = [];

        if (conversationContext) {
            sections.push(`Conversation so far:\n${conversationContext}`);
        }

        if (contextSections) {
            sections.push(`Additional context:\n${contextSections}`);
        }

        sections.push(`User request:\n${userPrompt}`);

        return sections.join('\n\n====================\n\n');
    }

    private normalizeTags(rawTags: unknown): ContextTag[] {
        if (!Array.isArray(rawTags)) {
            return [];
        }

        return rawTags
            .map((tag): ContextTag | null => {
                if (!tag || typeof tag !== 'object') {
                    return null;
                }

                const source = tag as IncomingContextTag;
                if (!source.id || !source.type || !source.value || !source.label) {
                    return null;
                }

                return {
                    id: String(source.id),
                    type: source.type,
                    value: String(source.value),
                    label: String(source.label)
                };
            })
            .filter((tag): tag is ContextTag => Boolean(tag));
    }

    private async applyCode(relativePath: string | undefined, newContent: string): Promise<void> {
        if (!newContent.trim()) {
            this.post({
                type: 'chat.notice',
                message: 'Cannot apply empty code block.'
            });
            return;
        }

        const targetUri = this.resolveTargetUri(relativePath);
        if (!targetUri) {
            this.post({
                type: 'chat.error',
                message: 'No target file available for apply action.'
            });
            return;
        }

        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(newContent, 'utf8'));
        const document = await vscode.workspace.openTextDocument(targetUri);
        await vscode.window.showTextDocument(document, { preview: false });

        this.post({
            type: 'chat.notice',
            message: `Applied changes to ${vscode.workspace.asRelativePath(targetUri, false)}.`
        });
    }

    private async previewDiff(relativePath: string | undefined, newContent: string, messageId: string): Promise<void> {
        if (!newContent.trim()) {
            return;
        }

        const targetUri = this.resolveTargetUri(relativePath);
        if (!targetUri) {
            return;
        }

        let oldContent = '';
        try {
            const bytes = await vscode.workspace.fs.readFile(targetUri);
            oldContent = Buffer.from(bytes).toString('utf8');
        } catch {
            oldContent = '';
        }

        const lines = this.buildInlineDiff(oldContent, newContent);

        this.post({
            type: 'code.diffPreview',
            messageId,
            diff: {
                path: vscode.workspace.asRelativePath(targetUri, false),
                lines
            }
        });
    }

    private buildInlineDiff(oldText: string, newText: string): Array<{ type: 'context' | 'added' | 'removed'; text: string }> {
        const oldLines = oldText.split('\n');
        const newLines = newText.split('\n');

        let start = 0;
        while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
            start += 1;
        }

        let oldEnd = oldLines.length - 1;
        let newEnd = newLines.length - 1;

        while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
            oldEnd -= 1;
            newEnd -= 1;
        }

        const contextHeadStart = Math.max(0, start - 3);
        const contextTailEndOld = Math.min(oldLines.length - 1, oldEnd + 3);
        const contextTailEndNew = Math.min(newLines.length - 1, newEnd + 3);

        const result: Array<{ type: 'context' | 'added' | 'removed'; text: string }> = [];

        for (let i = contextHeadStart; i < start; i += 1) {
            result.push({ type: 'context', text: oldLines[i] });
        }

        for (let i = start; i <= oldEnd; i += 1) {
            if (i >= 0 && i < oldLines.length) {
                result.push({ type: 'removed', text: oldLines[i] });
            }
        }

        for (let i = start; i <= newEnd; i += 1) {
            if (i >= 0 && i < newLines.length) {
                result.push({ type: 'added', text: newLines[i] });
            }
        }

        for (let i = oldEnd + 1, j = newEnd + 1; i <= contextTailEndOld || j <= contextTailEndNew; i += 1, j += 1) {
            const line = oldLines[i] ?? newLines[j];
            if (line !== undefined) {
                result.push({ type: 'context', text: line });
            }
        }

        return result.length ? result : [{ type: 'context', text: 'No differences detected.' }];
    }

    private resolveTargetUri(relativePath: string | undefined): vscode.Uri | null {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            return null;
        }

        if (relativePath) {
            const normalized = relativePath.replace(/^\.\//, '').trim();
            if (path.isAbsolute(normalized)) {
                const asUri = vscode.Uri.file(normalized);
                if (asUri.fsPath.startsWith(workspace.uri.fsPath)) {
                    return asUri;
                }
                return null;
            }

            return vscode.Uri.joinPath(workspace.uri, normalized);
        }

        const active = vscode.window.activeTextEditor?.document.uri;
        if (active && active.fsPath.startsWith(workspace.uri.fsPath)) {
            return active;
        }

        return null;
    }

    private emitToolEvent(messageId: string, event: ToolEvent): void {
        this.post({
            type: 'tool.event',
            messageId,
            event
        });
    }

    private async pushContextSummary(): Promise<void> {
        this.post({
            type: 'context.summary',
            summary: this.contextEngine.buildContextSummary(this.activeTags)
        });
    }

    private post(payload: unknown): void {
        if (!this.view) {
            return;
        }

        void this.view.webview.postMessage(payload);
    }

    private getHtml(webview: vscode.Webview): string {
        const templatePath = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'index.html');
        const template = fs.readFileSync(templatePath.fsPath, 'utf8');

        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'styles.css'));
        const appUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'app.js'));
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'logo.svg'));
        const markdownUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'markdown.js'));
        const welcomeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'components', 'welcome.js')
        );
        const diffUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'components', 'diff.js')
        );
        const toolCallUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'components', 'toolcall.js')
        );
        const codeBlockUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'components', 'codeblock.js')
        );
        const messagesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'components', 'messages.js')
        );
        const inputUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'components', 'input.js')
        );
        const settingsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'components', 'settings.js')
        );
        const codiconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
        );
        const markedUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'marked', 'lib', 'marked.umd.js')
        );
        const prismCoreUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'prismjs', 'prism.js')
        );
        const prismPrismaUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'webview', 'prism-prisma.js')
        );

        const prismLanguages = [
            'clike',
            'javascript',
            'typescript',
            'markup',
            'css',
            'json',
            'bash',
            'sql',
            'python',
            'go',
            'rust',
            'yaml',
            'markdown'
        ];

        const nonce = this.makeNonce();

        const prismLanguageScripts = prismLanguages
            .map((lang) => {
                const scriptUri = webview.asWebviewUri(
                    vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'prismjs', 'components', `prism-${lang}.min.js`)
                );
                return `<script nonce="${nonce}" src="${scriptUri}"></script>`;
            })
            .join('\n');

        return template
            .replaceAll('{{cspSource}}', webview.cspSource)
            .replaceAll('{{nonce}}', nonce)
            .replaceAll('{{stylesUri}}', String(stylesUri))
            .replaceAll('{{appUri}}', String(appUri))
            .replaceAll('{{logoUri}}', String(logoUri))
            .replaceAll('{{codiconUri}}', String(codiconUri))
            .replaceAll('{{markedUri}}', String(markedUri))
            .replaceAll('{{prismCoreUri}}', String(prismCoreUri))
            .replaceAll('{{prismPrismaUri}}', String(prismPrismaUri))
            .replaceAll('{{markdownUri}}', String(markdownUri))
            .replaceAll('{{welcomeUri}}', String(welcomeUri))
            .replaceAll('{{diffUri}}', String(diffUri))
            .replaceAll('{{toolCallUri}}', String(toolCallUri))
            .replaceAll('{{codeBlockUri}}', String(codeBlockUri))
            .replaceAll('{{messagesUri}}', String(messagesUri))
            .replaceAll('{{inputUri}}', String(inputUri))
            .replaceAll('{{settingsUri}}', String(settingsUri))
            .replaceAll('{{prismLanguageScripts}}', prismLanguageScripts);
    }

    private makeNonce(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let nonce = '';
        for (let i = 0; i < 32; i += 1) {
            nonce += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return nonce;
    }

    private makeId(prefix: string): string {
        return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return 'Unknown error';
    }

    private isAbortError(error: unknown): boolean {
        if (!(error instanceof Error)) {
            return false;
        }

        return error.name === 'AbortError' || /aborted|cancelled/i.test(error.message);
    }
}
