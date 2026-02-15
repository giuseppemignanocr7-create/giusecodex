import { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, Trash2, RotateCcw } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Detect if running via Vercel (serverless = no terminal backend)
const isServerless = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app');

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = () => {
    if (!containerRef.current) return;

    // Cleanup previous
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (termRef.current) { termRef.current.dispose(); termRef.current = null; }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      theme: {
        background: '#0d0d1a',
        foreground: '#e0e0e0',
        cursor: '#7c5cff',
        selectionBackground: '#7c5cff33',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    if (isServerless) {
      term.writeln('\x1b[33m⚠ Terminal not available on serverless deployments\x1b[0m');
      term.writeln('\x1b[90mDeploy to a VPS (e.g. Hetzner) for full terminal access.\x1b[0m');
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.writeln('\x1b[32m● Connected to GiuseCoder Terminal\x1b[0m');
      term.writeln('');
    };

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        term.write(e.data);
      } else if (e.data instanceof Blob) {
        e.data.text().then(text => term.write(text));
      }
    };

    ws.onclose = () => {
      setConnected(false);
      term.writeln('\r\n\x1b[31m● Disconnected\x1b[0m');
    };

    ws.onerror = () => {
      setConnected(false);
      term.writeln('\r\n\x1b[31m● Connection error\x1b[0m');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  };

  useEffect(() => {
    connect();

    const onResize = () => { fitRef.current?.fit(); };
    window.addEventListener('resize', onResize);

    // Also fit when panel resizes
    const observer = new ResizeObserver(() => { fitRef.current?.fit(); });
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      wsRef.current?.close();
      termRef.current?.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClear = () => {
    termRef.current?.clear();
  };

  const handleReconnect = () => {
    connect();
  };

  return (
    <div className="h-full flex flex-col bg-[#0d0d1a]">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border-b border-base shrink-0">
        <TerminalIcon className="w-3.5 h-3.5 text-green" />
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">Terminal</span>
        <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green' : 'bg-red-500'}`} />
        <div className="flex-1" />
        <button onClick={handleClear} className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Clear">
          <Trash2 className="w-3 h-3" />
        </button>
        <button onClick={handleReconnect} className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Reconnect">
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
