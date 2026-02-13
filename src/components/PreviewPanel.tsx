import { useState, useRef } from 'react';
import { RefreshCw, ExternalLink, Globe } from 'lucide-react';

export function PreviewPanel() {
  const [url, setUrl] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const refresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-base shrink-0">
        <Globe className="w-4 h-4 text-accent" />
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">Preview</span>
        <div className="flex-1" />
        <button onClick={refresh} className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        {url && (
          <a href={url} target="_blank" rel="noopener" className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Open in browser">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
      <div className="px-2 py-1 border-b border-base shrink-0">
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="http://localhost:3000"
          className="w-full bg-overlay border border-base rounded px-2 py-1 text-[11px] text-text placeholder:text-muted/50 focus:outline-none focus:border-accent/50"
          onKeyDown={e => { if (e.key === 'Enter' && iframeRef.current) iframeRef.current.src = url; }}
        />
      </div>
      <div className="flex-1 bg-white">
        {url ? (
          <iframe ref={iframeRef} src={url} className="w-full h-full border-0" title="Preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        ) : (
          <div className="h-full flex items-center justify-center bg-base">
            <div className="text-center">
              <Globe className="w-8 h-8 text-muted/20 mx-auto mb-2" />
              <p className="text-muted text-xs">Enter a URL to preview</p>
              <p className="text-muted/50 text-[10px] mt-1">e.g. http://localhost:3000</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
