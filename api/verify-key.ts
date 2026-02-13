import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { provider, apiKey } = req.body;
  if (!apiKey) return res.json({ valid: false, error: 'No key provided' });

  try {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      res.json({ valid: true });
    } else if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      res.json({ valid: r.ok });
    } else {
      res.json({ valid: false, error: 'Unknown provider' });
    }
  } catch (err: unknown) {
    res.json({ valid: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
