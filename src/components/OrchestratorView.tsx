import { useState, useRef, useEffect } from 'react';
import { Zap, Palette, Code2, CheckCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

export interface AgentStream {
  agent: 'opus' | 'sonnet' | 'codex';
  content: string;
  status: 'idle' | 'running' | 'done' | 'error';
  label: string;
}

interface OrchestratorViewProps {
  opusAnalysis: AgentStream;
  sonnetStream: AgentStream;
  codexStream: AgentStream;
  opusReview: AgentStream;
  isRunning: boolean;
}

function AgentPanel({ stream, icon, color, bgColor }: {
  stream: AgentStream;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [stream.content]);

  return (
    <div className={`flex flex-col h-full rounded-lg border ${stream.status === 'running' ? 'border-accent/50' : 'border-base'} overflow-hidden`}>
      {/* Agent Header */}
      <div className={`flex items-center gap-2 px-3 py-2 ${bgColor} shrink-0`}>
        {icon}
        <span className={`font-bold text-xs ${color}`}>{stream.label}</span>
        <div className="flex-1" />
        {stream.status === 'running' && <Loader2 className={`w-3 h-3 ${color} animate-spin`} />}
        {stream.status === 'done' && <CheckCircle className="w-3 h-3 text-green" />}
      </div>

      {/* Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 bg-surface text-xs font-mono leading-relaxed whitespace-pre-wrap"
      >
        {stream.status === 'idle' ? (
          <span className="text-muted italic">In attesa...</span>
        ) : (
          stream.content || <span className="text-muted animate-pulse">Elaborando...</span>
        )}
      </div>
    </div>
  );
}

export function OrchestratorView({ opusAnalysis, sonnetStream, codexStream, opusReview, isRunning }: OrchestratorViewProps) {
  const [showAnalysis, setShowAnalysis] = useState(true);
  const reviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reviewRef.current) {
      reviewRef.current.scrollTop = reviewRef.current.scrollHeight;
    }
  }, [opusReview.content]);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2 p-2 overflow-hidden">
      {/* Opus Analysis (collapsible top bar) */}
      <div className="shrink-0 rounded-lg border border-purple/30 bg-purple/5 overflow-hidden">
        <button
          onClick={() => setShowAnalysis(!showAnalysis)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-purple/10 transition-colors"
        >
          <Zap className="w-4 h-4 text-purple" />
          <span className="font-bold text-xs text-purple">Opus 4.6 — CTO Analysis</span>
          <div className="flex-1" />
          {opusAnalysis.status === 'running' && <Loader2 className="w-3 h-3 text-purple animate-spin" />}
          {opusAnalysis.status === 'done' && <CheckCircle className="w-3 h-3 text-green" />}
          {showAnalysis ? <ChevronUp className="w-3 h-3 text-muted" /> : <ChevronDown className="w-3 h-3 text-muted" />}
        </button>
        {showAnalysis && opusAnalysis.content && (
          <div className="px-3 pb-2 text-xs text-muted font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
            {opusAnalysis.content}
          </div>
        )}
      </div>

      {/* Split View: Sonnet (design) | Codex (code) */}
      <div className="flex-1 flex gap-2 min-h-0">
        {/* Left: Sonnet Design */}
        <div className="flex-1 min-w-0">
          <AgentPanel
            stream={sonnetStream}
            icon={<Palette className="w-4 h-4 text-accent" />}
            color="text-accent"
            bgColor="bg-accent/10"
          />
        </div>

        {/* Right: Codex Code */}
        <div className="flex-1 min-w-0">
          <AgentPanel
            stream={codexStream}
            icon={<Code2 className="w-4 h-4 text-yellow" />}
            color="text-yellow"
            bgColor="bg-yellow/10"
          />
        </div>
      </div>

      {/* Opus Review (bottom) */}
      {(opusReview.status !== 'idle') && (
        <div className="shrink-0 max-h-48 rounded-lg border border-purple/30 bg-purple/5 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2">
            <Zap className="w-4 h-4 text-purple" />
            <span className="font-bold text-xs text-purple">Opus 4.6 — Final Review</span>
            <div className="flex-1" />
            {opusReview.status === 'running' && <Loader2 className="w-3 h-3 text-purple animate-spin" />}
            {opusReview.status === 'done' && <CheckCircle className="w-3 h-3 text-green" />}
          </div>
          <div
            ref={reviewRef}
            className="px-3 pb-2 text-xs font-mono whitespace-pre-wrap overflow-y-auto max-h-36"
          >
            {opusReview.content || <span className="text-muted animate-pulse">Reviewing...</span>}
          </div>
        </div>
      )}

      {/* Progress indicator */}
      {isRunning && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-accent/5 rounded-lg border border-accent/20">
          <Loader2 className="w-3 h-3 text-accent animate-spin" />
          <span className="text-xs text-accent font-medium">Pipeline in esecuzione...</span>
        </div>
      )}
    </div>
  );
}
