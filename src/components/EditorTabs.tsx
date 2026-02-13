import { useFileStore } from '../stores/fileStore';
import Editor from '@monaco-editor/react';
import { X, Circle } from 'lucide-react';

export function EditorTabs() {
  const { openFiles, activeFile, setActiveFile, closeFile, updateContent } = useFileStore();

  const active = openFiles.find(f => f.path === activeFile);

  const handleSave = async () => {
    if (!active) return;
    await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: active.path, content: active.content }),
    });
    useFileStore.getState().markSaved(active.path);
  };

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
              editor.addCommand(2097 /* Ctrl+S */, handleSave);
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
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-3xl font-bold text-accent/30 mb-2">GiuseCoder</p>
              <p className="text-muted text-sm">Open a file from the explorer or use Chat AI to generate code</p>
              <div className="mt-6 flex gap-4 justify-center text-xs text-muted">
                <kbd className="px-2 py-1 bg-surface rounded">Ctrl+Shift+P</kbd>
                <span>Command Palette</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
