import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, execSync as execSyncFn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { orchestrate } from './orchestrator';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ──── Path sandboxing ────
let PROJECT_ROOT = process.cwd();

function safePath(userPath: string): string | null {
  if (!userPath) return null;
  const resolved = path.resolve(PROJECT_ROOT, userPath);
  // Ensure the resolved path is inside the project root
  if (!resolved.startsWith(PROJECT_ROOT)) return null;
  return resolved;
}

// Allow overriding root via POST /api/set-root (only from localhost)
app.post('/api/set-root', (req, res) => {
  const { root } = req.body;
  if (!root) return res.status(400).json({ error: 'root required' });
  PROJECT_ROOT = path.resolve(root);
  res.json({ ok: true, root: PROJECT_ROOT });
});

// Auto-detect codex CLI availability
let codexAvailable = process.env.CODEX_AVAILABLE === '1';
if (!codexAvailable) {
  try {
    execSyncFn('codex --version', { stdio: 'ignore' });
    codexAvailable = true;
  } catch {
    codexAvailable = false;
  }
}

// ──── Serve frontend static files (Electron packaged mode) ────
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  app.use(express.static(staticDir));
}

// ──── File System API ────

app.get('/api/files/tree', async (req, res) => {
  const raw = (req.query.path as string) || '.';
  const dirPath = safePath(raw);
  if (!dirPath) return res.status(403).json({ error: 'Path outside project root' });
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
  const raw = req.query.path as string;
  if (!raw) return res.status(400).json({ error: 'path required' });
  const filePath = safePath(raw);
  if (!filePath) return res.status(403).json({ error: 'Path outside project root' });
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ content });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/files/write', async (req, res) => {
  const { path: rawPath, content } = req.body;
  if (!rawPath) return res.status(400).json({ error: 'path required' });
  const filePath = safePath(rawPath);
  if (!filePath) return res.status(403).json({ error: 'Path outside project root' });
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/files/create', async (req, res) => {
  const { path: rawPath, type } = req.body;
  const filePath = safePath(rawPath);
  if (!filePath) return res.status(403).json({ error: 'Path outside project root' });
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
  const raw = req.query.path as string;
  if (!raw) return res.status(400).json({ error: 'path required' });
  const filePath = safePath(raw);
  if (!filePath) return res.status(403).json({ error: 'Path outside project root' });
  // Prevent deleting the project root itself
  if (filePath === PROJECT_ROOT) return res.status(403).json({ error: 'Cannot delete project root' });
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
          model: model || 'gpt-5.2',
          messages: [{ role: 'system', content: system }, ...messages],
          max_completion_tokens: 8192,
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
    '--',
    prompt,
  ], {
    cwd: process.cwd(),
    shell: false,
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
  const { messages, anthropicKey, openaiKey, chatMode, projectContext } = req.body;

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
      chatMode: chatMode || 'code',
      useCodexCLI: codexAvailable,
      projectContext: projectContext || '',
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

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    codex: codexAvailable,
    codeModel: codexAvailable ? 'gpt-5.3-codex (CLI)' : 'gpt-5.2 (API)',
  });
});

// ──── SPA catch-all (Electron packaged mode) ────
if (staticDir) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

// ──── Project Search API ────

