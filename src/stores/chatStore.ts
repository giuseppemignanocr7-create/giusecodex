import { create } from 'zustand';

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

export const useChat = create<ChatStore>((set) => ({
  messages: [],
  isStreaming: false,
  currentModel: 'claude-opus-4-6',
  apiKey: typeof window !== 'undefined' ? localStorage.getItem('gc_anthropic_key') || '' : '',
  pipeline: [],
  totalCost: 0,

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  appendToLast: (text) =>
    set((s) => {
      const msgs = [...s.messages];
      if (msgs.length > 0) {
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: msgs[msgs.length - 1].content + text };
      }
      return { messages: msgs };
    }),

  setStreaming: (v) => set({ isStreaming: v }),
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
  clearMessages: () => set({ messages: [], pipeline: [] }),
}));
