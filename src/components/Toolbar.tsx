import { FolderTree, MessageSquare, Eye, Terminal, Settings, Zap } from 'lucide-react';
import { useSettings } from '../stores/settingsStore';

interface ToolbarProps {
  showFiles: boolean; toggleFiles: () => void;
  showChat: boolean; toggleChat: () => void;
  showPreview: boolean; togglePreview: () => void;
  showTerminal: boolean; toggleTerminal: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const toggleSettings = useSettings((s) => s.toggleOpen);
  const settingsOpen = useSettings((s) => s.isOpen);

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

  return (
    <div className="h-10 bg-surface border-b border-base flex items-center px-3 gap-1 shrink-0">
      <div className="flex items-center gap-2 mr-4">
        <Zap className="w-5 h-5 text-accent" />
        <span className="font-bold text-sm text-accent">GiuseCoder</span>
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
