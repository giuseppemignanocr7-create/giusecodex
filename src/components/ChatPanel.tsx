import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat, ChatMessage, AgentRole } from '../stores/chatStore';
import { useSettings } from '../stores/settingsStore';
import { useProjects } from '../stores/projectStore';
import { OrchestratorView, AgentStream } from './OrchestratorView';
import { Send, Trash2, Zap, Bot, User, ChevronDown, FolderPlus, Folder, X, StopCircle, MessageCircle, Code2 } from 'lucide-react';
import { isElectronApp, streamAnthropic, streamOpenAI, streamViaServer } from '../lib/directApi';

type ChatMode = 'code' | 'ask';
const ASK_SYSTEM_PROMPT = 'You are GiuseCoder, a helpful coding assistant. The user is in ASK mode — answer questions, explain concepts, review code, and provide guidance. Do NOT generate new code unless explicitly asked. Focus on clear explanations.';

// Detect if running in Electron (has Codex CLI for GPT 5.3)
const isElectron = typeof window !== 'undefined' && (window as any).giuseCoder?.isElectron;

const MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'CTO reasoning', color: 'text-purple', provider: 'anthropic' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', desc: 'UI/Design', color: 'text-accent', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fast', color: 'text-green', provider: 'anthropic' },
  ...(isElectron ? [{ id: 'gpt-5.3-codex', label: 'GPT 5.3 Codex', desc: 'Local CLI', color: 'text-yellow', provider: 'codex-cli' as const }] : []),
  { id: 'gpt-5.2', label: 'GPT 5.2', desc: 'Best code via API', color: 'text-yellow', provider: 'openai' },
  { id: 'o3', label: 'o3', desc: 'Reasoning', color: 'text-yellow', provider: 'openai' },
];

const roleColors: Record<AgentRole, string> = {
  haiku: 'border-l-green',
  sonnet: 'border-l-accent',
  opus: 'border-l-purple',
  codex: 'border-l-yellow',
  user: 'border-l-yellow',
  system: 'border-l-muted',
};

const roleLabels: Record<AgentRole, string> = {
  haiku: 'Haiku 4.5',
  sonnet: 'Sonnet 4.5',
  opus: 'Opus 4.6',
  codex: 'GPT 5.2',
  user: 'You',
  system: 'System',
};

const defaultStream = (): AgentStream => ({ agent: 'opus', content: '', status: 'idle', label: '' });

