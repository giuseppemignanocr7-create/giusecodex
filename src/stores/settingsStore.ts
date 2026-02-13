import { create } from 'zustand';

export interface Settings {
  anthropicKey: string;
  openaiKey: string;
  defaultModel: string;
  autoRun: boolean;
  autoReview: boolean;
  autoFix: boolean;
  parallelExecution: boolean;
  temperature: number;
  maxTokens: number;
  orchestratorEnabled: boolean;
  maxFixRounds: number;
  costWarningThreshold: number;
  anthropicKeyValid: boolean | null;
  openaiKeyValid: boolean | null;
}

interface SettingsStore extends Settings {
  isOpen: boolean;
  toggleOpen: () => void;
  setOpen: (v: boolean) => void;
  update: (partial: Partial<Settings>) => void;
  loadFromStorage: () => void;
  saveToStorage: () => void;
}

const STORAGE_KEY = 'gc_settings';

function loadSettings(): Partial<Settings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

const defaults: Settings = {
  anthropicKey: '',
  openaiKey: '',
  defaultModel: 'claude-opus-4-6',
  autoRun: true,
  autoReview: true,
  autoFix: true,
  parallelExecution: true,
  temperature: 0.2,
  maxTokens: 8192,
  orchestratorEnabled: true,
  maxFixRounds: 1,
  costWarningThreshold: 0.5,
  anthropicKeyValid: null,
  openaiKeyValid: null,
};

export const useSettings = create<SettingsStore>((set, get) => ({
  ...defaults,
  ...loadSettings(),
  isOpen: false,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (v) => set({ isOpen: v }),

  update: (partial) => {
    set(partial);
    get().saveToStorage();
  },

  loadFromStorage: () => {
    const saved = loadSettings();
    set({ ...defaults, ...saved });
  },

  saveToStorage: () => {
    const state = get();
    const toSave: Partial<Settings> = {
      anthropicKey: state.anthropicKey,
      openaiKey: state.openaiKey,
      defaultModel: state.defaultModel,
      autoRun: state.autoRun,
      autoReview: state.autoReview,
      autoFix: state.autoFix,
      parallelExecution: state.parallelExecution,
      temperature: state.temperature,
      maxTokens: state.maxTokens,
      orchestratorEnabled: state.orchestratorEnabled,
      maxFixRounds: state.maxFixRounds,
      costWarningThreshold: state.costWarningThreshold,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    // Sync API key to chat store
    localStorage.setItem('gc_anthropic_key', state.anthropicKey);
  },
}));
