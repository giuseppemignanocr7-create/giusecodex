import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const OPUS_SYSTEM = `You are GiuseCoder Opus, the CTO and lead architect.
Your role:
1. ANALYZE the user's request
2. PLAN: decide if it needs UI/design work (Sonnet) and/or code (Codex GPT 5.3)
3. DELEGATE: create clear prompts for each agent
4. REVIEW: combine their outputs and give the final answer

Respond with JSON:
\`\`\`json
{
  "summary": "Brief analysis",
  "needsDesign": true/false,
  "needsCode": true/false,
  "designPrompt": "Prompt for Sonnet (UI/CSS/layout). Empty if not needed.",
  "codePrompt": "Prompt for GPT 5.3 Codex (logic/backend). Empty if not needed."
}
\`\`\`
If simple question, set both false and answer in summary.`;

const SONNET_SYSTEM = `You are GiuseCoder Sonnet, the UI/UX designer. Create beautiful modern UI with TailwindCSS + React + TypeScript. Be concise, output ready-to-use code.`;
const CODEX_SYSTEM = `You are GiuseCoder Codex, the senior developer. Write clean production-ready TypeScript code with proper error handling. Be concise, output working code with file paths.`;
const REVIEW_SYSTEM = `You are GiuseCoder Opus reviewing your team's work. Combine the outputs into a single polished response. Present final code in markdown blocks with file paths.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, anthropicKey, openaiKey } = req.body;
  if (!anthropicKey) return res.status(400).json({ error: 'Anthropic API key required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type: string, data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  const anthropic = new Anthropic({ apiKey: anthropicKey });

  try {
    // Step 1: Opus plans
    send('step', { agent: 'opus', label: 'Opus analyzing request...', status: 'running' });
    let planText = '';
    const planStream = anthropic.messages.stream({
      model: 'claude-opus-4-6', max_tokens: 4096, system: OPUS_SYSTEM,
      messages: messages.map((m: { role: string; content: string }) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    });
    for await (const ev of planStream) {
      if (ev.type === 'content_block_delta' && 'text' in ev.delta) {
        planText += ev.delta.text;
        send('token', { agent: 'opus', text: ev.delta.text });
      }
    }
    send('step', { agent: 'opus', label: 'Analysis complete', status: 'done' });

    // Parse plan
    let plan: { summary: string; needsDesign: boolean; needsCode: boolean; designPrompt: string; codePrompt: string };
    try {
      const m = planText.match(/```json\s*([\s\S]*?)\s*```/);
      plan = JSON.parse(m ? m[1] : planText);
    } catch {
      send('done', { content: planText });
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    if (!plan.needsDesign && !plan.needsCode) {
      send('done', { content: plan.summary });
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Step 2: Delegate in parallel
    const results: { design?: string; code?: string } = {};
    const tasks: Promise<void>[] = [];

    if (plan.needsDesign) {
      tasks.push((async () => {
        send('step', { agent: 'sonnet', label: 'Sonnet designing UI...', status: 'running' });
        let r = '';
        const s = anthropic.messages.stream({
          model: 'claude-sonnet-4-20250514', max_tokens: 8192, system: SONNET_SYSTEM,
          messages: [...messages, { role: 'user' as const, content: plan.designPrompt }],
        });
        for await (const ev of s) {
          if (ev.type === 'content_block_delta' && 'text' in ev.delta) {
            r += ev.delta.text;
            send('token', { agent: 'sonnet', text: ev.delta.text });
          }
        }
        results.design = r;
        send('step', { agent: 'sonnet', label: 'Design complete', status: 'done' });
      })());
    }

    if (plan.needsCode && openaiKey) {
      tasks.push((async () => {
        send('step', { agent: 'codex', label: 'GPT 5.3 writing code...', status: 'running' });
        let r = '';
        const oRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-5.3-codex',
            messages: [{ role: 'system', content: CODEX_SYSTEM }, ...messages, { role: 'user', content: plan.codePrompt }],
            max_tokens: 8192, stream: true,
          }),
        });
        const reader = oRes.body?.getReader();
        const dec = new TextDecoder();
        let buf = '';
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const j = JSON.parse(line.slice(6));
                  const t = j.choices?.[0]?.delta?.content;
                  if (t) { r += t; send('token', { agent: 'codex', text: t }); }
                } catch { /* skip */ }
              }
            }
          }
        }
        results.code = r;
        send('step', { agent: 'codex', label: 'Code complete', status: 'done' });
      })());
    } else if (plan.needsCode) {
      // Fallback: use Sonnet for code if no OpenAI key
      tasks.push((async () => {
        send('step', { agent: 'codex', label: 'Sonnet writing code (no OpenAI key)...', status: 'running' });
        let r = '';
        const s = anthropic.messages.stream({
          model: 'claude-sonnet-4-20250514', max_tokens: 8192, system: CODEX_SYSTEM,
          messages: [...messages, { role: 'user' as const, content: plan.codePrompt }],
        });
        for await (const ev of s) {
          if (ev.type === 'content_block_delta' && 'text' in ev.delta) {
            r += ev.delta.text;
            send('token', { agent: 'codex', text: ev.delta.text });
          }
        }
        results.code = r;
        send('step', { agent: 'codex', label: 'Code complete', status: 'done' });
      })());
    }

    await Promise.all(tasks);

    // Step 3: Opus review
    send('step', { agent: 'opus', label: 'Opus reviewing & combining...', status: 'running' });
    let reviewPrompt = `Task: ${plan.summary}\n\n`;
    if (results.design) reviewPrompt += `## Sonnet Design:\n${results.design}\n\n`;
    if (results.code) reviewPrompt += `## Codex Code:\n${results.code}\n\n`;
    reviewPrompt += 'Combine into a polished final response.';

    let finalText = '';
    const reviewStream = anthropic.messages.stream({
      model: 'claude-opus-4-6', max_tokens: 8192, system: REVIEW_SYSTEM,
      messages: [...messages, { role: 'user' as const, content: reviewPrompt }],
    });
    for await (const ev of reviewStream) {
      if (ev.type === 'content_block_delta' && 'text' in ev.delta) {
        finalText += ev.delta.text;
        send('token', { agent: 'opus', text: ev.delta.text });
      }
    }
    send('step', { agent: 'opus', label: 'Review complete', status: 'done' });

    send('done', { content: finalText });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: unknown) {
    send('error', { message: err instanceof Error ? err.message : 'Unknown error' });
    res.end();
  }
}
