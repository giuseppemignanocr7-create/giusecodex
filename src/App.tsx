import { useEffect, useRef, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { FileTree } from './components/FileTree';
import { EditorTabs } from './components/EditorTabs';
import { ChatPanel } from './components/ChatPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { Toolbar } from './components/Toolbar';
import { SettingsPanel } from './components/SettingsPanel';
import { useSettings } from './stores/settingsStore';
import { useChat } from './stores/chatStore';
import { Terminal as TerminalIcon, Globe } from 'lucide-react';

function containsPreviewableHtml(content: string): boolean {
  return /```html\s*[\r\n][\s\S]*?```/i.test(content) || /<(!DOCTYPE|html)[\s\S]*<\/html>/i.test(content);
}

export function App() {
  const [showChat, setShowChat] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [showFiles, setShowFiles] = useState(true);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'preview'>('terminal');
  const messages = useChat((s) => s.messages);
  const isStreaming = useChat((s) => s.isStreaming);
  const lastAutoPreviewMessageIdRef = useRef<string>('');

  const settingsOpen = useSettings((s) => s.isOpen);
  const showBottom = showTerminal || showPreview;

  useEffect(() => {
    if (isStreaming || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last || last.role === 'user' || last.id === lastAutoPreviewMessageIdRef.current) return;
    if (!containsPreviewableHtml(last.content)) return;

    lastAutoPreviewMessageIdRef.current = last.id;
    if (!showPreview) setShowPreview(true);
    setBottomTab('preview');
  }, [messages, isStreaming, showPreview]);

  return (
    <div className="h-screen w-screen flex flex-col bg-base text-text">
      {settingsOpen && <SettingsPanel />}
      {/* Top Toolbar */}
      <Toolbar
        showFiles={showFiles} toggleFiles={() => setShowFiles(!showFiles)}
        showChat={showChat} toggleChat={() => setShowChat(!showChat)}
        showPreview={showPreview} togglePreview={() => setShowPreview(!showPreview)}
        showTerminal={showTerminal} toggleTerminal={() => setShowTerminal(!showTerminal)}
      />

      {/* Main Content */}
      <PanelGroup direction="horizontal" className="flex-1">
        {/* File Tree */}
        {showFiles && (
          <>
            <Panel defaultSize={13} minSize={9} maxSize={22}>
              <FileTree />
            </Panel>
            <PanelResizeHandle className="w-1 bg-base hover:bg-accent transition-colors cursor-col-resize" />
          </>
        )}

        {/* Center: Editor + Bottom panels (Terminal/Preview) */}
        <Panel defaultSize={showChat ? 52 : 75} minSize={28}>
          <PanelGroup direction="vertical">
            <Panel defaultSize={showBottom ? 65 : 100} minSize={25}>
              <EditorTabs />
            </Panel>
            {showBottom && (
              <>
                <PanelResizeHandle className="h-1 bg-base hover:bg-accent transition-colors cursor-row-resize" />
                <Panel defaultSize={35} minSize={15}>
                  <div className="h-full flex flex-col">
                    {/* Bottom panel tabs */}
                    <div className="flex items-center bg-surface border-b border-base shrink-0">
                      {showTerminal && (
                        <button
                          onClick={() => setBottomTab('terminal')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${
                            bottomTab === 'terminal' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'
                          }`}
                        >
                          <TerminalIcon className="w-3.5 h-3.5" />
                          Terminal
                        </button>
                      )}
                      {showPreview && (
                        <button
                          onClick={() => setBottomTab('preview')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${
                            bottomTab === 'preview' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'
                          }`}
                        >
                          <Globe className="w-3.5 h-3.5" />
                          Preview
                        </button>
                      )}
                    </div>
                    {/* Bottom panel content */}
                    <div className="flex-1 overflow-hidden">
                      {bottomTab === 'terminal' && showTerminal && <TerminalPanel />}
                      {bottomTab === 'preview' && showPreview && <PreviewPanel />}
                      {bottomTab === 'terminal' && !showTerminal && showPreview && <PreviewPanel />}
                      {bottomTab === 'preview' && !showPreview && showTerminal && <TerminalPanel />}
                    </div>
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </Panel>

        {/* Right: Chat only */}
        {showChat && (
          <>
            <PanelResizeHandle className="w-1 bg-base hover:bg-accent transition-colors cursor-col-resize" />
            <Panel defaultSize={35} minSize={24} maxSize={50}>
              <ChatPanel />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
