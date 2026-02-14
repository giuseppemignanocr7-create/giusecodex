import { useState, useEffect, useCallback } from 'react';
import { GitBranch, GitCommit, Upload, RefreshCw, FileText, Plus, Minus, Edit3, HelpCircle } from 'lucide-react';

interface GitFile {
  status: string;
  file: string;
}

interface GitCommitEntry {
  hash: string;
  message: string;
}

const STATUS_ICONS: Record<string, { icon: typeof Plus; color: string; label: string }> = {
  'M': { icon: Edit3, color: 'text-yellow', label: 'Modified' },
  'A': { icon: Plus, color: 'text-green', label: 'Added' },
  'D': { icon: Minus, color: 'text-red-400', label: 'Deleted' },
  '??': { icon: HelpCircle, color: 'text-muted', label: 'Untracked' },
  'MM': { icon: Edit3, color: 'text-yellow', label: 'Modified' },
  'AM': { icon: Plus, color: 'text-green', label: 'Added+Modified' },
};

const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export function GitPanel() {
  const [isRepo, setIsRepo] = useState(false);
  const [branch, setBranch] = useState('');
  const [files, setFiles] = useState<GitFile[]>([]);
  const [commits, setCommits] = useState<GitCommitEntry[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [tab, setTab] = useState<'changes' | 'log'>('changes');

  const refresh = useCallback(async () => {
    if (!isLocalhost) return;
    setLoading(true);
    try {
      const res = await fetch('/api/git/status');
      const data = await res.json();
      setIsRepo(data.isRepo);
      setBranch(data.branch || '');
      setFiles(data.files || []);

      if (data.isRepo) {
        const logRes = await fetch('/api/git/log');
        const logData = await logRes.json();
        setCommits(logData.commits || []);
      }
    } catch {
      setIsRepo(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setLoading(true);
    setStatusMsg('');
    try {
      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMsg.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg('✅ Committed');
        setCommitMsg('');
        await refresh();
      } else {
        setStatusMsg(`❌ ${data.output?.slice(0, 100) || 'Commit failed'}`);
      }
    } catch (err) {
      setStatusMsg(`❌ ${err instanceof Error ? err.message : 'Error'}`);
    }
    setLoading(false);
  };

  const handlePush = async () => {
    setPushLoading(true);
    setStatusMsg('');
    try {
      const res = await fetch('/api/git/push', { method: 'POST' });
      const data = await res.json();
      setStatusMsg(data.ok ? '✅ Pushed' : `❌ ${data.output?.slice(0, 100) || 'Push failed'}`);
    } catch (err) {
      setStatusMsg(`❌ ${err instanceof Error ? err.message : 'Error'}`);
    }
    setPushLoading(false);
  };

  if (!isLocalhost) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-surface px-4">
        <GitBranch className="w-6 h-6 text-muted/20 mb-2" />
        <p className="text-muted text-xs text-center">Git requires local server (npm run dev)</p>
      </div>
    );
  }

  if (!isRepo) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-surface px-4">
        <GitBranch className="w-6 h-6 text-muted/20 mb-2" />
        <p className="text-muted text-xs text-center">Not a git repository</p>
        <button onClick={refresh} className="mt-2 text-[10px] text-accent hover:underline">Refresh</button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-base shrink-0">
        <GitBranch className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-semibold text-accent">{branch || 'HEAD'}</span>
        <span className="text-[10px] text-muted">{files.length} change{files.length !== 1 ? 's' : ''}</span>
        <div className="flex-1" />
        <button onClick={refresh} className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Refresh" disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-base shrink-0">
        <button
          onClick={() => setTab('changes')}
          className={`flex-1 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${tab === 'changes' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'}`}
        >
          Changes ({files.length})
        </button>
        <button
          onClick={() => setTab('log')}
          className={`flex-1 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${tab === 'log' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'}`}
        >
          Log ({commits.length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'changes' && (
          <>
            {files.length === 0 ? (
              <div className="px-3 py-4 text-center text-muted text-xs">Working tree clean</div>
            ) : (
              files.map((f, i) => {
                const info = STATUS_ICONS[f.status] || STATUS_ICONS['M'];
                const Icon = info.icon;
                return (
                  <div key={`${f.file}-${i}`} className="flex items-center gap-2 px-3 py-1 hover:bg-overlay text-xs">
                    <Icon className={`w-3 h-3 ${info.color} shrink-0`} />
                    <span className="text-text truncate flex-1 font-mono text-[11px]">{f.file}</span>
                    <span className={`text-[9px] ${info.color}`}>{f.status}</span>
                  </div>
                );
              })
            )}
          </>
        )}

        {tab === 'log' && (
          <>
            {commits.length === 0 ? (
              <div className="px-3 py-4 text-center text-muted text-xs">No commits yet</div>
            ) : (
              commits.map((c, i) => (
                <div key={`${c.hash}-${i}`} className="flex items-start gap-2 px-3 py-1.5 hover:bg-overlay text-xs border-b border-base/50">
                  <GitCommit className="w-3 h-3 text-muted shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-text text-[11px]">{c.message}</span>
                    <span className="text-muted text-[9px] ml-2 font-mono">{c.hash}</span>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* Commit bar */}
      {tab === 'changes' && files.length > 0 && (
        <div className="border-t border-base p-2 space-y-1.5 shrink-0">
          <input
            type="text"
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCommit()}
            placeholder="Commit message..."
            className="w-full bg-overlay rounded px-2 py-1.5 text-xs text-text placeholder-muted outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleCommit}
              disabled={loading || !commitMsg.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-accent text-white text-[11px] font-medium disabled:opacity-40 hover:bg-accent/80 transition-colors"
            >
              <GitCommit className="w-3 h-3" />
              Commit
            </button>
            <button
              onClick={handlePush}
              disabled={pushLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-overlay text-text text-[11px] font-medium disabled:opacity-40 hover:bg-base transition-colors"
            >
              <Upload className={`w-3 h-3 ${pushLoading ? 'animate-pulse' : ''}`} />
              Push
            </button>
          </div>
          {statusMsg && <p className="text-[10px] text-muted">{statusMsg}</p>}
        </div>
      )}
    </div>
  );
}