export function ChatPanel() {
  const { messages, isStreaming, currentModel, apiKey, totalCost, addMessage, setStreaming, setModel, setApiKey, appendToLast, clearMessages } = useChat();
  const projects = useProjects();
  const [input, setInput] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showProjectList, setShowProjectList] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>('code');
  const [newProjectName, setNewProjectName] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Orchestrator split view state
  const [orchActive, setOrchActive] = useState(false);
  const [opusAnalysis, setOpusAnalysis] = useState<AgentStream>({ ...defaultStream(), agent: 'opus', label: 'Opus 4.6 — CTO Analysis' });
  const [sonnetStream, setSonnetStream] = useState<AgentStream>({ ...defaultStream(), agent: 'sonnet', label: 'Sonnet 4.5 — UI/Design' });
  const [codexStream, setCodexStream] = useState<AgentStream>({ ...defaultStream(), agent: 'codex', label: 'GPT 5.2 — Code' });
  const [opusReview, setOpusReview] = useState<AgentStream>({ ...defaultStream(), agent: 'opus', label: 'Opus 4.6 — Final Review' });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => { projects.loadProjects(); }, []);

  const normalizedModel = currentModel === 'gpt-5.2-codex'
    ? 'gpt-5.2'
    : currentModel === 'claude-sonnet-4-20250514'
      ? 'claude-sonnet-4-5-20250929'
      : currentModel;

  const selectedModel = MODELS.find(m => m.id === normalizedModel) || MODELS[1];

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    if (!apiKey) {
      useSettings.getState().setOpen(true);
      return;
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };
    addMessage(userMsg);
    setInput('');
    setStreaming(true);

    const settings = useSettings.getState();
    const orchestratorEnabled = settings.orchestratorEnabled;
    const shouldRunOrchestrator = orchestratorEnabled && !isElectronApp;
    const rawHistory = [...messages, userMsg].filter(m => m.role === 'user' || ['haiku', 'sonnet', 'opus', 'codex'].includes(m.role)).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
    // In Ask mode, prepend a system-like user message for context
    const chatHistory = chatMode === 'ask'
      ? [{ role: 'user', content: ASK_SYSTEM_PROMPT }, { role: 'assistant', content: 'Understood. I\'m in Ask mode — I\'ll explain and guide without generating code unless you ask.' }, ...rawHistory]
      : rawHistory;

    if (shouldRunOrchestrator) {
      await sendOrchestrated(chatHistory, settings);
    } else {
      await sendDirect(chatHistory, settings);
    }

    setStreaming(false);
    abortRef.current = null;
  };

  const stopGeneration = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setStreaming(false);
    }
  };

  const sendOrchestrated = async (chatHistory: Array<{role: string; content: string}>, settings: ReturnType<typeof useSettings.getState>) => {
    // Activate split view and reset streams
    setOrchActive(true);
    setOpusAnalysis({ agent: 'opus', content: '', status: 'running', label: 'Opus 4.6 — CTO Analysis' });
    setSonnetStream({ agent: 'sonnet', content: '', status: 'idle', label: 'Sonnet 4.5 — UI/Design' });
    setCodexStream({ agent: 'codex', content: '', status: 'idle', label: 'GPT 5.2 — Code' });
    setOpusReview({ agent: 'opus', content: '', status: 'idle', label: 'Opus 4.6 — Final Review' });

    try {
      const res = await fetch('/api/chat/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory,
          anthropicKey: apiKey,
          openaiKey: settings.openaiKey,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        throw new Error(`Orchestrator API ${res.status}: ${errText.slice(0, 200)}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Orchestrator stream missing response body');
      }
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'step') {
              const update = { status: event.status as AgentStream['status'], label: event.label };
              if (event.agent === 'opus' && event.label.includes('Review')) {
                setOpusReview(prev => ({ ...prev, ...update }));
              } else if (event.agent === 'opus') {
                setOpusAnalysis(prev => ({ ...prev, ...update }));
              } else if (event.agent === 'sonnet') {
                setSonnetStream(prev => ({ ...prev, ...update }));
              } else if (event.agent === 'codex') {
                setCodexStream(prev => ({ ...prev, ...update }));
              }
            } else if (event.type === 'token') {
              // Route tokens to the correct agent panel
              if (event.agent === 'sonnet') {
                setSonnetStream(prev => ({ ...prev, content: prev.content + event.text }));
              } else if (event.agent === 'codex') {
                setCodexStream(prev => ({ ...prev, content: prev.content + event.text }));
              } else if (event.agent === 'opus') {
                // Check if we're in review phase
                setOpusReview(prev => {
                  if (prev.status === 'running') return { ...prev, content: prev.content + event.text };
                  return prev;
                });
                setOpusAnalysis(prev => {
                  if (prev.status === 'running') return { ...prev, content: prev.content + event.text };
                  return prev;
                });
              }
            } else if (event.type === 'done') {
              // Save to project
              projects.save();
            } else if (event.type === 'error') {
              setOpusReview(prev => ({ ...prev, content: prev.content + `\n\n**Error:** ${event.message}`, status: 'error' }));
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err: unknown) {
      setOpusReview(prev => ({ ...prev, content: `**Error:** ${err instanceof Error ? err.message : 'Unknown error'}`, status: 'error' }));
    }
  };

  const sendDirect = async (chatHistory: Array<{role: string; content: string}>, settings: ReturnType<typeof useSettings.getState>) => {
    const modelInfo = MODELS.find(m => m.id === normalizedModel);
    const provider = modelInfo?.provider || 'anthropic';
    const assistantRole: AgentRole = provider === 'codex-cli' || provider === 'openai' ? 'codex' : normalizedModel.includes('haiku') ? 'haiku' : normalizedModel.includes('opus') ? 'opus' : 'sonnet';
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: assistantRole,
      content: '',
      timestamp: Date.now(),
      model: normalizedModel,
    };
    addMessage(assistantMsg);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const onToken = (text: string) => appendToLast(text);

      if (isElectronApp) {
        // Direct API calls in Electron (no server needed)
        if (provider === 'anthropic') {
          await streamAnthropic({
            messages: chatHistory,
            model: normalizedModel,
            apiKey,
            signal: abort.signal,
            onToken,
          });
        } else if (provider === 'openai' || provider === 'codex-cli') {
          await streamOpenAI({
            messages: chatHistory,
            model: provider === 'codex-cli' ? 'gpt-5.3-codex' : normalizedModel,
            apiKey: settings.openaiKey || apiKey,
            signal: abort.signal,
            onToken,
          });
        }
      } else {
        // Web mode: proxy through server
        await streamViaServer({
          messages: chatHistory,
          model: normalizedModel,
          apiKey,
          provider,
          openaiKey: settings.openaiKey,
          signal: abort.signal,
          onToken,
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        appendToLast('\n\n*[Stopped]*');
      } else {
        appendToLast(`\n\n**Error:** ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const createProject = () => {
    const name = newProjectName.trim() || `Project ${projects.projects.length + 1}`;
    projects.createProject(name);
    setNewProjectName('');
    setShowProjectList(false);
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-base shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent" />
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">AI Chat</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Project selector */}
          <div className="relative">
            <button
              onClick={() => setShowProjectList(!showProjectList)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-overlay text-muted hover:text-text transition-colors"
              title="Projects"
            >
              <Folder className="w-3 h-3" />
              <span className="max-w-[80px] truncate">{projects.activeProject?.name || 'No project'}</span>
            </button>
            {showProjectList && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-overlay border border-base rounded shadow-lg py-1 z-20">
                <div className="px-2 py-1 flex gap-1">
                  <input
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createProject()}
                    placeholder="New project name..."
                    className="flex-1 bg-surface border border-base rounded px-2 py-1 text-[10px] text-text placeholder:text-muted/50 focus:outline-none"
                  />
                  <button onClick={createProject} className="p-1 text-accent hover:bg-surface rounded" title="Create">
                    <FolderPlus className="w-3 h-3" />
                  </button>
                </div>
                <div className="border-t border-base my-1" />
                {projects.projects.length === 0 && (
                  <div className="px-3 py-2 text-[10px] text-muted">No projects yet</div>
                )}
                {projects.projects.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(p => (
                  <button
                    key={p.id}
                    onClick={() => { projects.setActiveProject(p.id); setShowProjectList(false); }}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs w-full hover:bg-surface transition-colors ${
                      p.id === projects.activeProjectId ? 'text-accent' : 'text-text'
                    }`}
                  >
                    <Folder className="w-3 h-3 shrink-0" />
                    <span className="truncate">{p.name}</span>
                    <span className="text-[9px] text-muted ml-auto shrink-0">{new Date(p.updatedAt).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-[10px] text-muted">${totalCost.toFixed(4)}</span>
          {orchActive && (
            <button onClick={() => setOrchActive(false)} className="p-1 text-muted hover:text-accent rounded hover:bg-overlay" title="Back to chat">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => { clearMessages(); setOrchActive(false); }} className="p-1 text-muted hover:text-red rounded hover:bg-overlay" title="Clear">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content: Split Orchestrator View or regular messages */}
      {orchActive ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <OrchestratorView
            opusAnalysis={opusAnalysis}
            sonnetStream={sonnetStream}
            codexStream={codexStream}
            opusReview={opusReview}
            isRunning={isStreaming}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <Zap className="w-10 h-10 text-accent/20 mx-auto mb-3" />
              <p className="text-muted text-sm">Ask GiuseCoder anything</p>
              <p className="text-muted/50 text-xs mt-1">Opus orchestrates • Sonnet designs • Codex codes</p>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`border-l-2 ${roleColors[msg.role]} pl-3 py-1`}>
              <div className="flex items-center gap-1.5 mb-1">
                {msg.role === 'user' ? <User className="w-3 h-3 text-yellow" /> : <Bot className="w-3 h-3 text-accent" />}
                <span className="text-[10px] font-semibold text-muted">{roleLabels[msg.role]}</span>
                {msg.model && <span className="text-[9px] text-muted/50">{msg.model}</span>}
              </div>
              <div className="text-xs text-text/90 whitespace-pre-wrap break-words leading-relaxed">
                {msg.content || (isStreaming && msg === messages[messages.length - 1] ? <span className="animate-pulse text-accent">...</span> : '')}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Model picker + Input */}
      <div className="border-t border-base p-2 shrink-0">
        <div className="relative mb-2 flex items-center gap-2">
          {/* Ask / Code mode toggle */}
          <div className="flex items-center bg-overlay rounded p-0.5 gap-0.5">
            <button
              onClick={() => setChatMode('code')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                chatMode === 'code' ? 'bg-accent text-base' : 'text-muted hover:text-text'
              }`}
              title="Code mode — generate and edit code"
            >
              <Code2 className="w-3 h-3" />
              Code
            </button>
            <button
              onClick={() => setChatMode('ask')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                chatMode === 'ask' ? 'bg-purple text-base' : 'text-muted hover:text-text'
              }`}
              title="Ask mode — explain, review, guide"
            >
              <MessageCircle className="w-3 h-3" />
              Ask
            </button>
          </div>
          {/* Model picker */}
          <button
            onClick={() => setShowModelPicker(!showModelPicker)}
            className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded bg-overlay text-muted hover:text-text transition-colors"
          >
            <span className={selectedModel.color}>●</span>
            {selectedModel.label}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showModelPicker && (
            <div className="absolute bottom-full left-0 mb-1 bg-overlay border border-base rounded shadow-lg py-1 z-10">
              {MODELS.map(m => (
                <button
                  key={m.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs w-full hover:bg-surface transition-colors"
                  onClick={() => { setModel(m.id); setShowModelPicker(false); }}
                >
                  <span className={m.color}>●</span>
                  <span className="text-text">{m.label}</span>
                  <span className="text-muted text-[10px]">{m.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={apiKey ? 'Ask GiuseCoder...' : 'Set API key first (click Send)'}
            className="flex-1 bg-overlay border border-base rounded px-3 py-2 text-xs text-text placeholder:text-muted/50 resize-none focus:outline-none focus:border-accent/50 transition-colors"
            rows={2}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              onClick={stopGeneration}
              className="px-3 bg-red hover:bg-red/80 text-white rounded transition-colors"
              title="Stop generation"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="px-3 bg-accent hover:bg-accent/80 disabled:opacity-30 disabled:cursor-not-allowed text-base rounded transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
