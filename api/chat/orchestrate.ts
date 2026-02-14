export const config = { runtime: 'edge' };

const OPUS_SYSTEM = `You are GiuseCoder Opus, the CTO and lead architect.
Your role:
1. ANALYZE the user's request
2. PLAN: decide if it needs UI/design work (Sonnet 4.5) and/or code (GPT 5.2)
3. DELEGATE: create clear prompts for each agent
4. REVIEW: combine their outputs and give the final answer

Respond with JSON:
\`\`\`json
{
  "summary": "Brief analysis",
  "needsDesign": true/false,
  "needsCode": true/false,
  "designPrompt": "Prompt for Sonnet 4.5 (UI/CSS/layout). Empty if not needed.",
  "codePrompt": "Prompt for GPT 5.2 (logic/backend). Empty if not needed."
}
\`\`\`
If simple question, set both false and answer in summary.`;

const SONNET_SYSTEM = `You are GiuseCoder Sonnet, the UI/UX designer. Create beautiful modern UI with TailwindCSS + React + TypeScript. Be concise, output ready-to-use code.`;
const CODEX_SYSTEM = `You are GiuseCoder Codex, the senior developer. Write clean production-ready TypeScript code with proper error handling. Be concise, output working code with file paths.`;
const REVIEW_SYSTEM = `You are GiuseCoder Opus reviewing your team's work. Combine the outputs into a single polished response. Present final code in markdown blocks with file paths.`;
const ASK_OPUS_SYSTEM = `You are GiuseCoder Opus in ASK mode.
The user wants guidance, explanations, architecture reasoning, debugging help, or reviews.
Do NOT proactively generate full implementation code unless explicitly requested.
Be concise, practical, and clear.`;

// Helper: stream Anthropic and collect text, writing SSE events
async function streamAnthropic(
  apiKey: string, model: string, system: string,
  msgs: Array<{role: string; content: string}>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder, agent: string
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 8192, system, messages: msgs, stream: true }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`);
  }
  let result = '';
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const j = JSON.parse(line.slice(6));
          if (j.type === 'content_block_delta' && j.delta?.text) {
            result += j.delta.text;
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'token', agent, text: j.delta.text })}\n\n`));
          }
        } catch { /* skip */ }
      }
    }
  }
  return result;
}

