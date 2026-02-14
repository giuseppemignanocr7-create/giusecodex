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
  addGeneratedProject: (projectName: string, files: Array<{ path: string; name: string; content: string; language: string }>) => void;
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

  addGeneratedProject: (projectName, files) => {
    const store = get();

    // Build folder node for tree
    const childNodes: FileNode[] = files.map(f => ({
      name: f.name,
      path: f.path,
      type: 'file' as const,
    }));

    const folderNode: FileNode = {
      name: projectName,
      path: projectName,
      type: 'directory',
      children: childNodes,
      expanded: true,
    };

    // Replace existing folder with same name or append
    const existingIdx = store.tree.findIndex(n => n.path === projectName);
    let newTree: FileNode[];
    if (existingIdx >= 0) {
      newTree = [...store.tree];
      newTree[existingIdx] = folderNode;
    } else {
      newTree = [folderNode, ...store.tree];
    }

    // Open all files in editor (update if already open)
    let newOpenFiles = [...store.openFiles];
    for (const f of files) {
      const idx = newOpenFiles.findIndex(of => of.path === f.path);
      const openF: OpenFile = { path: f.path, name: f.name, content: f.content, language: getLanguage(f.name), dirty: true };
      if (idx >= 0) {
        newOpenFiles[idx] = openF;
      } else {
        newOpenFiles.push(openF);
      }
    }

    // Focus the main file (prefer index.html > first html > first file)
    const mainFile = files.find(f => f.name === 'index.html') || files.find(f => f.name.endsWith('.html')) || files[0];

    set({
      tree: newTree,
      openFiles: newOpenFiles,
      activeFile: mainFile?.path || store.activeFile,
      projectPath: store.projectPath || projectName,
    });
  },
}));
