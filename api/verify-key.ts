export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { provider, apiKey } = await req.json();
  if (!apiKey) return new Response(JSON.stringify({ valid: false, error: 'No key provided' }));

  try {
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      return new Response(JSON.stringify({ valid: r.ok }));
    } else if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return new Response(JSON.stringify({ valid: r.ok }));
    } else {
      return new Response(JSON.stringify({ valid: false, error: 'Unknown provider' }));
    }
  } catch (err: unknown) {
    return new Response(JSON.stringify({ valid: false, error: err instanceof Error ? err.message : 'Unknown error' }));
  }
}
