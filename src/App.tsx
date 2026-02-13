import { useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { FileTree } from './components/FileTree';
import { EditorTabs } from './components/EditorTabs';
import { ChatPanel } from './components/ChatPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { Toolbar } from './components/Toolbar';
import { SettingsPanel } from './components/SettingsPanel';
import { useSettings } from './stores/settingsStore';

export function App() {
  const [showChat, setShowChat] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [showFiles, setShowFiles] = useState(true);

  const settingsOpen = useSettings((s) => s.isOpen);

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
            <Panel defaultSize={15} minSize={10} maxSize={25}>
              <FileTree />
            </Panel>
            <PanelResizeHandle className="w-1 bg-base hover:bg-accent transition-colors cursor-col-resize" />
          </>
        )}

        {/* Center: Editor + Terminal */}
        <Panel defaultSize={showChat ? 50 : 70} minSize={30}>
          <PanelGroup direction="vertical">
            <Panel defaultSize={showTerminal ? 70 : 100} minSize={30}>
              <EditorTabs />
            </Panel>
            {showTerminal && (
              <>
                <PanelResizeHandle className="h-1 bg-base hover:bg-accent transition-colors cursor-row-resize" />
                <Panel defaultSize={30} minSize={15}>
                  <TerminalPanel />
                </Panel>
              </>
            )}
          </PanelGroup>
        </Panel>

        {/* Right: Chat + Preview */}
        {(showChat || showPreview) && (
          <>
            <PanelResizeHandle className="w-1 bg-base hover:bg-accent transition-colors cursor-col-resize" />
            <Panel defaultSize={35} minSize={20}>
              <PanelGroup direction="vertical">
                {showChat && (
                  <Panel defaultSize={showPreview ? 60 : 100} minSize={25}>
                    <ChatPanel />
                  </Panel>
                )}
                {showChat && showPreview && (
                  <PanelResizeHandle className="h-1 bg-base hover:bg-accent transition-colors cursor-row-resize" />
                )}
                {showPreview && (
                  <Panel defaultSize={40} minSize={20}>
                    <PreviewPanel />
                  </Panel>
                )}
              </PanelGroup>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
