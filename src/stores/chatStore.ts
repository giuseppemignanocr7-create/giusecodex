import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AgentRole = 'haiku' | 'sonnet' | 'opus' | 'codex' | 'user' | 'system';

export interface ChatMessage {
  id: string;
  role: AgentRole;
  content: string;
  timestamp: number;
  model?: string;
  tokens?: { input: number; output: number };
  cost?: number;
}

export interface PipelineStep {
  agent: AgentRole;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

interface ChatStore {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentModel: string;
  apiKey: string;
  pipeline: PipelineStep[];
  totalCost: number;
  addMessage: (msg: ChatMessage) => void;
  appendToLast: (text: string) => void;
  setStreaming: (v: boolean) => void;
  setModel: (m: string) => void;
  setApiKey: (k: string) => void;
  setPipeline: (p: PipelineStep[]) => void;
  updatePipelineStep: (index: number, status: PipelineStep['status']) => void;
  addCost: (c: number) => void;
  clearMessages: () => void;
}

// Token batching: accumulate tokens and flush once per animation frame
let _tokenBuffer = '';
let _rafId: number | null = null;

function flushTokenBuffer(set: (fn: (s: ChatStore) => Partial<ChatStore>) => void) {
  if (!_tokenBuffer) return;
  const text = _tokenBuffer;
  _tokenBuffer = '';
  _rafId = null;
  set((s) => {
    const msgs = [...s.messages];
    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      msgs[msgs.length - 1] = { ...last, content: last.content + text };
    }
    return { messages: msgs };
  });
}

export const useChat = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      isStreaming: false,
      currentModel: 'claude-opus-4-6',
      apiKey: typeof window !== 'undefined' ? localStorage.getItem('gc_anthropic_key') || '' : '',
      pipeline: [],
      totalCost: 0,

      addMessage: (msg) => {
        // Flush any pending tokens before adding a new message
        if (_tokenBuffer) flushTokenBuffer(set);
        set((s) => ({ messages: [...s.messages, msg] }));
      },

      appendToLast: (text) => {
        _tokenBuffer += text;
        if (_rafId === null) {
          _rafId = requestAnimationFrame(() => flushTokenBuffer(set));
        }
      },

      setStreaming: (v) => {
        // Flush remaining tokens when streaming stops
        if (!v && _tokenBuffer) flushTokenBuffer(set);
        set({ isStreaming: v });
      },
      setModel: (m) => set({ currentModel: m }),
      setApiKey: (k) => set({ apiKey: k }),
      setPipeline: (p) => set({ pipeline: p }),

      updatePipelineStep: (index, status) =>
        set((s) => {
          const pipeline = [...s.pipeline];
          if (pipeline[index]) pipeline[index] = { ...pipeline[index], status };
          return { pipeline };
        }),

      addCost: (c) => set((s) => ({ totalCost: s.totalCost + c })),
      clearMessages: () => {
        _tokenBuffer = '';
        if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
        set({ messages: [], pipeline: [] });
      },
    }),
    {
      name: 'gc_chat_store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        messages: state.messages.slice(-50),
        currentModel: state.currentModel,
        totalCost: state.totalCost,
      }),
    }
  )
);
