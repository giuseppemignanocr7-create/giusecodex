import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;

// ──── Resolve dist path ────
function getDistPath(): string {
  if (isDev) return '';
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

// ──── Create main window ────
function createWindow(): void {
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
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const distPath = getDistPath();
    const indexPath = path.join(distPath, 'index.html');
    console.log('[GiuseCoder] Loading:', indexPath);
    console.log('[GiuseCoder] Exists:', fs.existsSync(indexPath));
    mainWindow.loadFile(indexPath);
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
app.whenReady().then(() => {
  console.log('[GiuseCoder] Starting...');
  console.log('[GiuseCoder] Packaged:', app.isPackaged);
  console.log('[GiuseCoder] App path:', app.getAppPath());
  console.log('[GiuseCoder] Exe path:', process.execPath);
  console.log('[GiuseCoder] Dist path:', getDistPath());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
