// Direct API calls for Electron mode (no server needed)
// When loaded from file://, we call Anthropic/OpenAI APIs directly

export const isElectronApp = typeof window !== 'undefined' && !!(window as any).giuseCoder?.isElectron;

// ──── Anthropic Streaming ────
export async function streamAnthropic(params: {
  messages: Array<{ role: string; content: string }>;
  model: string;
  systemPrompt?: string;
  apiKey: string;
  signal?: AbortSignal;
  onToken: (text: string) => void;
  maxTokens?: number;
  temperature?: number;
}): Promise<void> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens || 8192,
      temperature: params.temperature ?? 0.2,
      stream: true,
      system: params.systemPrompt,
      messages: params.messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 200)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          params.onToken(parsed.delta.text);
        }
      } catch { /* skip malformed */ }
    }
  }
}

// ──── OpenAI Streaming ────
export async function streamOpenAI(params: {
  messages: Array<{ role: string; content: string }>;
  model: string;
  systemPrompt?: string;
  apiKey: string;
  signal?: AbortSignal;
  onToken: (text: string) => void;
  maxTokens?: number;
  temperature?: number;
}): Promise<void> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      stream: true,
      max_completion_tokens: params.maxTokens || 8192,
      temperature: params.temperature ?? 0.2,
      messages: [
        ...(params.systemPrompt ? [{ role: 'system', content: params.systemPrompt }] : []),
        ...params.messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
      ],
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${err.slice(0, 200)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) params.onToken(content);
      } catch { /* skip malformed */ }
    }
  }
}

// ──── Server-proxied streaming (web mode) ────
export async function streamViaServer(params: {
  messages: Array<{ role: string; content: string }>;
  model: string;
  apiKey: string;
  provider: string;
  systemPrompt?: string;
  openaiKey?: string;
  signal?: AbortSignal;
  onToken: (text: string) => void;
  maxTokens?: number;
  temperature?: number;
}): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: params.messages,
      model: params.model,
      apiKey: params.provider === 'openai' ? params.openaiKey : params.apiKey,
      provider: params.provider,
      systemPrompt: params.systemPrompt,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Server error ${res.status}: ${err.slice(0, 200)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    params.onToken(text);
  }
}
