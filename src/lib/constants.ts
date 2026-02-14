import { isElectronApp } from './directApi';
import type { AgentRole } from '../stores/chatStore';

// ──── Chat Modes ────

export type ChatMode = 'code' | 'ask';

// ──── System Prompts ────

export const ASK_SYSTEM_PROMPT = 'You are GiuseCoder, a helpful coding assistant. The user is in ASK mode — answer questions, explain concepts, review code, and provide guidance. Do NOT generate new code unless explicitly asked. Focus on clear explanations.';

export const CODE_SYSTEM_PROMPT = `You are GiuseCoder, a premium AI coding assistant.
You write clean, idiomatic, production-ready code.
When modifying code, output the complete changed code with file paths.
Be concise and direct. Use markdown with code blocks.`;

// ──── Models ────

export interface ModelInfo {
  id: string;
  label: string;
  desc: string;
  color: string;
  bgColor: string;
  provider: 'anthropic' | 'openai' | 'codex-cli';
}

const BASE_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'CTO reasoning', color: 'text-purple', bgColor: 'bg-purple', provider: 'anthropic' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', desc: 'UI/Design', color: 'text-accent', bgColor: 'bg-accent', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fast', color: 'text-green', bgColor: 'bg-green', provider: 'anthropic' },
];

const ELECTRON_MODELS: ModelInfo[] = [
  { id: 'gpt-5.3-codex', label: 'GPT 5.3 Codex', desc: 'Local CLI', color: 'text-yellow', bgColor: 'bg-yellow', provider: 'codex-cli' },
];

const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-5.2', label: 'GPT 5.2', desc: 'Best code via API', color: 'text-yellow', bgColor: 'bg-yellow', provider: 'openai' },
  { id: 'o3', label: 'o3', desc: 'Reasoning', color: 'text-yellow', bgColor: 'bg-yellow', provider: 'openai' },
];

export const MODELS: ModelInfo[] = [
  ...BASE_MODELS,
  ...(isElectronApp ? ELECTRON_MODELS : []),
  ...OPENAI_MODELS,
];

// ──── Role Display ────

export const roleColors: Record<AgentRole, string> = {
  haiku: 'border-l-green',
  sonnet: 'border-l-accent',
  opus: 'border-l-purple',
  codex: 'border-l-yellow',
  user: 'border-l-yellow',
  system: 'border-l-muted',
};

export const roleLabels: Record<AgentRole, string> = {
  haiku: 'Haiku 4.5',
  sonnet: 'Sonnet 4.5',
  opus: 'Opus 4.6',
  codex: 'GPT 5.2',
  user: 'You',
  system: 'System',
};
