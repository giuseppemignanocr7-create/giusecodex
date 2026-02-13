import { AgentRole, AgentModelConfig, SYSTEM_PROMPTS, REVIEW_SYSTEM_PROMPT } from './types';
import { AIProviderManager, AITextResponse } from '../providers/AIProviderManager';
import { OpenAIProvider } from '../providers/OpenAIProvider';
import { CostTracker } from './CostTracker';

export interface AgentCallOptions {
    prompt: string;
    agent: AgentRole;
    action: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
    onToken?: (token: string) => void;
}

export interface AgentCallResult {
    text: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
}

export class AgentCallers {
    constructor(
        private readonly anthropicProvider: AIProviderManager,
        private readonly openaiProvider: OpenAIProvider,
        private readonly costTracker: CostTracker,
        private readonly models: AgentModelConfig,
        private readonly codexReasoningEffort: 'low' | 'medium' | 'high'
    ) {}

    public async call(options: AgentCallOptions): Promise<AgentCallResult> {
        const start = Date.now();

        if (options.agent === 'codex') {
            return this.callCodex(options, start);
        }

        return this.callAnthropic(options, start);
    }

    private async callAnthropic(options: AgentCallOptions, startMs: number): Promise<AgentCallResult> {
        const model = this.models[options.agent];
        const systemPrompt = this.getSystemPrompt(options.agent, options.action);
        const maxTokens = options.maxTokens ?? this.getDefaultMaxTokens(options.agent, options.action);
        const temperature = options.temperature ?? 0.3;

        const response: AITextResponse = await this.anthropicProvider.streamChat({
            prompt: options.prompt,
            model,
            systemPrompt,
            maxTokens,
            temperature,
            signal: options.signal,
            onToken: options.onToken
        });

        const durationMs = Date.now() - startMs;
        this.costTracker.record(options.agent, response.inputTokens, response.outputTokens, response.costUsd);

        return {
            text: response.text,
            model: response.model,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            costUsd: response.costUsd,
            durationMs
        };
    }

    private async callCodex(options: AgentCallOptions, startMs: number): Promise<AgentCallResult> {
        const model = this.models.codex;
        const systemPrompt = SYSTEM_PROMPTS.codex;
        const maxTokens = options.maxTokens ?? 8192;
        const temperature = options.temperature ?? 0.2;

        const response = await this.openaiProvider.streamChat({
            prompt: options.prompt,
            model,
            systemPrompt,
            maxTokens,
            temperature,
            reasoningEffort: this.codexReasoningEffort,
            signal: options.signal,
            onToken: options.onToken
        });

        const durationMs = Date.now() - startMs;
        this.costTracker.record('codex', response.inputTokens, response.outputTokens, response.costUsd);

        return {
            text: response.text,
            model: response.model,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            costUsd: response.costUsd,
            durationMs
        };
    }

    private getSystemPrompt(agent: AgentRole, action: string): string {
        if (action === 'review') {
            return REVIEW_SYSTEM_PROMPT;
        }

        return SYSTEM_PROMPTS[agent];
    }

    private getDefaultMaxTokens(agent: AgentRole, action: string): number {
        if (agent === 'haiku') {
            if (action === 'classify') {
                return 256;
            }
            return 1024;
        }

        if (agent === 'opus') {
            if (action === 'plan') {
                return 4096;
            }
            if (action === 'review') {
                return 2048;
            }
            return 4096;
        }

        if (agent === 'sonnet') {
            return 6144;
        }

        return 8192;
    }
}
