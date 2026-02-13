import * as vscode from 'vscode';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCallback);

export type ContextTagType = 'file' | 'errors' | 'git' | 'terminal' | 'selection';

export interface ContextTag {
    id: string;
    type: ContextTagType;
    value: string;
    label: string;
}

export interface MentionCandidate {
    id: string;
    type: ContextTagType;
    value: string;
    label: string;
    description: string;
}

export interface ContextPayload {
    type: ContextTagType;
    title: string;
    source: string;
    content: string;
}

export interface ContextSummary {
    chips: Array<{
        id: string;
        label: string;
        type: ContextTagType;
        active: boolean;
    }>;
    errorCount: number;
    warningCount: number;
}

export class ContextEngine {
    private readonly staticCandidates: MentionCandidate[] = [
        {
            id: 'errors',
            type: 'errors',
            value: '@errors',
            label: '@errors',
            description: 'Include active diagnostics'
        },
        {
            id: 'git',
            type: 'git',
            value: '@git',
            label: '@git',
            description: 'Include current git diff'
        },
        {
            id: 'terminal',
            type: 'terminal',
            value: '@terminal',
            label: '@terminal',
            description: 'Include latest terminal context'
        },
        {
            id: 'selection',
            type: 'selection',
            value: '@selection',
            label: '@selection',
            description: 'Include current editor selection'
        }
    ];

    public async findMentionCandidates(query: string): Promise<MentionCandidate[]> {
        const normalized = query.trim().toLowerCase();

        const fileUris = await vscode.workspace.findFiles(
            '**/*',
            '**/{node_modules,.git,out,dist,build}/**',
            250
        );

        const workspace = vscode.workspace.workspaceFolders?.[0];
        const fileCandidates: MentionCandidate[] = fileUris
            .map((uri) => {
                const relative = workspace ? vscode.workspace.asRelativePath(uri, false) : uri.fsPath;
                const filename = relative.split(/[/\\]/).pop() ?? relative;
                return {
                    id: `file:${relative}`,
                    type: 'file' as const,
                    value: relative,
                    label: `@${filename}`,
                    description: relative
                };
            })
            .filter((candidate) => {
                if (!normalized) {
                    return true;
                }

                const haystack = `${candidate.label} ${candidate.description}`.toLowerCase();
                return haystack.includes(normalized);
            })
            .slice(0, 80);

        const staticCandidates = this.staticCandidates.filter((candidate) => {
            if (!normalized) {
                return true;
            }

            const haystack = `${candidate.label} ${candidate.description}`.toLowerCase();
            return haystack.includes(normalized);
        });

        return [...staticCandidates, ...fileCandidates].slice(0, 100);
    }

    public async resolveTags(tags: ContextTag[]): Promise<ContextPayload[]> {
        const payloads: ContextPayload[] = [];

        for (const tag of tags) {
            switch (tag.type) {
                case 'file': {
                    const filePayload = await this.resolveFile(tag.value);
                    if (filePayload) {
                        payloads.push(filePayload);
                    }
                    break;
                }
                case 'errors': {
                    payloads.push(this.resolveErrors());
                    break;
                }
                case 'git': {
                    payloads.push(await this.resolveGitDiff());
                    break;
                }
                case 'selection': {
                    const selectionPayload = this.resolveSelection();
                    if (selectionPayload) {
                        payloads.push(selectionPayload);
                    }
                    break;
                }
                case 'terminal': {
                    payloads.push(this.resolveTerminalContext());
                    break;
                }
                default:
                    break;
            }
        }

        return payloads;
    }

    public buildContextSummary(activeTags: ContextTag[]): ContextSummary {
        const diagnostics = vscode.languages.getDiagnostics();
        let errorCount = 0;
        let warningCount = 0;

        for (const [, entries] of diagnostics) {
            for (const entry of entries) {
                if (entry.severity === vscode.DiagnosticSeverity.Error) {
                    errorCount += 1;
                } else if (entry.severity === vscode.DiagnosticSeverity.Warning) {
                    warningCount += 1;
                }
            }
        }

        const chips = activeTags.map((tag) => ({
            id: tag.id,
            label: tag.label,
            type: tag.type,
            active: true
        }));

        return {
            chips,
            errorCount,
            warningCount
        };
    }

    public getSelectionText(): string {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return '';
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            return '';
        }

        return editor.document.getText(selection);
    }

    private async resolveFile(relativePath: string): Promise<ContextPayload | null> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
        try {
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            const text = Buffer.from(bytes).toString('utf8');
            const maxLength = 14_000;
            const clipped = text.length > maxLength ? `${text.slice(0, maxLength)}\n\n/* File truncated for context size */` : text;

            return {
                type: 'file',
                title: `File: ${relativePath}`,
                source: relativePath,
                content: clipped
            };
        } catch {
            return {
                type: 'file',
                title: `File: ${relativePath}`,
                source: relativePath,
                content: 'Unable to read file content.'
            };
        }
    }

    private resolveErrors(): ContextPayload {
        const diagnostics = vscode.languages.getDiagnostics();
        const lines: string[] = [];

        for (const [uri, entries] of diagnostics) {
            if (!entries.length) {
                continue;
            }

            const relative = vscode.workspace.asRelativePath(uri, false);
            for (const entry of entries) {
                const severity = this.severityLabel(entry.severity);
                const line = entry.range.start.line + 1;
                const character = entry.range.start.character + 1;
                lines.push(`[${severity}] ${relative}:${line}:${character} - ${entry.message}`);
            }
        }

        return {
            type: 'errors',
            title: 'Active Diagnostics',
            source: 'workspace diagnostics',
            content: lines.length ? lines.join('\n') : 'No diagnostics available.'
        };
    }

    private async resolveGitDiff(): Promise<ContextPayload> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return {
                type: 'git',
                title: 'Git Diff',
                source: 'git',
                content: 'No workspace folder available.'
            };
        }

        try {
            const { stdout } = await exec('git diff --no-color --unified=2', {
                cwd: workspaceFolder.uri.fsPath,
                maxBuffer: 3 * 1024 * 1024
            });

            return {
                type: 'git',
                title: 'Git Diff',
                source: 'git diff --no-color --unified=2',
                content: stdout.trim() || 'No uncommitted changes.'
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'git diff failed.';
            return {
                type: 'git',
                title: 'Git Diff',
                source: 'git diff --no-color --unified=2',
                content: message
            };
        }
    }

    private resolveSelection(): ContextPayload | null {
        const selection = this.getSelectionText();
        if (!selection) {
            return null;
        }

        const editor = vscode.window.activeTextEditor;
        const file = editor ? vscode.workspace.asRelativePath(editor.document.uri, false) : 'active editor';
        return {
            type: 'selection',
            title: 'Editor Selection',
            source: file,
            content: selection
        };
    }

    private resolveTerminalContext(): ContextPayload {
        const activeTerminal = vscode.window.activeTerminal;
        const terminalName = activeTerminal?.name ?? 'none';
        return {
            type: 'terminal',
            title: 'Terminal Context',
            source: terminalName,
            content:
                'VS Code API does not expose terminal output history directly. Include key terminal logs manually when needed.'
        };
    }

    private severityLabel(severity: vscode.DiagnosticSeverity): string {
        switch (severity) {
            case vscode.DiagnosticSeverity.Error:
                return 'error';
            case vscode.DiagnosticSeverity.Warning:
                return 'warning';
            case vscode.DiagnosticSeverity.Information:
                return 'info';
            case vscode.DiagnosticSeverity.Hint:
                return 'hint';
            default:
                return 'unknown';
        }
    }
}
