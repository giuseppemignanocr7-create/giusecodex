import * as vscode from 'vscode';
import { ContextEngine } from '../context/ContextEngine';
import { AIProviderManager } from '../providers/AIProviderManager';

const INLINE_EDIT_SYSTEM_PROMPT = `You are an inline code editing engine.

Return ONLY the edited code block, with no explanation and no markdown fences.
Keep the same language and style as the original file.
Preserve behavior unless the user explicitly asks to change behavior.
When improving code, prioritize correctness, readability, and minimal safe edits.`;

export class InlineEditProvider {
    constructor(
        private readonly aiProvider: AIProviderManager,
        private readonly contextEngine: ContextEngine
    ) {}

    public async runInlineEdit(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            void vscode.window.showWarningMessage('Open a file before using inline edit.');
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            void vscode.window.showWarningMessage('Select a code block first, then run GiuseCoder Inline Edit.');
            return;
        }

        if (!(await this.aiProvider.hasApiKey())) {
            void vscode.window.showErrorMessage('Anthropic API key missing. Run "GiuseCoder: Set Anthropic API Key" first.');
            return;
        }

        const instruction = await vscode.window.showInputBox({
            title: 'GiuseCoder Inline Edit',
            prompt: 'Describe how the selected code should be changed',
            placeHolder: 'e.g. Add validation and improve error handling',
            ignoreFocusOut: true,
            validateInput: (value: string): string | undefined => {
                if (!value.trim()) {
                    return 'Instruction is required.';
                }
                return undefined;
            }
        });

        if (!instruction) {
            return;
        }

        const selectedCode = editor.document.getText(selection);
        const filePath = vscode.workspace.asRelativePath(editor.document.uri, false);
        const language = editor.document.languageId;
        const contextSnippet = this.extractSurroundingContext(editor.document, selection, 30);
        const diagnostics = this.contextEngine.buildContextSummary([]);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'GiuseCoder: Applying inline edit',
                cancellable: true
            },
            async (_progress, cancellationToken) => {
                const abort = new AbortController();
                const cancellationSubscription = cancellationToken.onCancellationRequested(() => {
                    abort.abort();
                });

                try {
                    const model = vscode.workspace
                        .getConfiguration('giuseCoder.chat')
                        .get<string>('model', 'claude-sonnet-4-20250514');

                    const response = await this.aiProvider.requestTabCompletion({
                        model,
                        maxTokens: 2048,
                        systemPrompt: INLINE_EDIT_SYSTEM_PROMPT,
                        prompt: [
                            `FILE: ${filePath}`,
                            `LANGUAGE: ${language}`,
                            `GLOBAL DIAGNOSTICS: errors=${diagnostics.errorCount} warnings=${diagnostics.warningCount}`,
                            'INSTRUCTION:',
                            instruction,
                            'SELECTION:',
                            selectedCode,
                            'SURROUNDING CONTEXT:',
                            contextSnippet,
                            'Return only the replacement for SELECTION.'
                        ].join('\n\n'),
                        signal: abort.signal
                    });

                    const editedCode = this.normalizeEditedCode(response.text);
                    if (!editedCode.trim()) {
                        throw new Error('Model returned empty code.');
                    }

                    const applied = await editor.edit((builder) => {
                        builder.replace(selection, editedCode);
                    });

                    if (!applied) {
                        throw new Error('Failed to apply edit in the active editor.');
                    }

                    void vscode.window.showInformationMessage(
                        `GiuseCoder inline edit applied (${response.outputTokens} output tokens, $${response.costUsd.toFixed(4)}).`
                    );
                } finally {
                    cancellationSubscription.dispose();
                }
            }
        );
    }

    private extractSurroundingContext(
        document: vscode.TextDocument,
        selection: vscode.Selection,
        lineWindow: number
    ): string {
        const startLine = Math.max(0, selection.start.line - lineWindow);
        const endLine = Math.min(document.lineCount - 1, selection.end.line + lineWindow);

        const lines: string[] = [];
        for (let line = startLine; line <= endLine; line += 1) {
            const prefix = line === selection.start.line ? '>> ' : '   ';
            lines.push(`${prefix}${document.lineAt(line).text}`);
        }

        return lines.join('\n');
    }

    private normalizeEditedCode(raw: string): string {
        return raw
            .replace(/^```[\w-]*\s*/g, '')
            .replace(/```$/g, '')
            .trim();
    }
}
