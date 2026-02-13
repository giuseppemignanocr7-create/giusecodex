import Anthropic from '@anthropic-ai/sdk';

// ──── Types ────

export interface OrchestratorConfig {
  anthropicKey: string;
  openaiKey: string;
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

const OPUS_SYSTEM = `You are GiuseCoder Opus, the CTO and lead architect.
Your role:
1. ANALYZE the user's request
2. PLAN: decide if it needs UI/design work (Sonnet) and/or code (Codex GPT 5.3)
3. DELEGATE: create clear prompts for each agent
4. REVIEW: combine their outputs and give the final answer

You MUST respond with a JSON plan in this exact format:
\`\`\`json
{
  "summary": "Brief analysis of what the user wants",
  "needsDesign": true/false,
  "needsCode": true/false,
  "designPrompt": "Detailed prompt for Sonnet (UI/CSS/layout/design). Empty string if not needed.",
  "codePrompt": "Detailed prompt for GPT 5.3 Codex (implementation/logic/backend). Empty string if not needed."
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
    // If Opus didn't give JSON, return directly (simple answer)
    return planResponse;
  }

  // Simple question — Opus answers directly
  if (!plan.needsDesign && !plan.needsCode) {
    return plan.summary;
  }

  // Step 2: Delegate to agents (parallel when both needed)
  const results: { design?: string; code?: string } = {};

  const tasks: Promise<void>[] = [];

  if (plan.needsDesign) {
    tasks.push((async () => {
      config.onStep({ agent: 'sonnet', label: 'Sonnet designing UI...', status: 'running' });
      const designMessages = [...messages, { role: 'user', content: plan.designPrompt }];
      results.design = await callAnthropic(anthropic, 'claude-sonnet-4-20250514', SONNET_SYSTEM, designMessages, config, 'sonnet');
      config.onStep({ agent: 'sonnet', label: 'Sonnet design complete', status: 'done', content: results.design });
    })());
  }

  if (plan.needsCode) {
    tasks.push((async () => {
      config.onStep({ agent: 'codex', label: 'GPT 5.3 Codex writing code...', status: 'running' });
      results.code = await callCodexCLI(plan.codePrompt, config);
      config.onStep({ agent: 'codex', label: 'GPT 5.3 Codex complete', status: 'done', content: results.code });
    })());
  }

  await Promise.all(tasks);

  // Step 3: Opus reviews and combines
  config.onStep({ agent: 'opus', label: 'Opus reviewing & combining...', status: 'running' });

  const reviewPrompt = buildReviewPrompt(plan, results);
  const reviewMessages = [...messages, { role: 'user', content: reviewPrompt }];
  const finalResponse = await callAnthropic(anthropic, 'claude-opus-4-6', OPUS_REVIEW_SYSTEM, reviewMessages, config, 'opus');

  config.onStep({ agent: 'opus', label: 'Final review complete', status: 'done' });

  return finalResponse;
}

// ──── Helpers ────

function buildReviewPrompt(plan: TaskPlan, results: { design?: string; code?: string }): string {
  let prompt = `Here are the outputs from the team:\n\n`;
  prompt += `**Task Analysis:** ${plan.summary}\n\n`;

  if (results.design) {
    prompt += `## Sonnet's UI/Design Output:\n${results.design}\n\n`;
  }
  if (results.code) {
    prompt += `## GPT 5.3 Codex Code Output:\n${results.code}\n\n`;
  }

  prompt += `Please combine these into a single, polished response for the user. Resolve any conflicts and present the complete solution.`;
  return prompt;
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

async function callCodexCLI(
  prompt: string,
  config: OrchestratorConfig
): Promise<string> {
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    let result = '';
    const codex = spawn('codex', [
      'exec',
      '-m', 'gpt-5.3-codex',
      prompt,
    ], { shell: true, cwd: process.cwd() });

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

    codex.on('close', (code: number | null) => {
      if (code === 0 || result.length > 0) {
        resolve(result);
      } else {
        reject(new Error(`Codex CLI exited with code ${code}`));
      }
    });

    codex.on('error', (err: Error) => {
      reject(new Error(`Codex CLI error: ${err.message}`));
    });
  });
}
