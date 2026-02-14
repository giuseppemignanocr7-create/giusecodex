import { create } from 'zustand';

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messages: ProjectMessage[];
  orchestratorSessions: OrchestratorSession[];
}

export interface ProjectMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  model?: string;
  agent?: string;
}

export interface OrchestratorSession {
  id: string;
  timestamp: number;
  prompt: string;
  opusAnalysis: string;
  sonnetOutput: string;
  codexOutput: string;
  opusReview: string;
  status: 'running' | 'done' | 'error';
}

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;

  loadProjects: () => void;
  createProject: (name: string) => string;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  setActiveProject: (id: string | null) => void;
  addMessage: (msg: ProjectMessage) => void;
  addOrchestratorSession: (session: OrchestratorSession) => void;
  updateOrchestratorSession: (sessionId: string, updates: Partial<OrchestratorSession>) => void;
  save: () => void;
}

const STORAGE_KEY = 'gc_projects';
const ACTIVE_KEY = 'gc_active_project';

export const useProjects = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,

  loadProjects: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const projects: Project[] = raw ? JSON.parse(raw) : [];
      const activeId = localStorage.getItem(ACTIVE_KEY);
      const active = projects.find(p => p.id === activeId) || null;
      set({ projects, activeProjectId: activeId, activeProject: active });
    } catch { set({ projects: [], activeProjectId: null, activeProject: null }); }
  },

  createProject: (name: string) => {
    const id = crypto.randomUUID();
    const project: Project = {
      id,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      orchestratorSessions: [],
    };
    const projects = [...get().projects, project];
    set({ projects, activeProjectId: id, activeProject: project });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    localStorage.setItem(ACTIVE_KEY, id);
    return id;
  },

  deleteProject: (id: string) => {
    const projects = get().projects.filter(p => p.id !== id);
    const activeId = get().activeProjectId === id ? null : get().activeProjectId;
    set({ projects, activeProjectId: activeId, activeProject: activeId ? projects.find(p => p.id === activeId) || null : null });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    if (activeId === null) localStorage.removeItem(ACTIVE_KEY);
  },

  renameProject: (id: string, name: string) => {
    const projects = get().projects.map(p => p.id === id ? { ...p, name, updatedAt: Date.now() } : p);
    const active = projects.find(p => p.id === get().activeProjectId) || null;
    set({ projects, activeProject: active });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  },

  setActiveProject: (id: string | null) => {
    const active = id ? get().projects.find(p => p.id === id) || null : null;
    set({ activeProjectId: id, activeProject: active });
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  },

  addMessage: (msg: ProjectMessage) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    const updated = projects.map(p =>
      p.id === activeProjectId
        ? { ...p, messages: [...p.messages, msg], updatedAt: Date.now() }
        : p
    );
    const active = updated.find(p => p.id === activeProjectId) || null;
    set({ projects: updated, activeProject: active });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  addOrchestratorSession: (session: OrchestratorSession) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    const updated = projects.map(p =>
      p.id === activeProjectId
        ? { ...p, orchestratorSessions: [...p.orchestratorSessions, session], updatedAt: Date.now() }
        : p
    );
    const active = updated.find(p => p.id === activeProjectId) || null;
    set({ projects: updated, activeProject: active });
  },

  updateOrchestratorSession: (sessionId: string, updates: Partial<OrchestratorSession>) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    const updated = projects.map(p =>
      p.id === activeProjectId
        ? {
            ...p,
            orchestratorSessions: p.orchestratorSessions.map(s =>
              s.id === sessionId ? { ...s, ...updates } : s
            ),
            updatedAt: Date.now(),
          }
        : p
    );
    const active = updated.find(p => p.id === activeProjectId) || null;
    set({ projects: updated, activeProject: active });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  save: () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(get().projects));
  },
}));
