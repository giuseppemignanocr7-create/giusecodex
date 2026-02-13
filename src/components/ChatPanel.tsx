import { useState, useRef, useEffect } from 'react';
import { useChat, ChatMessage, AgentRole } from '../stores/chatStore';
import { useSettings } from '../stores/settingsStore';
import { Send, Trash2, Zap, Bot, User, ChevronDown, Settings } from 'lucide-react';

const MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'CTO reasoning', color: 'text-purple', provider: 'anthropic' },
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4', desc: 'Balanced', color: 'text-accent', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fast', color: 'text-green', provider: 'anthropic' },
  { id: 'gpt-5.3-codex', label: 'GPT 5.3 Codex', desc: 'ChatGPT auth', color: 'text-yellow', provider: 'codex-cli' },
  { id: 'gpt-5.2', label: 'GPT 5.2', desc: 'OpenAI API', color: 'text-yellow', provider: 'openai' },
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
  sonnet: 'Sonnet 4',
  opus: 'Opus 4.6',
  codex: 'GPT 5.3 Codex',
  user: 'You',
  system: 'System',
};

export function ChatPanel() {
  const { messages, isStreaming, currentModel, apiKey, totalCost, addMessage, setStreaming, setModel, setApiKey, appendToLast, clearMessages } = useChat();
  const [input, setInput] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectedModel = MODELS.find(m => m.id === currentModel) || MODELS[1];

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
    const chatHistory = [...messages, userMsg].filter(m => m.role === 'user' || ['haiku', 'sonnet', 'opus', 'codex'].includes(m.role)).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    if (orchestratorEnabled) {
      await sendOrchestrated(chatHistory, settings);
    } else {
      await sendDirect(chatHistory, settings);
    }

    setStreaming(false);
  };

  const sendOrchestrated = async (chatHistory: Array<{role: string; content: string}>, settings: ReturnType<typeof useSettings.getState>) => {
    // Show Opus as the initial responder
    const opusMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'opus',
      content: '',
      timestamp: Date.now(),
      model: 'Orchestrator',
    };
    addMessage(opusMsg);

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

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentAgent = 'opus';

      if (reader) {
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
                // When a new agent starts, add a new message for it
                if (event.status === 'running' && event.agent !== currentAgent) {
                  currentAgent = event.agent;
                  const agentMsg: ChatMessage = {
                    id: crypto.randomUUID(),
                    role: event.agent as AgentRole,
                    content: `*${event.label}*\n\n`,
                    timestamp: Date.now(),
                    model: event.agent === 'opus' ? 'claude-opus-4-6' : event.agent === 'sonnet' ? 'claude-sonnet-4' : 'gpt-5.3-codex',
                  };
                  addMessage(agentMsg);
                } else if (event.status === 'done' && event.agent === currentAgent) {
                  appendToLast('\n\n---\n');
                }
              } else if (event.type === 'token') {
                appendToLast(event.text);
              } else if (event.type === 'done') {
                // Final combined response from Opus
                const finalMsg: ChatMessage = {
                  id: crypto.randomUUID(),
                  role: 'opus',
                  content: event.content,
                  timestamp: Date.now(),
                  model: 'claude-opus-4-6 (final)',
                };
                addMessage(finalMsg);
              } else if (event.type === 'error') {
                appendToLast(`\n\n**Error:** ${event.message}`);
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err: unknown) {
      appendToLast(`\n\n**Error:** ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const sendDirect = async (chatHistory: Array<{role: string; content: string}>, settings: ReturnType<typeof useSettings.getState>) => {
    const modelInfo = MODELS.find(m => m.id === currentModel);
    const provider = modelInfo?.provider || 'anthropic';
    const assistantRole: AgentRole = provider === 'codex-cli' || provider === 'openai' ? 'codex' : currentModel.includes('haiku') ? 'haiku' : currentModel.includes('opus') ? 'opus' : 'sonnet';
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: assistantRole,
      content: '',
      timestamp: Date.now(),
      model: currentModel,
    };
    addMessage(assistantMsg);

    try {
      let res: Response;

      if (provider === 'codex-cli') {
        // GPT 5.3 Codex — via Codex CLI on local server
        res = await fetch('/api/chat/codex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: chatHistory[chatHistory.length - 1]?.content || '',
            model: currentModel,
          }),
        });
      } else {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: chatHistory,
            model: currentModel,
            apiKey: provider === 'openai' ? settings.openaiKey : apiKey,
            provider,
          }),
        });
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          appendToLast(text);
        }
      }
    } catch (err: unknown) {
      appendToLast(`\n\n**Error:** ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
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
          <span className="text-[10px] text-muted">${totalCost.toFixed(4)}</span>
          <button onClick={clearMessages} className="p-1 text-muted hover:text-red rounded hover:bg-overlay" title="Clear">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <Zap className="w-10 h-10 text-accent/20 mx-auto mb-3" />
            <p className="text-muted text-sm">Ask GiuseCoder anything</p>
            <p className="text-muted/50 text-xs mt-1">Powered by Claude AI</p>
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

      {/* Model picker + Input */}
      <div className="border-t border-base p-2 shrink-0">
        <div className="relative mb-2">
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
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="px-3 bg-accent hover:bg-accent/80 disabled:opacity-30 disabled:cursor-not-allowed text-base rounded transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
