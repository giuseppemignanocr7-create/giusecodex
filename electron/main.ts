import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import { execSync, fork, ChildProcess } from 'child_process';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
const isDev = !app.isPackaged;
const SERVER_PORT = 4000;

// ──── Detect Codex CLI ────
function detectCodexCLI(): boolean {
  try {
    execSync('codex --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ──── Resolve dist path ────
function getDistPath(): string {
  if (isDev) return path.join(app.getAppPath(), 'dist');
  // asar unpacked
  const p1 = path.join(app.getAppPath() + '.unpacked', 'dist');
  if (fs.existsSync(p1)) return p1;
  // inside asar (fallback)
  const p2 = path.join(app.getAppPath(), 'dist');
  if (fs.existsSync(p2)) return p2;
  // next to exe
  const p3 = path.join(path.dirname(process.execPath), 'resources', 'dist');
  if (fs.existsSync(p3)) return p3;
  return p2;
}

// ──── Resolve server entry ────
function getServerEntry(): string {
  // In packaged mode, use bundled server
  const bundled = path.join(app.getAppPath(), 'server', 'bundle.cjs');
  if (fs.existsSync(bundled)) return bundled;
  // Dev fallback: tsx will run the TS source directly
  return path.join(app.getAppPath(), 'server', 'index.ts');
}

// ──── Start Express server ────
function startServer(): void {
  const codexAvailable = detectCodexCLI();
  const distPath = getDistPath();
  const entry = getServerEntry();

  console.log('[GiuseCoder] Server entry:', entry);
  console.log('[GiuseCoder] Codex CLI:', codexAvailable ? 'available ✔' : 'not found');
  console.log('[GiuseCoder] Static dir:', distPath);

  const env = {
    ...process.env,
    PORT: String(SERVER_PORT),
    CODEX_AVAILABLE: codexAvailable ? '1' : '0',
    STATIC_DIR: isDev ? '' : distPath,
  };

  if (entry.endsWith('.ts')) {
    // Dev mode: run via tsx
    const tsxBin = path.join(app.getAppPath(), 'node_modules', '.bin', 'tsx');
    serverProcess = fork(tsxBin, [entry], {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      execArgv: [],
    });
  } else {
    // Packaged: run bundled CJS directly
    serverProcess = fork(entry, [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
  }

  serverProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log('[Server]', msg);
    if (msg.includes('running on') && mainWindow) {
      mainWindow.webContents.send('server-status', 'ready');
    }
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[Server Error]', data.toString().trim());
  });

  serverProcess.on('exit', (code) => {
    console.log('[GiuseCoder] Server exited with code', code);
    serverProcess = null;
  });
}

function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// ──── Create main window ────
function createWindow(): void {
  const codexAvailable = detectCodexCLI();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'GiuseCoder IDE',
    backgroundColor: '#1a1b26',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    // In dev, Vite is on 5173 and proxies /api to Express on 4000
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Packaged: Express serves static files + API on same port
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
  }

  // Handle window.open: allow preview popups and blob: URLs
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('https://localhost') || url.startsWith('blob:')) {
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

// ──── IPC handlers ────
ipcMain.handle('get-server-info', () => ({
  port: SERVER_PORT,
  codexAvailable: detectCodexCLI(),
  codeModel: detectCodexCLI() ? 'gpt-5.3-codex (CLI)' : 'gpt-5.2 (API)',
}));

// ──── App lifecycle ────
app.whenReady().then(() => {
  console.log('[GiuseCoder] Starting...');
  console.log('[GiuseCoder] Packaged:', app.isPackaged);
  console.log('[GiuseCoder] App path:', app.getAppPath());
  console.log('[GiuseCoder] Exe path:', process.execPath);
  console.log('[GiuseCoder] Dist path:', getDistPath());

  // Start Express server in packaged mode
  // In dev mode, server is started separately via npm run dev:server
  if (!isDev) {
    startServer();
  }

  // Wait a moment for server to start in packaged mode
  const delay = isDev ? 0 : 1500;
  setTimeout(() => createWindow(), delay);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopServer();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});
