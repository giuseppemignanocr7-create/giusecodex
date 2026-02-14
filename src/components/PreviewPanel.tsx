import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { RefreshCw, ExternalLink, Globe, Monitor, Tablet, Smartphone, Maximize2, Play, Link } from 'lucide-react';
import { useFileStore } from '../stores/fileStore';
import { useChat } from '../stores/chatStore';

type DeviceMode = 'desktop' | 'tablet' | 'mobile';
type PreviewMode = 'auto' | 'url';

const DEVICES: { mode: DeviceMode; label: string; width: number; height: number; icon: typeof Monitor }[] = [
  { mode: 'desktop', label: 'Desktop', width: 1440, height: 900, icon: Monitor },
  { mode: 'tablet', label: 'Tablet', width: 768, height: 1024, icon: Tablet },
  { mode: 'mobile', label: 'Mobile', width: 375, height: 812, icon: Smartphone },
];

// Extract HTML from code blocks in chat messages
function extractHtmlFromMessages(messages: Array<{ content: string }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i].content;
    // Match ```html ... ``` code blocks
    const htmlMatch = content.match(/```html\s*\n([\s\S]*?)```/);
    if (htmlMatch) return htmlMatch[1].trim();
    // Match full HTML documents
    const docMatch = content.match(/(<(!DOCTYPE|html)[\s\S]*<\/html>)/i);
    if (docMatch) return docMatch[1].trim();
  }
  return null;
}

// Build a full HTML document from open files (html + css + js)
function buildFromOpenFiles(files: Array<{ name: string; content: string }>): string | null {
  const htmlFile = files.find(f => f.name.endsWith('.html'));
  if (!htmlFile) return null;
  let html = htmlFile.content;
  const cssFile = files.find(f => f.name.endsWith('.css'));
  const jsFile = files.find(f => f.name.endsWith('.js') && !f.name.endsWith('.config.js'));
  if (cssFile && !html.includes(cssFile.name)) {
    html = html.replace('</head>', `<style>\n${cssFile.content}\n</style>\n</head>`);
  }
  if (jsFile && !html.includes(jsFile.name)) {
    html = html.replace('</body>', `<script>\n${jsFile.content}\n</script>\n</body>`);
  }
  return html;
}

export function PreviewPanel() {
  const [url, setUrl] = useState('');
  const [device, setDevice] = useState<DeviceMode>('desktop');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('auto');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const openFiles = useFileStore(s => s.openFiles);
  const chatMessages = useChat(s => s.messages);

  // Auto-generate preview content from open files or chat
  const autoContent = useMemo(() => {
    // First try open files
    const fromFiles = buildFromOpenFiles(openFiles);
    if (fromFiles) return fromFiles;
    // Then try chat messages
    const fromChat = extractHtmlFromMessages(chatMessages);
    if (fromChat) return fromChat;
    return null;
  }, [openFiles, chatMessages]);

  const hasContent = previewMode === 'auto' ? !!autoContent : !!url;

  const refresh = () => {
    if (iframeRef.current) {
      if (previewMode === 'url') {
        iframeRef.current.src = iframeRef.current.src;
      } else {
        // Force re-render srcdoc
        const el = iframeRef.current;
        const doc = el.srcdoc;
        el.srcdoc = '';
        requestAnimationFrame(() => { el.srcdoc = doc; });
      }
    }
  };

  const openInNewWindow = useCallback(() => {
    if (previewMode === 'url' && url) {
      window.open(url, 'GiuseCoder Preview', 'width=800,height=900');
    } else if (autoContent) {
      const win = window.open('', 'GiuseCoder Preview', 'width=800,height=900');
      if (win) { win.document.write(autoContent); win.document.close(); }
    }
  }, [url, autoContent, previewMode]);

  const currentDevice = DEVICES.find(d => d.mode === device) || DEVICES[0];

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-base shrink-0">
        <Globe className="w-3.5 h-3.5 text-accent" />
        <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Preview</span>
        <div className="flex-1" />

        {/* Auto / URL toggle */}
        <div className="flex items-center bg-overlay rounded p-0.5 gap-0.5 mr-1">
          <button
            onClick={() => setPreviewMode('auto')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
              previewMode === 'auto' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'
            }`}
            title="Auto preview — renders code from editor/chat"
          >
            <Play className="w-3 h-3" />
            Auto
          </button>
          <button
            onClick={() => setPreviewMode('url')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
              previewMode === 'url' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'
            }`}
            title="URL preview — load external URL"
          >
            <Link className="w-3 h-3" />
            URL
          </button>
        </div>

        {/* Device switcher */}
        <div className="flex items-center bg-overlay rounded p-0.5 gap-0.5">
          {DEVICES.map(d => {
            const Icon = d.icon;
            return (
              <button
                key={d.mode}
                onClick={() => setDevice(d.mode)}
                className={`p-0.5 rounded transition-colors ${
                  device === d.mode ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text hover:bg-surface'
                }`}
                title={`${d.label} (${d.width}×${d.height})`}
              >
                <Icon className="w-3 h-3" />
              </button>
            );
          })}
        </div>

        <button onClick={refresh} className="p-0.5 text-muted hover:text-text rounded hover:bg-overlay" title="Refresh">
          <RefreshCw className="w-3 h-3" />
        </button>
        <button onClick={openInNewWindow} className="p-0.5 text-muted hover:text-text rounded hover:bg-overlay" title="Open in new window">
          <Maximize2 className="w-3 h-3" />
        </button>
      </div>

      {/* URL bar (only in URL mode) */}
      {previewMode === 'url' && (
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
      )}

      {/* Preview area */}
      <div className="flex-1 overflow-hidden flex items-center justify-center bg-base">
        {hasContent ? (
          <div
            className={`bg-white overflow-hidden transition-all duration-300 ${
              device === 'desktop' ? 'w-full h-full' : 'rounded-2xl shadow-2xl border-4 border-gray-800'
            }`}
            style={device !== 'desktop' ? {
              width: `${currentDevice.width}px`,
              height: `${currentDevice.height}px`,
              maxWidth: '100%',
              maxHeight: '100%',
            } : undefined}
          >
            {device === 'mobile' && (
              <div className="h-5 bg-gray-800 flex items-center justify-center">
                <div className="w-16 h-3 bg-gray-900 rounded-b-lg" />
              </div>
            )}
            {device === 'tablet' && (
              <div className="h-3 bg-gray-800 flex items-center justify-center">
                <div className="w-2 h-2 bg-gray-600 rounded-full" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={previewMode === 'url' ? url : undefined}
              srcDoc={previewMode === 'auto' ? (autoContent || '') : undefined}
              className="w-full border-0"
              style={{ height: device === 'mobile' ? 'calc(100% - 20px)' : device === 'tablet' ? 'calc(100% - 12px)' : '100%' }}
              title="Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        ) : (
          <div className="text-center px-4">
            <Globe className="w-6 h-6 text-muted/20 mx-auto mb-2" />
            {previewMode === 'auto' ? (
              <>
                <p className="text-muted text-[11px]">Auto preview is active</p>
                <p className="text-muted/50 text-[10px] mt-1">Open an HTML file or ask the AI to generate a page</p>
              </>
            ) : (
              <>
                <p className="text-muted text-[11px]">Enter a URL to preview</p>
                <p className="text-muted/50 text-[10px] mt-1">e.g. http://localhost:3000</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
