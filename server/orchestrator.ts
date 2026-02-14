import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';

// ──── Types ────

export interface OrchestratorConfig {
  anthropicKey: string;
  openaiKey: string;
  chatMode?: 'code' | 'ask';
  useCodexCLI?: boolean; // true on localhost/Electron, false on Vercel
  onStep: (step: PipelineStep) => void;
  onToken: (agent: string, text: string) => void;
}

export interface PipelineStep {
  agent: 'opus' | 'sonnet' | 'codex';
  label: string;
  status: 'running' | 'done' | 'error';
  content?: string;
}

interface TaskPlan {
  needsDesign: boolean;
  needsCode: boolean;
  designPrompt: string;
  codePrompt: string;
  summary: string;
}

// ──── System Prompts ────

const ASK_OPUS_SYSTEM = `You are GiuseCoder Opus in ASK mode.
The user wants guidance, explanations, architecture reasoning, debugging help, or reviews.
Do NOT proactively generate full implementation code unless explicitly requested.
Be concise, practical, and clear.`;

const OPUS_SYSTEM = `You are GiuseCoder Opus, the CTO and lead architect.
Your role:
1. ANALYZE the user's request
2. PLAN: decide if it needs UI/design work (Sonnet 4.5) and/or code (GPT 5.3 Codex / GPT 5.2)
3. DELEGATE: create clear prompts for each agent
4. REVIEW: combine their outputs and give the final answer

You MUST respond with a JSON plan in this exact format:
\`\`\`json
{
  "summary": "Brief analysis of what the user wants",
  "needsDesign": true/false,
  "needsCode": true/false,
  "designPrompt": "Detailed prompt for Sonnet 4.5 (UI/CSS/layout/design). Empty string if not needed.",
  "codePrompt": "Detailed prompt for GPT (implementation/logic/backend). Empty string if not needed."
}
\`\`\`

If it's a simple question, set both to false and put your answer in summary.
Always include full context from the conversation in your prompts to the agents.`;

const SONNET_SYSTEM = `You are GiuseCoder Sonnet, the UI/UX designer and frontend specialist.
Your role: Create beautiful, modern UI components, layouts, CSS, and visual design.
- Use TailwindCSS classes
- Use React with TypeScript
- Create responsive, accessible interfaces
- Output complete, ready-to-use code
Be concise. Output only the code with brief explanations.`;

const CODEX_SYSTEM = `You are GiuseCoder Codex, the senior developer.
Your role: Write clean, production-ready code — backend, logic, algorithms, APIs, databases.
- Write TypeScript/JavaScript by default
- Include proper error handling
- Follow best practices
- Output complete, working code with file paths
Be concise. Output only the code with brief explanations.`;

const OPUS_REVIEW_SYSTEM = `You are GiuseCoder Opus reviewing the work of your team.
You received the user's request and your agents produced outputs.
Combine them into a single, coherent, polished response for the user.
- If there are conflicts, resolve them
- Present the final code in markdown code blocks with file paths
- Add brief explanations
- If something is missing, note it
Be clear and direct.`;

// ──── Orchestrator ────

