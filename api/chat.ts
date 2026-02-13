import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, model, apiKey, systemPrompt, provider } = req.body;

  if (!apiKey) return res.status(400).json({ error: 'API key required' });

  const system = systemPrompt || `You are GiuseCoder, a premium AI coding assistant.
You write clean, idiomatic, production-ready code.
When modifying code, output the complete changed code with file paths.
Be concise and direct. Use markdown with code blocks.`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    if (provider === 'openai') {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || 'gpt-5.3-codex',
          messages: [{ role: 'system', content: system }, ...messages],
          max_tokens: 8192,
          stream: true,
        }),
      });

      if (!openaiRes.ok) {
        const err = await openaiRes.text();
        res.write(`**Error:** ${err}`);
        return res.end();
      }

      const reader = openaiRes.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
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
                if (text) res.write(text);
              } catch { /* skip */ }
            }
          }
        }
      }
      res.end();
    } else {
      const client = new Anthropic({ apiKey });
      const stream = client.messages.stream({
        model: model || 'claude-opus-4-6',
        max_tokens: 8192,
        system,
        messages,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if ('text' in delta) res.write(delta.text);
        }
      }
      res.end();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    } else {
      res.write(`\n\n**Error:** ${msg}`);
      res.end();
    }
  }
}
