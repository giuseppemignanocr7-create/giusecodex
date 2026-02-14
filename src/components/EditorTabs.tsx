import { useCallback, useEffect, useRef } from 'react';
import { useFileStore } from '../stores/fileStore';
import Editor from '@monaco-editor/react';
import { X, Circle, FolderOpen, MessageSquare } from 'lucide-react';
import { registerInlineCompletion } from '../lib/inlineCompletion';

export function EditorTabs() {
  const { openFiles, activeFile, setActiveFile, closeFile, updateContent } = useFileStore();

  const active = openFiles.find(f => f.path === activeFile);

  const saveFile = useCallback(async (path: string, content: string) => {
    await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    useFileStore.getState().markSaved(path);
  }, []);

  const handleSave = useCallback(async () => {
    if (!active) return;
    await saveFile(active.path, active.content);
  }, [active, saveFile]);

  // Ref so Monaco keybinding always calls the latest handleSave
  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  const handleSaveAll = useCallback(async () => {
    const files = useFileStore.getState().openFiles;
    for (const f of files) {
      if (!f.dirty) continue;
      await saveFile(f.path, f.content);
    }
  }, [saveFile]);

  const handleNewFile = useCallback(() => {
    const name = `untitled-${Date.now()}.ts`;
    useFileStore.getState().openFile({ path: `untitled/${name}`, name, content: '', language: 'typescript', dirty: true });
  }, []);

  useEffect(() => {
    const onSaveActive = () => { void handleSave(); };
    const onSaveAll = () => { void handleSaveAll(); };
    const onNewFile = () => { handleNewFile(); };

    window.addEventListener('gc:save-active-file', onSaveActive as EventListener);
    window.addEventListener('gc:save-all-files', onSaveAll as EventListener);
    window.addEventListener('gc:new-file', onNewFile as EventListener);

    return () => {
      window.removeEventListener('gc:save-active-file', onSaveActive as EventListener);
      window.removeEventListener('gc:save-all-files', onSaveAll as EventListener);
      window.removeEventListener('gc:new-file', onNewFile as EventListener);
    };
  }, [handleSave, handleSaveAll, handleNewFile]);

  return (
    <div className="h-full flex flex-col bg-base">
      {/* Tab bar */}
      <div className="flex items-center bg-surface border-b border-base overflow-x-auto shrink-0">
        {openFiles.map(f => (
          <div
            key={f.path}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-base shrink-0 transition-colors ${
              f.path === activeFile ? 'bg-base text-text border-t-2 border-t-accent' : 'text-muted hover:text-text hover:bg-overlay'
            }`}
            onClick={() => setActiveFile(f.path)}
          >
            {f.dirty && <Circle className="w-2 h-2 fill-accent text-accent" />}
            <span>{f.name}</span>
            <button
              className="ml-1 p-0.5 rounded hover:bg-overlay"
              onClick={(e) => { e.stopPropagation(); closeFile(f.path); }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Editor */}
      <div className="flex-1">
        {active ? (
          <Editor
            height="100%"
            language={active.language}
            value={active.content}
            theme="vs-dark"
            onChange={(val) => updateContent(active.path, val || '')}
            onMount={(editor) => {
              editor.addCommand(2097 /* Ctrl+S */, () => handleSaveRef.current());
              // Register inline AI completion (localhost only)
              registerInlineCompletion(editor);
            }}
            options={{
              fontSize: 14,
              fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
              fontLigatures: true,
              minimap: { enabled: true, scale: 2 },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              padding: { top: 8 },
              scrollBeyondLastLine: false,
            }}
          />
        ) : (
          <div className="h-full flex items-start justify-center pt-14 px-5">
            <div className="w-full max-w-xl rounded-xl border border-base bg-surface/60 p-5">
              <p className="text-lg font-semibold text-accent/80 mb-1">Ready to build</p>
              <p className="text-muted text-xs mb-4">Open a folder, then edit files or ask Chat AI to generate code.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('gc:open-folder'))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-overlay text-xs text-text hover:bg-base transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Open folder
                </button>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('gc:focus-chat-input'))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-overlay text-xs text-text hover:bg-base transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Ask Chat AI
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