export async function orchestrate(
  messages: Array<{ role: string; content: string }>,
  config: OrchestratorConfig
): Promise<string> {
  const anthropic = new Anthropic({ apiKey: config.anthropicKey });

  // ASK mode: Opus answers directly, no pipeline
  if (config.chatMode === 'ask') {
    config.onStep({ agent: 'opus', label: 'Opus answering in Ask mode...', status: 'running' });
    const askText = await callAnthropic(anthropic, 'claude-opus-4-6', ASK_OPUS_SYSTEM, messages, config, 'opus');
    config.onStep({ agent: 'opus', label: 'Ask response complete', status: 'done' });
    return askText;
  }

  // Step 1: Opus analyzes and plans
  config.onStep({ agent: 'opus', label: 'Opus analyzing request...', status: 'running' });

  const planResponse = await callAnthropic(anthropic, 'claude-opus-4-6', OPUS_SYSTEM, messages, config, 'opus');
  config.onStep({ agent: 'opus', label: 'Opus analysis complete', status: 'done', content: planResponse });

  // Parse plan
  let plan: TaskPlan;
  try {
    const jsonMatch = planResponse.match(/```json\s*([\s\S]*?)\s*```/);
    plan = JSON.parse(jsonMatch ? jsonMatch[1] : planResponse);
  } catch {
    return planResponse;
  }

  if (!plan.needsDesign && !plan.needsCode) {
    return plan.summary;
  }

  // Step 2: Delegate to agents (parallel when both needed)
  const results: { design?: string; code?: string } = {};
  const tasks: Promise<void>[] = [];
  const useCodex = config.useCodexCLI === true;
  const codeAgent = useCodex ? 'GPT 5.3 Codex CLI' : 'GPT 5.2 API';

  if (plan.needsDesign) {
    tasks.push((async () => {
      config.onStep({ agent: 'sonnet', label: 'Sonnet designing UI...', status: 'running' });
      const designMessages = [...messages, { role: 'user', content: plan.designPrompt }];
      results.design = await callAnthropic(anthropic, 'claude-sonnet-4-5-20250929', SONNET_SYSTEM, designMessages, config, 'sonnet');
      config.onStep({ agent: 'sonnet', label: 'Sonnet design complete', status: 'done', content: results.design });
    })());
  }

  if (plan.needsCode) {
    tasks.push((async () => {
      config.onStep({ agent: 'codex', label: `${codeAgent} writing code...`, status: 'running' });
      const codeMessages = [...messages, { role: 'user', content: plan.codePrompt }];

      if (useCodex) {
        // Localhost/Electron: use codex CLI with GPT 5.3
        try {
          results.code = await callCodexCLI(plan.codePrompt, config);
          if (!results.code?.trim()) throw new Error('Codex CLI returned empty output');
          config.onStep({ agent: 'codex', label: 'GPT 5.3 Codex code complete ✓', status: 'done', content: results.code });
        } catch (cliErr: unknown) {
          const msg = cliErr instanceof Error ? cliErr.message : 'Codex CLI failed';
          // Try GPT 5.2 API as secondary before giving up
          if (config.openaiKey) {
            config.onToken('codex', `\n⚠️ Codex CLI failed: ${msg}. Trying GPT 5.2 API...\n`);
            config.onStep({ agent: 'codex', label: 'Trying GPT 5.2 API...', status: 'running' });
            try {
              results.code = await callOpenAI(config.openaiKey, 'gpt-5.2', CODEX_SYSTEM, codeMessages, config);
              config.onStep({ agent: 'codex', label: 'GPT 5.2 code complete ✓', status: 'done', content: results.code });
            } catch (apiErr: unknown) {
              const apiMsg = apiErr instanceof Error ? apiErr.message : 'API failed';
              config.onStep({ agent: 'codex', label: `❌ Both GPT 5.3 CLI and 5.2 API failed`, status: 'error' });
              config.onToken('codex', `\n❌ GPT 5.2 API also failed: ${apiMsg}\n`);
            }
          } else {
            config.onStep({ agent: 'codex', label: `❌ Codex CLI failed: ${msg.slice(0, 80)}`, status: 'error' });
            config.onToken('codex', `\n❌ **Codex CLI failed:** ${msg}\nNo OpenAI API key set as backup.\n`);
          }
        }
      } else {
        // Vercel/web: use GPT 5.2 API — NO Sonnet fallback
        if (!config.openaiKey) {
          config.onStep({ agent: 'codex', label: '❌ No OpenAI API key', status: 'error' });
          config.onToken('codex', '\n❌ **OpenAI API key required** for GPT 5.2 code generation.\nGo to Settings (⚙️) and add your key.\n');
        } else {
          let lastErr = '';
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              if (attempt > 1) {
                config.onStep({ agent: 'codex', label: `GPT 5.2 retry #${attempt}...`, status: 'running' });
              }
              results.code = await callOpenAI(config.openaiKey, 'gpt-5.2', CODEX_SYSTEM, codeMessages, config);
              if (!results.code?.trim()) throw new Error('GPT returned empty output');
              config.onStep({ agent: 'codex', label: 'GPT 5.2 code complete ✓', status: 'done', content: results.code });
              return;
            } catch (err: unknown) {
              lastErr = err instanceof Error ? err.message : 'OpenAI failed';
            }
          }
          config.onStep({ agent: 'codex', label: `❌ GPT 5.2 failed: ${lastErr.slice(0, 80)}`, status: 'error' });
          config.onToken('codex', `\n❌ **GPT 5.2 failed:** ${lastErr}\n`);
        }
      }
    })());
  }

  await Promise.all(tasks);

  // Step 3: Combine results
  const hasDesign = !!results.design?.trim();
  const hasCode = !!results.code?.trim();

  if (hasDesign && hasCode) {
    // Both agents produced output — quick merge with Sonnet (faster than Opus)
    config.onStep({ agent: 'opus', label: 'Reviewing & combining...', status: 'running' });
    const designSnippet = results.design!.length > 6000 ? results.design!.slice(0, 6000) + '\n... [truncated]' : results.design!;
    const codeSnippet = results.code!.length > 6000 ? results.code!.slice(0, 6000) + '\n... [truncated]' : results.code!;
    const reviewPrompt = `Task: ${plan.summary}\n\n## Design:\n${designSnippet}\n\n## Code:\n${codeSnippet}\n\nMerge into ONE complete response with all code in markdown blocks. Be brief, output the final code.`;

    const finalResponse = await callAnthropic(anthropic, 'claude-sonnet-4-5-20250929', OPUS_REVIEW_SYSTEM,
      [{ role: 'user', content: reviewPrompt }], config, 'opus');
    config.onStep({ agent: 'opus', label: 'Review complete', status: 'done' });
    return finalResponse;
  } else if (hasCode) {
    config.onStep({ agent: 'opus', label: 'Review complete (code only)', status: 'done' });
    return results.code!;
  } else if (hasDesign) {
    config.onStep({ agent: 'opus', label: 'Review complete (design only)', status: 'done' });
    return results.design!;
  } else {
    config.onStep({ agent: 'opus', label: 'No output produced', status: 'error' });
    return plan.summary + '\n\n*No code or design was generated. Check your API keys in Settings.*';
  }
}

