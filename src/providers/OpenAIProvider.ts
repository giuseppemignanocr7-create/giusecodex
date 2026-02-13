import * as vscode from 'vscode';

const SECRET_KEY = 'giuseCoder.openaiApiKey';

type PricingEntry = {
    input: number;
    output: number;
};

const MODEL_PRICING_PER_MILLION_TOKENS: Record<string, PricingEntry> = {
    'gpt-5.3-codex': { input: 2, output: 8 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 }
};

export interface OpenAITextResponse {
    text: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

export interface OpenAIStreamRequest {
    prompt: string;
    model: string;
    systemPrompt: string;
    maxTokens: number;
    temperature: number;
    reasoningEffort?: 'low' | 'medium' | 'high';
    signal?: AbortSignal;
    onToken?: (token: string) => void;
}

export class OpenAIProvider {
    private cachedKey: string | null = null;

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
    }

    public async clearApiKey(): Promise<void> {
        await this.context.secrets.delete(SECRET_KEY);
        this.cachedKey = null;
    }

    public async streamChat(request: OpenAIStreamRequest): Promise<OpenAITextResponse> {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            throw new Error('OpenAI API key missing. Run "GiuseCoder: Set OpenAI API Key" first.');
        }

        this.throwIfAborted(request.signal);

        const baseUrl = vscode.workspace
            .getConfiguration('giuseCoder.openai')
            .get<string>('baseUrl', 'https://api.openai.com/v1');

        const body: Record<string, unknown> = {
            model: request.model,
            max_tokens: request.maxTokens,
            temperature: request.temperature,
            stream: Boolean(request.onToken),
            messages: [
                { role: 'system', content: request.systemPrompt },
                { role: 'user', content: request.prompt }
            ]
        };

        if (request.reasoningEffort) {
            body.reasoning_effort = request.reasoningEffort;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };

        if (request.onToken) {
            return this.fetchStreaming(baseUrl, headers, body, request);
        }

        return this.fetchNonStreaming(baseUrl, headers, body, request);
    }

    private async fetchNonStreaming(
        baseUrl: string,
        headers: Record<string, string>,
        body: Record<string, unknown>,
        request: OpenAIStreamRequest
    ): Promise<OpenAITextResponse> {
        body.stream = false;

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: request.signal
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
        }

        const json = await response.json() as any;
        this.throwIfAborted(request.signal);

        const text = json?.choices?.[0]?.message?.content ?? '';
        const inputTokens = Number(json?.usage?.prompt_tokens ?? 0);
        const outputTokens = Number(json?.usage?.completion_tokens ?? 0);
        const costUsd = this.estimateCost(request.model, inputTokens, outputTokens);

        return { text, model: request.model, inputTokens, outputTokens, costUsd };
    }

    private async fetchStreaming(
        baseUrl: string,
        headers: Record<string, string>,
        body: Record<string, unknown>,
        request: OpenAIStreamRequest
    ): Promise<OpenAITextResponse> {
        body.stream = true;
        body.stream_options = { include_usage: true };

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: request.signal
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
        }

        if (!response.body) {
            throw new Error('OpenAI streaming response has no body.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let inputTokens = 0;
        let outputTokens = 0;
        let buffer = '';

        try {
            while (true) {
                this.throwIfAborted(request.signal);

                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) {
                        continue;
                    }

                    const data = trimmed.slice(6);
                    if (data === '[DONE]') {
                        continue;
                    }

                    try {
                        const chunk = JSON.parse(data) as any;

                        const delta = chunk?.choices?.[0]?.delta?.content;
                        if (typeof delta === 'string' && delta.length > 0) {
                            fullText += delta;
                            request.onToken!(delta);
                        }

                        if (chunk?.usage) {
                            inputTokens = Number(chunk.usage.prompt_tokens ?? 0);
                            outputTokens = Number(chunk.usage.completion_tokens ?? 0);
                        }
                    } catch {
                        // skip malformed SSE chunks
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        this.throwIfAborted(request.signal);

        const costUsd = this.estimateCost(request.model, inputTokens, outputTokens);
        return { text: fullText, model: request.model, inputTokens, outputTokens, costUsd };
    }

    public estimateCost(model: string, inputTokens: number, outputTokens: number): number {
        const pricing = MODEL_PRICING_PER_MILLION_TOKENS[model]
            ?? MODEL_PRICING_PER_MILLION_TOKENS['gpt-5.3-codex'];
        return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
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
