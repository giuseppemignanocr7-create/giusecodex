import { app, BrowserWindow, shell, session, dialog } from 'electron';
import path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';
import express from 'express';
import cors from 'cors';
import http from 'http';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let httpServer: http.Server | null = null;
const SERVER_PORT = 4000;
const isDev = !app.isPackaged;

// ──── Check if Codex CLI is available ────
function hasCodexCLI(): boolean {
  try {
    execSync('codex --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ──── Start embedded Express server (packaged mode) ────
function startEmbeddedServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const distPath = path.join(app.getAppPath() + '.unpacked', 'dist');
    const srv = express();
    srv.use(cors());
    srv.use(express.json({ limit: '10mb' }));

    // Serve frontend static files
    srv.use(express.static(distPath));

    // Health check
    srv.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', codex: hasCodexCLI(), embedded: true });
    });

    // SPA catch-all — serve index.html for all non-API routes
    srv.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    httpServer = srv.listen(SERVER_PORT, () => {
      console.log(`[GiuseCoder] Embedded server on http://localhost:${SERVER_PORT}`);
      console.log(`[GiuseCoder] Static dir: ${distPath}`);
      resolve();
    });
    httpServer.on('error', reject);
  });
}

// ──── Start dev server (dev mode only) ────
function startDevServer(): void {
  const serverEntry = path.join(__dirname, '..', 'server', 'index.ts');
  serverProcess = spawn('npx', ['tsx', serverEntry], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      CODEX_AVAILABLE: hasCodexCLI() ? '1' : '0',
    },
    shell: true,
    stdio: 'pipe',
  });
  serverProcess.stdout?.on('data', (d: Buffer) => console.log('[server]', d.toString().trim()));
  serverProcess.stderr?.on('data', (d: Buffer) => console.error('[server]', d.toString().trim()));
}

// ──── Wait for dev server to be ready ────
async function waitForServer(maxRetries = 30): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://localhost:${SERVER_PORT}/api/health`);
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// ──── Create main window ────
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'GiuseCoder IDE',
    icon: path.join(__dirname, '..', 'public', 'favicon.ico'),
    backgroundColor: '#1a1b26',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
  }

  // Handle window.open: allow preview popups, external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('https://localhost')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 800,
          height: 900,
          title: 'GiuseCoder Preview',
          backgroundColor: '#ffffff',
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ──── App lifecycle ────
app.whenReady().then(async () => {
  console.log('[GiuseCoder] Starting...');
  console.log('[GiuseCoder] Dev mode:', isDev);
  console.log('[GiuseCoder] App path:', app.getAppPath());

  try {
    if (isDev) {
      startDevServer();
      await waitForServer();
    } else {
      await startEmbeddedServer();
    }
    console.log('[GiuseCoder] Server ready');
  } catch (err: any) {
    console.error('[GiuseCoder] Server error:', err.message);
    dialog.showErrorBox('Server Error', `Failed to start server: ${err.message}`);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  if (httpServer) { httpServer.close(); httpServer = null; }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  if (httpServer) { httpServer.close(); httpServer = null; }
});
