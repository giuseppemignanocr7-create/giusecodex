import { Terminal as TerminalIcon } from 'lucide-react';

export function TerminalPanel() {
  return (
    <div className="h-full flex flex-col bg-[#0d0d1a]">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border-b border-base shrink-0">
        <TerminalIcon className="w-3.5 h-3.5 text-green" />
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">Terminal</span>
      </div>
      <div className="flex-1 p-3 font-mono text-xs text-green overflow-y-auto">
        <p className="text-muted mb-1">GiuseCoder Terminal v0.1.0</p>
        <p className="text-muted mb-2">Type commands below (terminal PTY coming soon)</p>
        <div className="flex items-center gap-1">
          <span className="text-accent">$</span>
          <span className="animate-pulse">_</span>
        </div>
      </div>
    </div>
  );
}