app.get('/api/files/search', async (req, res) => {
  const query = (req.query.q as string || '').trim();
  const ext = (req.query.ext as string || '').trim();
  if (!query) return res.status(400).json({ error: 'q required' });

  const results: Array<{ file: string; line: number; text: string }> = [];
  const ignore = new Set(['node_modules', '.git', 'dist', 'out', '.next', '__pycache__', '.vscode']);
  const binaryExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'pdf', 'zip', 'tar', 'gz']);
  const MAX_RESULTS = 200;

  async function searchDir(dir: string, depth: number): Promise<void> {
    if (depth > 6 || results.length >= MAX_RESULTS) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) break;
      if (ignore.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await searchDir(full, depth + 1);
      } else {
        const fileExt = entry.name.split('.').pop()?.toLowerCase() || '';
        if (binaryExts.has(fileExt)) continue;
        if (ext && fileExt !== ext.replace('.', '')) continue;
        try {
          const content = await fs.readFile(full, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              results.push({ file: path.relative(PROJECT_ROOT, full), line: i + 1, text: lines[i].trim().slice(0, 200) });
            }
          }
        } catch { /* skip unreadable */ }
      }
    }
  }

  try {
    await searchDir(PROJECT_ROOT, 0);
    res.json({ results, truncated: results.length >= MAX_RESULTS });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ──── Terminal Exec (for agent tool loop) ────

app.post('/api/terminal/exec', (req, res) => {
  const { command, timeout = 15000 } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });

  const isWin = process.platform === 'win32';
  const shell = isWin ? 'powershell.exe' : '/bin/bash';
  const args = isWin ? ['-NoProfile', '-Command', command] : ['-c', command];

  let stdout = '';
  let stderr = '';
  const child = spawn(shell, args, { cwd: PROJECT_ROOT, shell: false, timeout: timeout as number });

  child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
  child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
  child.on('close', (code) => {
    res.json({ exitCode: code, stdout: stdout.slice(0, 50000), stderr: stderr.slice(0, 10000) });
  });
  child.on('error', (err: Error) => {
    res.status(500).json({ error: err.message });
  });
});

// ──── Git API ────

function runGit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: PROJECT_ROOT, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (err: Error) => resolve({ code: 1, stdout: '', stderr: err.message }));
  });
}

app.get('/api/git/status', async (_req, res) => {
  const r = await runGit(['status', '--porcelain']);
  if (r.code !== 0 && r.stderr.includes('not a git repository')) {
    return res.json({ isRepo: false, files: [] });
  }
  const files = r.stdout.trim().split('\n').filter(Boolean).map(line => ({
    status: line.slice(0, 2).trim(),
    file: line.slice(3),
  }));
  const branch = await runGit(['branch', '--show-current']);
  res.json({ isRepo: true, branch: branch.stdout.trim(), files });
});

app.post('/api/git/commit', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  await runGit(['add', '-A']);
  const r = await runGit(['commit', '-m', message]);
  res.json({ ok: r.code === 0, output: r.stdout + r.stderr });
});

app.post('/api/git/push', async (_req, res) => {
  const r = await runGit(['push']);
  res.json({ ok: r.code === 0, output: r.stdout + r.stderr });
});

app.get('/api/git/log', async (_req, res) => {
  const r = await runGit(['log', '--oneline', '-20']);
  const commits = r.stdout.trim().split('\n').filter(Boolean).map(line => {
    const [hash, ...rest] = line.split(' ');
    return { hash, message: rest.join(' ') };
  });
  res.json({ commits });
});

app.get('/api/git/diff', async (req, res) => {
  const file = req.query.file as string;
  const args = file ? ['diff', '--', file] : ['diff'];
  const r = await runGit(args);
  res.json({ diff: r.stdout });
});

// ──── Start ────

const PORT = parseInt(process.env.PORT || '4000');
const HOST = process.env.HOST || '127.0.0.1';
const server = http.createServer(app);

// ──── WebSocket Terminal ────

const wss = new WebSocketServer({ server, path: '/ws/terminal' });

wss.on('connection', (ws: WebSocket) => {
  const isWin = process.platform === 'win32';
  const shell = isWin ? 'powershell.exe' : '/bin/bash';
  const shellArgs = isWin ? ['-NoProfile', '-NoLogo'] : [];

  const pty = spawn(shell, shellArgs, {
    cwd: PROJECT_ROOT,
    shell: false,
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  pty.stdout.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
  pty.stderr.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  ws.on('message', (msg: Buffer | string) => {
    const text = msg.toString();
    // Handle resize messages
    if (text.startsWith('\x01RESIZE:')) {
      // Resize not supported with spawn (would need node-pty)
      return;
    }
    pty.stdin.write(text);
  });

  ws.on('close', () => {
    pty.kill();
  });

  pty.on('close', () => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`GiuseCoder server running on http://${HOST}:${PORT}`);
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Code agent: ${codexAvailable ? 'GPT 5.3 Codex (CLI)' : 'GPT 5.2 (API fallback)'}`);
});
