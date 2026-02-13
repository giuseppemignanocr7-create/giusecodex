import { ContextEngine } from '../context/ContextEngine';

export interface SlashResolution {
    consumed: boolean;
    rewrittenPrompt?: string;
    action?: {
        type: 'clear' | 'cost' | 'setModel' | 'agent';
        value?: string;
    };
    notice?: string;
}

export class SlashCommands {
    constructor(private readonly contextEngine: ContextEngine) {}

    public async resolve(rawInput: string): Promise<SlashResolution> {
        const trimmed = rawInput.trim();
        if (!trimmed.startsWith('/')) {
            return {
                consumed: false,
                rewrittenPrompt: rawInput
            };
        }

        const [command, ...args] = trimmed.split(/\s+/);
        const argText = args.join(' ').trim();

        switch (command.toLowerCase()) {
            case '/clear':
                return {
                    consumed: true,
                    action: { type: 'clear' },
                    notice: 'Chat cleared.'
                };

            case '/cost':
                return {
                    consumed: true,
                    action: { type: 'cost' }
                };

            case '/model': {
                if (!argText) {
                    return {
                        consumed: true,
                        notice: 'Usage: /model <model-name>'
                    };
                }

                return {
                    consumed: true,
                    action: {
                        type: 'setModel',
                        value: argText
                    },
                    notice: `Model switched to ${argText}`
                };
            }

            case '/agent':
                return {
                    consumed: true,
                    action: { type: 'agent' },
                    rewrittenPrompt: 'Execute this request autonomously in agent mode with concrete edits and verification steps.'
                };

            case '/fix': {
                const selection = this.contextEngine.getSelectionText();
                const scopedHint = selection
                    ? `\n\nSelected code:\n\`\`\`\n${selection}\n\`\`\``
                    : '\n\nNo explicit selection provided. Use diagnostics and active file context.';
                return {
                    consumed: false,
                    rewrittenPrompt: `Fix the current code issues with a minimal, production-grade patch.${scopedHint}`
                };
            }

            case '/explain': {
                const selection = this.contextEngine.getSelectionText();
                const target = selection ? `\n\nCode:\n\`\`\`\n${selection}\n\`\`\`` : '';
                return {
                    consumed: false,
                    rewrittenPrompt: `Explain the selected code deeply, including intent, edge cases, and potential risks.${target}`
                };
            }

            case '/refactor': {
                const selection = this.contextEngine.getSelectionText();
                const target = selection ? `\n\nCode:\n\`\`\`\n${selection}\n\`\`\`` : '';
                return {
                    consumed: false,
                    rewrittenPrompt: `Refactor the selected implementation for readability, safety, and maintainability while preserving behavior.${target}`
                };
            }

            case '/test': {
                const selection = this.contextEngine.getSelectionText();
                const target = selection ? `\n\nCode under test:\n\`\`\`\n${selection}\n\`\`\`` : '';
                return {
                    consumed: false,
                    rewrittenPrompt: `Generate robust unit tests for this code including edge cases and failure paths.${target}`
                };
            }

            case '/commit':
                return {
                    consumed: false,
                    rewrittenPrompt:
                        'Generate a concise, conventional-commit style message based on the current workspace changes and explain why.'
                };

            case '/review':
                return {
                    consumed: false,
                    rewrittenPrompt:
                        'Perform a strict code review focused on bugs, regressions, missing tests, and production risks. List findings by severity.'
                };

            case '/doc':
                return {
                    consumed: false,
                    rewrittenPrompt: 'Generate precise technical documentation for the selected or active code.'
                };

            case '/optimize':
                return {
                    consumed: false,
                    rewrittenPrompt:
                        'Suggest concrete optimizations for performance, memory usage, and maintainability with implementation-ready changes.'
                };

            default:
                return {
                    consumed: true,
                    notice: `Unknown command: ${command}`
                };
        }
    }
}