// Helper: stream OpenAI and collect text
async function streamOpenAI(
  apiKey: string, model: string, system: string,
  msgs: Array<{role: string; content: string}>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder, agent: string
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...msgs], max_tokens: 8192, stream: true }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 200)}`);
  }
  let result = '';
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
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
          if (t) {
            result += t;
            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'token', agent, text: t })}\n\n`));
          }
        } catch { /* skip */ }
      }
    }
  }
  return result;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { messages, anthropicKey, openaiKey, chatMode } = await req.json();
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: 'Anthropic API key required' }), { status: 400 });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (type: string, data: Record<string, unknown>) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
  };

  // Run pipeline in background
  (async () => {
    try {
      if (chatMode === 'ask') {
        await send('step', { agent: 'opus', label: 'Opus answering in Ask mode...', status: 'running' });
        const askText = await streamAnthropic(anthropicKey, 'claude-opus-4-6', ASK_OPUS_SYSTEM, messages, writer, encoder, 'opus');
        await send('step', { agent: 'opus', label: 'Ask response complete', status: 'done' });
        await send('done', { content: askText });
        await writer.write(encoder.encode('data: [DONE]\n\n'));
        return;
      }

      // Step 1: Opus plans
      await send('step', { agent: 'opus', label: 'Opus analyzing request...', status: 'running' });
      const planText = await streamAnthropic(anthropicKey, 'claude-opus-4-6', OPUS_SYSTEM, messages, writer, encoder, 'opus');
      await send('step', { agent: 'opus', label: 'Analysis complete', status: 'done' });

      // Parse plan
      let plan: { summary: string; needsDesign: boolean; needsCode: boolean; designPrompt: string; codePrompt: string };
      try {
        const m = planText.match(/```json\s*([\s\S]*?)\s*```/);
        plan = JSON.parse(m ? m[1] : planText);
      } catch {
        await send('done', { content: planText });
        await writer.write(encoder.encode('data: [DONE]\n\n'));
        return;
      }

      if (!plan.needsDesign && !plan.needsCode) {
        await send('done', { content: plan.summary });
        await writer.write(encoder.encode('data: [DONE]\n\n'));
        return;
      }

      // Step 2: Delegate in parallel
      const results: { design?: string; code?: string } = {};
      const tasks: Promise<void>[] = [];

      if (plan.needsDesign) {
        tasks.push((async () => {
          await send('step', { agent: 'sonnet', label: 'Sonnet designing UI...', status: 'running' });
          results.design = await streamAnthropic(anthropicKey, 'claude-sonnet-4-5-20250929', SONNET_SYSTEM,
            [...messages, { role: 'user', content: plan.designPrompt }], writer, encoder, 'sonnet');
          await send('step', { agent: 'sonnet', label: 'Design complete', status: 'done' });
        })());
      }

      if (plan.needsCode && openaiKey) {
        tasks.push((async () => {
          await send('step', { agent: 'codex', label: 'GPT 5.2 writing code...', status: 'running' });
          let gptSuccess = false;
          let lastErr = '';

          // Try GPT up to 2 times before falling back
          for (let attempt = 1; attempt <= 2 && !gptSuccess; attempt++) {
            try {
              if (attempt > 1) {
                await send('step', { agent: 'codex', label: `GPT 5.2 retry #${attempt}...`, status: 'running' });
              }
              const codeOut = await streamOpenAI(openaiKey, 'gpt-5.2', CODEX_SYSTEM,
                [...messages, { role: 'user', content: plan.codePrompt }], writer, encoder, 'codex');
              if (!codeOut?.trim()) {
                throw new Error('GPT returned empty output');
              }
              results.code = codeOut;
              gptSuccess = true;
            } catch (openaiErr: unknown) {
              lastErr = openaiErr instanceof Error ? openaiErr.message : 'OpenAI failed';
              // Clear previous codex tokens for retry
              if (attempt < 2) {
                await send('token', { agent: 'codex', text: `\n⚠️ GPT attempt ${attempt} failed: ${lastErr}. Retrying...\n` });
              }
            }
          }

          if (!gptSuccess) {
            await send('token', { agent: 'codex', text: `\n❌ GPT 5.2 failed after 2 attempts: ${lastErr}\n🔄 Falling back to Sonnet 4.5...\n\n` });
            await send('step', { agent: 'codex', label: `GPT failed: ${lastErr.slice(0, 80)} — Sonnet fallback`, status: 'running' });
            results.code = await streamAnthropic(anthropicKey, 'claude-sonnet-4-5-20250929', CODEX_SYSTEM,
              [...messages, { role: 'user', content: plan.codePrompt }], writer, encoder, 'codex');
          }
          await send('step', { agent: 'codex', label: gptSuccess ? 'GPT 5.2 code complete' : 'Code complete (Sonnet fallback)', status: 'done' });
        })());
      } else if (plan.needsCode) {
        tasks.push((async () => {
          await send('step', { agent: 'codex', label: 'Sonnet 4.5 writing code (no OpenAI key)...', status: 'running' });
          await send('token', { agent: 'codex', text: '⚠️ No OpenAI API key set — add it in Settings to use GPT 5.2 for code generation.\n\n' });
          results.code = await streamAnthropic(anthropicKey, 'claude-sonnet-4-5-20250929', CODEX_SYSTEM,
            [...messages, { role: 'user', content: plan.codePrompt }], writer, encoder, 'codex');
          await send('step', { agent: 'codex', label: 'Code complete (Sonnet — no OpenAI key)', status: 'done' });
        })());
      }

      await Promise.all(tasks);

      // Step 3: Opus review
      await send('step', { agent: 'opus', label: 'Opus reviewing & combining...', status: 'running' });
      let reviewPrompt = `Task: ${plan.summary}\n\n`;
      if (results.design) reviewPrompt += `## Sonnet Design:\n${results.design}\n\n`;
      if (results.code) reviewPrompt += `## Codex Code:\n${results.code}\n\n`;
      reviewPrompt += 'Combine into a polished final response.';

      const finalText = await streamAnthropic(anthropicKey, 'claude-opus-4-6', REVIEW_SYSTEM,
        [...messages, { role: 'user', content: reviewPrompt }], writer, encoder, 'opus');
      await send('step', { agent: 'opus', label: 'Review complete', status: 'done' });

      await send('done', { content: finalText });
      await writer.write(encoder.encode('data: [DONE]\n\n'));
    } catch (err: unknown) {
      await send('error', { message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      try {
        await writer.close();
      } catch {
        // stream may already be closed in some return paths
      }
    }
  })();

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
