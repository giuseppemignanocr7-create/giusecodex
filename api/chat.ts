export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { messages, model, apiKey, systemPrompt, provider } = await req.json();

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key required' }), { status: 400 });
  }

  const system = systemPrompt || `You are GiuseCoder, a premium AI coding assistant.
You write clean, idiomatic, production-ready code.
When modifying code, output the complete changed code with file paths.
Be concise and direct. Use markdown with code blocks.`;

  try {
    if (provider === 'openai') {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || 'gpt-5.2-codex',
          messages: [{ role: 'system', content: system }, ...messages],
          max_tokens: 8192,
          stream: true,
        }),
      });

      if (!openaiRes.ok) {
        const err = await openaiRes.text();
        return new Response(`**Error:** ${err}`, { status: 502 });
      }

      // Pass through OpenAI SSE stream, extracting text deltas
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      (async () => {
        const reader = openaiRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const json = JSON.parse(line.slice(6));
                  const text = json.choices?.[0]?.delta?.content;
                  if (text) await writer.write(encoder.encode(text));
                } catch { /* skip */ }
              }
            }
          }
        } finally { await writer.close(); }
      })();

      return new Response(readable, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
      });

    } else {
      // Anthropic — use raw fetch streaming (no SDK needed in Edge)
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model || 'claude-opus-4-6',
          max_tokens: 8192,
          system,
          messages,
          stream: true,
        }),
      });

      if (!anthropicRes.ok) {
        const err = await anthropicRes.text();
        return new Response(`**Error:** ${err}`, { status: 502 });
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      (async () => {
        const reader = anthropicRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const json = JSON.parse(line.slice(6));
                  if (json.type === 'content_block_delta' && json.delta?.text) {
                    await writer.write(encoder.encode(json.delta.text));
                  }
                } catch { /* skip */ }
              }
            }
          }
        } finally { await writer.close(); }
      })();

      return new Response(readable, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
