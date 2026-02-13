import { create } from 'zustand';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  expanded?: boolean;
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  dirty: boolean;
}

interface FileStore {
  tree: FileNode[];
  openFiles: OpenFile[];
  activeFile: string | null;
  projectPath: string;
  setProjectPath: (path: string) => void;
  setTree: (tree: FileNode[]) => void;
  toggleDir: (path: string) => void;
  openFile: (file: OpenFile) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  markSaved: (path: string) => void;
}

function getLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp',
    html: 'html', css: 'css', scss: 'scss', json: 'json', md: 'markdown',
    yaml: 'yaml', yml: 'yaml', xml: 'xml', sql: 'sql', sh: 'shell',
    dockerfile: 'dockerfile', toml: 'toml', ini: 'ini', env: 'plaintext',
  };
  return map[ext] || 'plaintext';
}

export const useFileStore = create<FileStore>((set, get) => ({
  tree: [],
  openFiles: [],
  activeFile: null,
  projectPath: '',

  setProjectPath: (path) => set({ projectPath: path }),
  setTree: (tree) => set({ tree }),

  toggleDir: (path) => {
    const toggle = (nodes: FileNode[]): FileNode[] =>
      nodes.map(n =>
        n.path === path ? { ...n, expanded: !n.expanded } : { ...n, children: n.children ? toggle(n.children) : undefined }
      );
    set(s => ({ tree: toggle(s.tree) }));
  },

  openFile: (file) => {
    const existing = get().openFiles.find(f => f.path === file.path);
    if (!existing) {
      set(s => ({ openFiles: [...s.openFiles, { ...file, language: getLanguage(file.name) }], activeFile: file.path }));
    } else {
      set({ activeFile: file.path });
    }
  },

  closeFile: (path) => {
    set(s => {
      const openFiles = s.openFiles.filter(f => f.path !== path);
      const activeFile = s.activeFile === path ? (openFiles[openFiles.length - 1]?.path ?? null) : s.activeFile;
      return { openFiles, activeFile };
    });
  },

  setActiveFile: (path) => set({ activeFile: path }),

  updateContent: (path, content) => {
    set(s => ({
      openFiles: s.openFiles.map(f => f.path === path ? { ...f, content, dirty: true } : f),
    }));
  },

  markSaved: (path) => {
    set(s => ({
      openFiles: s.openFiles.map(f => f.path === path ? { ...f, dirty: false } : f),
    }));
  },
}));
