import * as vscode from 'vscode';
import { AIProviderManager } from '../providers/AIProviderManager';

const TAB_SYSTEM_PROMPT = `You are a code completion engine. Complete the code at the cursor position.

RULES:
- Return ONLY the completion text, nothing else
- No explanations, no markdown, no code fences
- Complete naturally based on the context
- Multi-line completions are OK (max 10 lines)
- Match the code style and conventions of the file
- Include proper types for TypeScript
- Auto-import if needed (add import at the top)`;

interface CachedCompletion {
    value: string;
    createdAt: number;
}

export class TabCompletionProvider implements vscode.InlineCompletionItemProvider {
    private readonly cache = new Map<string, CachedCompletion>();
    private readonly maxCacheSize = 100;
    private pendingRequest: AbortController | null = null;
    private lastTriggerTime = 0;
    private totalCompletions = 0;
    private totalTokens = 0;

    constructor(private readonly aiProvider: AIProviderManager) {}

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
        const config = vscode.workspace.getConfiguration('giuseCoder.tabCompletion');
        const isEnabled = config.get<boolean>('enabled', true);
        if (!isEnabled) {
            return undefined;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document.uri.toString() !== document.uri.toString()) {
            return undefined;
        }

        const prefix = document.lineAt(position.line).text.slice(0, position.character);
        if (!this.shouldTrigger(prefix)) {
            return undefined;
        }

        const debounceMs = config.get<number>('debounceMs', 300);
        const elapsed = Date.now() - this.lastTriggerTime;
        if (elapsed < debounceMs) {
            await this.sleep(debounceMs - elapsed, token);
        }

        if (token.isCancellationRequested) {
            return undefined;
        }

        this.lastTriggerTime = Date.now();

