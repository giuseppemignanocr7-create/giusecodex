import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';

const SECRET_KEY = 'giuseCoder.anthropicApiKey';

type PricingEntry = {
    input: number;
    output: number;
};

const MODEL_PRICING_PER_MILLION_TOKENS: Record<string, PricingEntry> = {
    'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
    'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
    'claude-sonnet-4-20250514': { input: 3, output: 15 },
    'claude-opus-4-1-20250805': { input: 15, output: 75 },
    'claude-opus-4-6': { input: 15, output: 75 }
};

export interface AITextResponse {
    text: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

export interface ChatStreamRequest {
    prompt: string;
    model: string;
    systemPrompt: string;
    maxTokens: number;
    temperature: number;
    signal?: AbortSignal;
    onToken?: (token: string) => void;
}

export interface TabCompletionRequest {
    prompt: string;
    model: string;
    systemPrompt: string;
    maxTokens: number;
    signal?: AbortSignal;
}

export interface SessionUsage {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

export class AIProviderManager {
    private cachedKey: string | null = null;
    private client: Anthropic | null = null;
    private usage: SessionUsage = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0
    };

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async hasApiKey(): Promise<boolean> {
        const key = await this.getApiKey();
        return Boolean(key);
    }

    public async setApiKey(apiKey: string): Promise<void> {
        const normalized = apiKey.trim();
        if (!normalized) {
            throw new Error('API key is empty.');
        }

        await this.context.secrets.store(SECRET_KEY, normalized);
        this.cachedKey = normalized;
        this.client = this.createClient(normalized);
    }

    public async clearApiKey(): Promise<void> {
        await this.context.secrets.delete(SECRET_KEY);
        this.cachedKey = null;
        this.client = null;
    }

    public getSessionUsage(): SessionUsage {
        return { ...this.usage };
    }

    public async getAnthropicClient(): Promise<Anthropic> {
        return this.getClient();
    }

    public estimateCostPublic(model: string, inputTokens: number, outputTokens: number): number {
        return this.estimateCost(model, inputTokens, outputTokens);
    }

    public accumulateUsage(inputTokens: number, outputTokens: number, costUsd: number): void {
        this.usage.requests += 1;
        this.usage.inputTokens += inputTokens;
        this.usage.outputTokens += outputTokens;
        this.usage.costUsd += costUsd;
    }

    public async streamChat(request: ChatStreamRequest): Promise<AITextResponse> {
        if (!request.onToken) {
            return this.createMessage({
                prompt: request.prompt,
                model: request.model,
                systemPrompt: request.systemPrompt,
                maxTokens: request.maxTokens,
                temperature: request.temperature,
                signal: request.signal
            });
        }

        return this.createStreamingMessage({
            prompt: request.prompt,
            model: request.model,
            systemPrompt: request.systemPrompt,
            maxTokens: request.maxTokens,
            temperature: request.temperature,
            signal: request.signal,
            onToken: request.onToken
        });
    }

    public async requestTabCompletion(request: TabCompletionRequest): Promise<AITextResponse> {
        return this.createMessage({
            prompt: request.prompt,
            model: request.model,
            systemPrompt: request.systemPrompt,
            maxTokens: request.maxTokens,
            temperature: 0,
            signal: request.signal
        });
    }

    private async createMessage(params: {
        prompt: string;
        model: string;
        systemPrompt: string;
        maxTokens: number;
        temperature: number;
        signal?: AbortSignal;
    }): Promise<AITextResponse> {
        this.throwIfAborted(params.signal);

        const client = await this.getClient();
        const completion: any = await client.messages.create({
            model: params.model,
            max_tokens: params.maxTokens,
            temperature: params.temperature,
            system: params.systemPrompt,
            messages: [
                {
                    role: 'user',
                    content: params.prompt
                }
            ]
        }, {
            signal: params.signal
        });

        this.throwIfAborted(params.signal);

        const text = this.extractText(completion);
        const inputTokens = Number(completion?.usage?.input_tokens ?? 0);
        const outputTokens = Number(completion?.usage?.output_tokens ?? 0);
        const costUsd = this.estimateCost(params.model, inputTokens, outputTokens);

        this.usage.requests += 1;
        this.usage.inputTokens += inputTokens;
        this.usage.outputTokens += outputTokens;
        this.usage.costUsd += costUsd;

        return {
            text,
            model: params.model,
            inputTokens,
            outputTokens,
            costUsd
        };
    }

