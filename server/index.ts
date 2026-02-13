import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { orchestrate } from './orchestrator';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ──── File System API ────

app.get('/api/files/tree', async (req, res) => {
  const dirPath = (req.query.path as string) || '.';
  try {
    const tree = await buildTree(dirPath, 0);
    res.json(tree);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

interface TreeNode {
  name: string;
  path: string;
  type: string;
  children?: TreeNode[];
  expanded?: boolean;
}

async function buildTree(dirPath: string, depth: number): Promise<TreeNode[]> {
  if (depth > 4) return [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes: TreeNode[] = [];

  const ignore = new Set(['node_modules', '.git', 'dist', 'out', '.next', '__pycache__', '.vscode']);

  for (const entry of entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  })) {
    if (ignore.has(entry.name) || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, depth + 1);
      nodes.push({ name: entry.name, path: fullPath, type: 'directory', children, expanded: depth === 0 });
    } else {
      nodes.push({ name: entry.name, path: fullPath, type: 'file' });
    }
  }
  return nodes;
}

app.get('/api/files/read', async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ content });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/files/write', async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/files/create', async (req, res) => {
  const { path: filePath, type } = req.body;
  try {
    if (type === 'directory') {
      await fs.mkdir(filePath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, '', 'utf-8');
    }
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/files/delete', async (req, res) => {
  const filePath = req.query.path as string;
  try {
    await fs.rm(filePath, { recursive: true });
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ──── Verify API Keys ────

app.post('/api/verify-key', async (req, res) => {
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
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.json({ valid: false, error: msg });
  }
});

// ──── AI Chat API (streaming) ────

app.post('/api/chat', async (req, res) => {
  const { messages, model, apiKey, systemPrompt, provider } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }

  const system = systemPrompt || `You are GiuseCoder, a premium AI coding assistant.
You write clean, idiomatic, production-ready code.
When modifying code, output the complete changed code with file paths.
Be concise and direct. Use markdown with code blocks.`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    if (provider === 'openai') {
      // ── OpenAI GPT streaming ──
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
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
        res.end();
        return;
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
              } catch { /* skip malformed */ }
            }
          }
        }
      }
      res.end();
    } else {
      // ── Anthropic Claude streaming ──
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
          if ('text' in delta) {
            res.write(delta.text);
          }
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
});

// ──── Codex CLI Chat (GPT 5.3 via ChatGPT auth) ────

app.post('/api/chat/codex', async (req, res) => {
  const { prompt, model } = req.body;

  if (!prompt) return res.status(400).json({ error: 'Prompt required' });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const { spawn } = await import('child_process');
  const codex = spawn('codex', [
    'exec',
    '-m', model || 'gpt-5.3-codex',
    prompt,
  ], {
    cwd: process.cwd(),
    shell: true,
  });

  codex.stdout.on('data', (data: Buffer) => {
    res.write(data.toString());
  });

  codex.stderr.on('data', (data: Buffer) => {
    res.write(data.toString());
  });

  codex.on('close', () => {
    res.end();
  });

  codex.on('error', (err: Error) => {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`\n\n**Error:** ${err.message}`);
      res.end();
    }
  });
});

// ──── Orchestrated Chat (Opus → Sonnet + Codex → Opus review) ────

app.post('/api/chat/orchestrate', async (req, res) => {
  const { messages, anthropicKey, openaiKey } = req.body;

  if (!anthropicKey) {
    return res.status(400).json({ error: 'Anthropic API key required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (type: string, data: unknown) => {
    res.write(`data: ${JSON.stringify({ type, ...data as Record<string, unknown> })}\n\n`);
  };

  try {
    const result = await orchestrate(messages, {
      anthropicKey,
      openaiKey: openaiKey || '',
      onStep: (step) => {
        sendEvent('step', { agent: step.agent, label: step.label, status: step.status });
      },
      onToken: (agent, text) => {
        sendEvent('token', { agent, text });
      },
    });

    sendEvent('done', { content: result });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    sendEvent('error', { message: msg });
    res.end();
  }
});

// ──── Health Check + Info ────

const codexAvailable = process.env.CODEX_AVAILABLE === '1';

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    codex: codexAvailable,
    codeModel: codexAvailable ? 'gpt-5.3-codex (CLI)' : 'gpt-5.2-codex (API)',
  });
});

// ──── Start ────

const PORT = parseInt(process.env.PORT || '4000');
app.listen(PORT, () => {
  console.log(`GiuseCoder server running on http://localhost:${PORT}`);
  console.log(`Code agent: ${codexAvailable ? 'GPT 5.3 Codex (CLI)' : 'GPT 5.2-codex (API fallback)'}`);
});