        const cacheKey = this.buildCacheKey(document, position);
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.createdAt < 3 * 60 * 1000) {
            return this.toCompletionItems(cached.value, position);
        }

        if (this.pendingRequest) {
            this.pendingRequest.abort();
        }

        const abortController = new AbortController();
        this.pendingRequest = abortController;

        const subscription = token.onCancellationRequested(() => {
            abortController.abort();
        });

        try {
            const model = config.get<string>('model', 'claude-haiku-4-5-20251001');
            const maxLines = Math.min(20, Math.max(1, config.get<number>('maxLines', 8)));
            const maxContextLines = Math.min(200, Math.max(10, config.get<number>('maxContextLines', 50)));

            const prompt = this.buildPrompt(document, position, maxContextLines, maxLines);
            const maxTokens = Math.max(80, maxLines * 64);

            const response = await this.aiProvider.requestTabCompletion({
                prompt,
                model,
                systemPrompt: TAB_SYSTEM_PROMPT,
                maxTokens,
                signal: abortController.signal
            });

            let completion = this.normalizeCompletion(response.text, document, position, maxLines);
            if (!completion) {
                return undefined;
            }

            completion = this.removeDuplicateSuffix(completion, document, position);
            if (!completion.trim()) {
                return undefined;
            }

            this.cacheSet(cacheKey, completion);
            this.totalCompletions += 1;
            this.totalTokens += response.outputTokens;

            return this.toCompletionItems(completion, position);
        } catch (error: unknown) {
            if (this.isAbort(error, token)) {
                return undefined;
            }

            const message = error instanceof Error ? error.message : 'Unknown completion error.';
            console.error('[GiuseCoder] Tab completion failed:', message);
            return undefined;
        } finally {
            subscription.dispose();
            if (this.pendingRequest === abortController) {
                this.pendingRequest = null;
            }
        }
    }

    public getStats(): { totalCompletions: number; totalTokens: number } {
        return {
            totalCompletions: this.totalCompletions,
            totalTokens: this.totalTokens
        };
    }

    public clearCache(): void {
        this.cache.clear();
    }

    private shouldTrigger(prefix: string): boolean {
        const trimmed = prefix.trim();
        if (!trimmed) {
            return false;
        }

        const lastChar = prefix[prefix.length - 1] ?? '';
        if (/[,;{}()[\]]/.test(lastChar)) {
            return false;
        }

        return true;
    }

    private buildPrompt(
        document: vscode.TextDocument,
        position: vscode.Position,
        maxContextLines: number,
        maxLines: number
    ): string {
        const startLine = Math.max(0, position.line - maxContextLines);
        const endLine = Math.min(document.lineCount - 1, position.line + maxContextLines);
        const beforeLines: string[] = [];
        const afterLines: string[] = [];

        for (let line = startLine; line <= endLine; line += 1) {
            const text = document.lineAt(line).text;
            if (line < position.line) {
                beforeLines.push(text);
            } else if (line === position.line) {
                beforeLines.push(text.slice(0, position.character));
                afterLines.push(text.slice(position.character));
            } else {
                afterLines.push(text);
            }
        }

        const importCandidates = this.extractImports(document);
        const language = document.languageId || 'plaintext';
        const relativePath = vscode.workspace.asRelativePath(document.uri, false);

        return [
            `FILE: ${relativePath}`,
            `LANGUAGE: ${language}`,
            `MAX_COMPLETION_LINES: ${maxLines}`,
            importCandidates.length ? `IMPORTS:\n${importCandidates.join('\n')}` : 'IMPORTS: (none)',
            'CONTEXT_BEFORE_CURSOR:',
            beforeLines.join('\n'),
            'CURSOR',
            'CONTEXT_AFTER_CURSOR:',
            afterLines.join('\n'),
            'Return only code continuation after CURSOR.'
        ].join('\n\n');
    }

    private extractImports(document: vscode.TextDocument): string[] {
        const imports: string[] = [];
        const maxScan = Math.min(document.lineCount - 1, 120);

        for (let i = 0; i <= maxScan; i += 1) {
            const line = document.lineAt(i).text.trim();
            if (!line) {
                continue;
            }

            if (/^(import|from\s+['"]|const\s+\w+\s*=\s*require\(|using\s+)/.test(line)) {
                imports.push(line);
            }

            if (imports.length >= 24) {
                break;
            }
        }

        return imports;
    }

    private normalizeCompletion(
        raw: string,
        document: vscode.TextDocument,
        position: vscode.Position,
        maxLines: number
    ): string {
        const normalized = raw
            .replace(/^```[\w-]*\s*/g, '')
            .replace(/```$/g, '')
            .replace(/^\s*Completion:\s*/i, '');

        const lines = normalized.split('\n');
        const clipped = lines.slice(0, maxLines).join('\n');

        const lineSuffix = document.lineAt(position.line).text.slice(position.character);
        if (lineSuffix.trim() && clipped.trim() === lineSuffix.trim()) {
            return '';
        }

        return clipped;
    }

    private removeDuplicateSuffix(completion: string, document: vscode.TextDocument, position: vscode.Position): string {
        const suffix = document.lineAt(position.line).text.slice(position.character);
        if (!suffix) {
            return completion;
        }

        if (completion.endsWith(suffix)) {
            return completion.slice(0, completion.length - suffix.length);
        }

        return completion;
    }

    private toCompletionItems(completion: string, position: vscode.Position): vscode.InlineCompletionItem[] {
        const range = new vscode.Range(position, position);
        return [new vscode.InlineCompletionItem(completion, range)];
    }

    private buildCacheKey(document: vscode.TextDocument, position: vscode.Position): string {
        const lineText = document.lineAt(position.line).text;
        const prefix = lineText.slice(0, position.character);
        const suffix = lineText.slice(position.character);
        const uri = document.uri.toString();
        return `${uri}:${position.line}:${position.character}:${prefix}::${suffix}`;
    }

    private cacheSet(key: string, value: string): void {
        this.cache.set(key, {
            value,
            createdAt: Date.now()
        });

        if (this.cache.size <= this.maxCacheSize) {
            return;
        }

        const oldest = this.cache.keys().next().value;
        if (oldest) {
            this.cache.delete(oldest);
        }
    }

    private isAbort(error: unknown, token: vscode.CancellationToken): boolean {
        if (token.isCancellationRequested) {
            return true;
        }

        if (!(error instanceof Error)) {
            return false;
        }

        return error.name === 'AbortError' || /aborted/i.test(error.message);
    }

    private async sleep(ms: number, token: vscode.CancellationToken): Promise<void> {
        if (ms <= 0) {
            return;
        }

        await new Promise<void>((resolve) => {
            let finished = false;
            let subscription: vscode.Disposable | null = null;

            const finalize = () => {
                if (finished) {
                    return;
                }

                finished = true;
                if (subscription) {
                    subscription.dispose();
                    subscription = null;
                }
                resolve();
            };

            const timer = setTimeout(() => {
                finalize();
            }, ms);

            subscription = token.onCancellationRequested(() => {
                clearTimeout(timer);
                finalize();
            });

            if (token.isCancellationRequested) {
                clearTimeout(timer);
                finalize();
            }
        });
    }
}