    private async createStreamingMessage(params: {
        prompt: string;
        model: string;
        systemPrompt: string;
        maxTokens: number;
        temperature: number;
        signal?: AbortSignal;
        onToken: (token: string) => void;
    }): Promise<AITextResponse> {
        this.throwIfAborted(params.signal);

        const client = await this.getClient();
        const stream = client.messages.stream({
            model: params.model,
            max_tokens: params.maxTokens,
            temperature: params.temperature,
            system: params.systemPrompt,
            messages: [
                {
                    role: 'user',
                    content: params.prompt
                }
            ]
        }, {
            signal: params.signal
        });

        const abortHandler = (): void => {
            stream.abort();
        };

        params.signal?.addEventListener('abort', abortHandler, { once: true });

        try {
            stream.on('text', (textDelta: string) => {
                if (params.signal?.aborted) {
                    return;
                }
                params.onToken(textDelta);
            });

            const finalMessage = await stream.finalMessage();
            this.throwIfAborted(params.signal);

            const text = this.extractText(finalMessage);
            const inputTokens = Number(finalMessage?.usage?.input_tokens ?? 0);
            const outputTokens = Number(finalMessage?.usage?.output_tokens ?? 0);
            const costUsd = this.estimateCost(params.model, inputTokens, outputTokens);

            this.usage.requests += 1;
            this.usage.inputTokens += inputTokens;
            this.usage.outputTokens += outputTokens;
            this.usage.costUsd += costUsd;

            return {
                text,
                model: params.model,
                inputTokens,
                outputTokens,
                costUsd
            };
        } finally {
            params.signal?.removeEventListener('abort', abortHandler);
        }
    }

    private extractText(completion: any): string {
        const content = completion?.content;
        if (!Array.isArray(content)) {
            return '';
        }

        const textParts: string[] = [];
        for (const block of content) {
            if (block?.type === 'text' && typeof block?.text === 'string') {
                textParts.push(block.text);
            }
        }

        return textParts.join('');
    }

    private estimateCost(model: string, inputTokens: number, outputTokens: number): number {
        const pricing = MODEL_PRICING_PER_MILLION_TOKENS[model] ?? MODEL_PRICING_PER_MILLION_TOKENS['claude-sonnet-4-20250514'];
        return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
    }

    private async getClient(): Promise<Anthropic> {
        if (this.client) {
            return this.client;
        }

        const apiKey = await this.getApiKey();
        if (!apiKey) {
            throw new Error('Anthropic API key missing. Run "GiuseCoder: Set Anthropic API Key" first.');
        }

        this.client = this.createClient(apiKey);
        return this.client;
    }

    private createClient(apiKey: string): Anthropic {
        const configuredBaseUrl = vscode.workspace
            .getConfiguration('giuseCoder.chat')
            .get<string>('baseUrl', 'https://api.anthropic.com');

        return new Anthropic({
            apiKey,
            baseURL: configuredBaseUrl
        });
    }

    private async getApiKey(): Promise<string | null> {
        if (this.cachedKey) {
            return this.cachedKey;
        }

        const secret = await this.context.secrets.get(SECRET_KEY);
        this.cachedKey = secret ?? null;
        return this.cachedKey;
    }

    private throwIfAborted(signal?: AbortSignal): void {
        if (signal?.aborted) {
            const abortError = new Error('Request aborted by user.');
            abortError.name = 'AbortError';
            throw abortError;
        }
    }
}
