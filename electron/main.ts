import { app, BrowserWindow, shell, session } from 'electron';
import path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
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

// ──── Start Express server ────
function startServer(): void {
  const env = {
    ...process.env,
    PORT: String(SERVER_PORT),
    CODEX_AVAILABLE: hasCodexCLI() ? '1' : '0',
    STATIC_DIR: isDev ? '' : path.join(app.getAppPath(), 'dist'),
  };

  if (isDev) {
    const serverEntry = path.join(__dirname, '..', 'server', 'index.ts');
    serverProcess = spawn('npx', ['tsx', serverEntry], {
      cwd: path.join(__dirname, '..'),
      env,
      shell: true,
      stdio: 'pipe',
    });
  } else {
    // In packaged mode, use npx tsx from the system PATH
    const serverEntry = path.join(process.resourcesPath, 'server', 'index.ts');
    serverProcess = spawn('npx', ['tsx', serverEntry], {
      cwd: process.resourcesPath,
      env,
      shell: true,
      stdio: 'pipe',
    });
  }

  serverProcess.stdout?.on('data', (d: Buffer) => console.log('[server]', d.toString().trim()));
  serverProcess.stderr?.on('data', (d: Buffer) => console.error('[server]', d.toString().trim()));
  serverProcess.on('error', (err) => console.error('[server] Failed to start:', err.message));
}

// ──── Wait for server to be ready ────
async function waitForServer(maxRetries = 40): Promise<boolean> {
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
      webSecurity: true,
    },
  });

  // Always load from Express server so API calls (/api/*) work correctly
  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Handle window.open: allow preview popups, external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('https://localhost')) {
      // Allow preview popups to open as new Electron windows
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
    // External URLs open in system browser
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
  console.log('[GiuseCoder] Codex CLI:', hasCodexCLI() ? 'GPT 5.3 available' : 'Not found, using GPT 5.2-codex API');

  // Allow CORS for API calls
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
      },
    });
  });

  startServer();

  const serverReady = await waitForServer();
  if (serverReady) {
    console.log('[GiuseCoder] Server ready on port', SERVER_PORT);
  } else {
    console.error('[GiuseCoder] Server failed to start within timeout');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
