import { useState, useRef, useCallback } from 'react';
import { RefreshCw, ExternalLink, Globe, Monitor, Tablet, Smartphone, Maximize2 } from 'lucide-react';

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const DEVICES: { mode: DeviceMode; label: string; width: number; height: number; icon: typeof Monitor }[] = [
  { mode: 'desktop', label: 'Desktop', width: 1440, height: 900, icon: Monitor },
  { mode: 'tablet', label: 'Tablet', width: 768, height: 1024, icon: Tablet },
  { mode: 'mobile', label: 'Mobile', width: 375, height: 812, icon: Smartphone },
];

export function PreviewPanel() {
  const [url, setUrl] = useState('');
  const [device, setDevice] = useState<DeviceMode>('desktop');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const refresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const openInNewWindow = useCallback(() => {
    if (!url) return;
    const deviceInfo = DEVICES.find(d => d.mode === device) || DEVICES[0];
    const w = device === 'desktop' ? screen.availWidth : deviceInfo.width + 40;
    const h = device === 'desktop' ? screen.availHeight : deviceInfo.height + 80;
    const left = Math.round((screen.availWidth - w) / 2);
    const top = Math.round((screen.availHeight - h) / 2);
    window.open(
      url,
      'GiuseCoder Preview',
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no,resizable=yes`
    );
  }, [url, device]);

  const currentDevice = DEVICES.find(d => d.mode === device) || DEVICES[0];

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-base shrink-0">
        <Globe className="w-4 h-4 text-accent" />
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">Preview</span>
        <div className="flex-1" />

        {/* Device switcher */}
        <div className="flex items-center bg-overlay rounded p-0.5 gap-0.5">
          {DEVICES.map(d => {
            const Icon = d.icon;
            return (
              <button
                key={d.mode}
                onClick={() => setDevice(d.mode)}
                className={`p-1 rounded transition-colors ${
                  device === d.mode
                    ? 'bg-accent/20 text-accent'
                    : 'text-muted hover:text-text hover:bg-surface'
                }`}
                title={`${d.label} (${d.width}×${d.height})`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>

        <div className="w-px h-4 bg-base" />

        <button onClick={refresh} className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button onClick={openInNewWindow} className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Open in new window">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        {url && (
          <a href={url} target="_blank" rel="noopener" className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Open in browser tab">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* URL bar */}
      <div className="px-2 py-1 border-b border-base shrink-0 flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="http://localhost:3000"
          className="flex-1 bg-overlay border border-base rounded px-2 py-1 text-[11px] text-text placeholder:text-muted/50 focus:outline-none focus:border-accent/50"
          onKeyDown={e => { if (e.key === 'Enter' && iframeRef.current) iframeRef.current.src = url; }}
        />
        {url && (
          <span className="text-[9px] text-muted shrink-0">
            {currentDevice.label} {device !== 'desktop' && `${currentDevice.width}×${currentDevice.height}`}
          </span>
        )}
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-hidden flex items-center justify-center bg-base">
        {url ? (
          <div
            className={`bg-white overflow-hidden transition-all duration-300 ${
              device === 'desktop'
                ? 'w-full h-full'
                : 'rounded-2xl shadow-2xl border-4 border-gray-800'
            }`}
            style={device !== 'desktop' ? {
              width: `${currentDevice.width}px`,
              height: `${currentDevice.height}px`,
              maxWidth: '100%',
              maxHeight: '100%',
            } : undefined}
          >
            {/* Device notch for mobile */}
            {device === 'mobile' && (
              <div className="h-6 bg-gray-800 flex items-center justify-center">
                <div className="w-20 h-4 bg-gray-900 rounded-b-xl" />
              </div>
            )}
            {/* Device camera bar for tablet */}
            {device === 'tablet' && (
              <div className="h-4 bg-gray-800 flex items-center justify-center">
                <div className="w-2 h-2 bg-gray-600 rounded-full" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={url}
              className="w-full border-0"
              style={{ height: device === 'mobile' ? 'calc(100% - 24px)' : device === 'tablet' ? 'calc(100% - 16px)' : '100%' }}
              title="Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        ) : (
          <div className="text-center">
            <Globe className="w-8 h-8 text-muted/20 mx-auto mb-2" />
            <p className="text-muted text-xs">Enter a URL to preview</p>
            <p className="text-muted/50 text-[10px] mt-1">e.g. http://localhost:3000</p>
          </div>
        )}
      </div>
    </div>
  );
}
