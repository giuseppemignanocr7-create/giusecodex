import { FolderTree, MessageSquare, Eye, Terminal, Settings, Zap } from 'lucide-react';
import { useSettings } from '../stores/settingsStore';
import { useFileStore } from '../stores/fileStore';

type MenuAction = {
  label: string;
  shortcut?: string;
  onSelect: () => void;
};

interface ToolbarProps {
  showFiles: boolean; toggleFiles: () => void;
  showChat: boolean; toggleChat: () => void;
  showPreview: boolean; togglePreview: () => void;
  showTerminal: boolean; toggleTerminal: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const toggleSettings = useSettings((s) => s.toggleOpen);
  const settingsOpen = useSettings((s) => s.isOpen);
  const openFile = useFileStore((s) => s.openFile);

  const runBrowserCommand = (cmd: string) => {
    try {
      document.execCommand(cmd);
    } catch {
      // ignore unsupported browser commands
    }
  };

  const fire = (eventName: string) => {
    window.dispatchEvent(new CustomEvent(eventName));
  };

  const closeMenus = () => {
    document.querySelectorAll('details[open]').forEach((d) => d.removeAttribute('open'));
  };

  const btn = (active: boolean, onClick: () => void, icon: React.ReactNode, label: string) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
        active ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text hover:bg-overlay'
      }`}
      title={label}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );

  const menu = (label: string, actions: MenuAction[]) => (
    <details className="relative">
      <summary className="list-none cursor-pointer px-2 py-1 rounded text-[11px] text-muted hover:text-text hover:bg-overlay select-none">
        {label}
      </summary>
      <div className="absolute top-full left-0 mt-1 min-w-[190px] bg-surface border border-base rounded shadow-xl z-50 py-1">
        {actions.map((a) => (
          <button
            key={`${label}-${a.label}`}
            onClick={() => {
              a.onSelect();
              closeMenus();
            }}
            className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-left text-text hover:bg-overlay"
          >
            <span>{a.label}</span>
            {a.shortcut && <span className="text-muted">{a.shortcut}</span>}
          </button>
        ))}
      </div>
    </details>
  );

  const fileMenu: MenuAction[] = [
    {
      label: 'New File',
      shortcut: 'Ctrl+N',
      onSelect: () => {
        const name = `untitled-${Date.now()}.ts`;
        openFile({ path: `untitled/${name}`, name, content: '', language: 'typescript', dirty: true });
      },
    },
    { label: 'Open Folder', shortcut: 'Ctrl+O', onSelect: () => fire('gc:open-folder') },
    { label: 'Save Active File', shortcut: 'Ctrl+S', onSelect: () => fire('gc:save-active-file') },
    { label: 'Save All', shortcut: 'Ctrl+Shift+S', onSelect: () => fire('gc:save-all-files') },
  ];

  const editMenu: MenuAction[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', onSelect: () => runBrowserCommand('undo') },
    { label: 'Redo', shortcut: 'Ctrl+Y', onSelect: () => runBrowserCommand('redo') },
    { label: 'Cut', shortcut: 'Ctrl+X', onSelect: () => runBrowserCommand('cut') },
    { label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => runBrowserCommand('copy') },
    { label: 'Paste', shortcut: 'Ctrl+V', onSelect: () => runBrowserCommand('paste') },
  ];

  const selectionMenu: MenuAction[] = [
    { label: 'Select All', shortcut: 'Ctrl+A', onSelect: () => runBrowserCommand('selectAll') },
    { label: 'Focus Chat Input', shortcut: 'Ctrl+L', onSelect: () => fire('gc:focus-chat-input') },
  ];

  const viewMenu: MenuAction[] = [
    { label: props.showFiles ? 'Hide Explorer' : 'Show Explorer', onSelect: props.toggleFiles },
    { label: props.showChat ? 'Hide Chat' : 'Show Chat', onSelect: props.toggleChat },
    { label: props.showPreview ? 'Hide Preview' : 'Show Preview', onSelect: props.togglePreview },
    { label: props.showTerminal ? 'Hide Terminal' : 'Show Terminal', onSelect: props.toggleTerminal },
  ];

  return (
    <div className="h-11 bg-surface border-b border-base flex items-center px-3 gap-2 shrink-0">
      <div className="flex items-center gap-2 mr-4">
        <Zap className="w-5 h-5 text-accent" />
        <span className="font-bold text-sm text-accent">GiuseCoder</span>
      </div>
      <div className="flex items-center gap-0.5 mr-2">
        {menu('File', fileMenu)}
        {menu('Edit', editMenu)}
        {menu('Selection', selectionMenu)}
        {menu('View', viewMenu)}
      </div>
      <div className="flex items-center gap-1">
        {btn(props.showFiles, props.toggleFiles, <FolderTree className="w-4 h-4" />, 'Files')}
        {btn(props.showChat, props.toggleChat, <MessageSquare className="w-4 h-4" />, 'Chat AI')}
        {btn(props.showPreview, props.togglePreview, <Eye className="w-4 h-4" />, 'Preview')}
        {btn(props.showTerminal, props.toggleTerminal, <Terminal className="w-4 h-4" />, 'Terminal')}
      </div>
      <div className="flex-1" />
      <button onClick={toggleSettings} className={`p-1.5 rounded transition-colors ${settingsOpen ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text hover:bg-overlay'}`}>
        <Settings className="w-4 h-4" />
      </button>
    </div>
  );
}