// ──── Helpers ────

function buildReviewPrompt(plan: TaskPlan, results: { design?: string; code?: string }, codeAgent: string): string {
  let prompt = `Here are the outputs from the team:\n\n`;
  prompt += `**Task Analysis:** ${plan.summary}\n\n`;

  if (results.design) {
    prompt += `## Sonnet's UI/Design Output:\n${results.design}\n\n`;
  }
  if (results.code) {
    prompt += `## ${codeAgent} Code Output:\n${results.code}\n\n`;
  }

  prompt += `Please combine these into a single, polished response for the user. Resolve any conflicts and present the complete solution.`;
  return prompt;
}

// ──── Codex CLI (GPT 5.3 via ChatGPT auth) ────

function callCodexCLI(prompt: string, config: OrchestratorConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = '';
    const codex = spawn('codex', [
      'exec',
      '-m', 'gpt-5.3-codex',
      prompt,
    ], {
      cwd: process.cwd(),
      shell: true,
    });

    codex.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      result += text;
      config.onToken('codex', text);
    });

    codex.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      result += text;
      config.onToken('codex', text);
    });

    codex.on('close', (code) => {
      if (code === 0 || result.trim()) {
        resolve(result);
      } else {
        reject(new Error(`Codex CLI exited with code ${code}`));
      }
    });

    codex.on('error', (err) => {
      reject(new Error(`Codex CLI spawn error: ${err.message}`));
    });

    // Timeout after 120 seconds
    setTimeout(() => {
      codex.kill();
      if (result.trim()) {
        resolve(result);
      } else {
        reject(new Error('Codex CLI timed out after 120s'));
      }
    }, 120_000);
  });
}

async function callAnthropic(
  client: Anthropic,
  model: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  config: OrchestratorConfig,
  agentName: string
): Promise<string> {
  let result = '';
  const stream = client.messages.stream({
    model,
    max_tokens: 8192,
    system,
    messages: messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if ('text' in delta) {
        result += delta.text;
        config.onToken(agentName, delta.text);
      }
    }
  }
  return result;
}

async function callOpenAI(
  apiKey: string,
  model: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  config: OrchestratorConfig
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_completion_tokens: 8192,
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI API ${res.status}: ${err.slice(0, 200)}`);
  }

  let result = '';
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
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          result += content;
          config.onToken('codex', content);
        }
      } catch { /* skip malformed */ }
    }
  }

  return result;
}
