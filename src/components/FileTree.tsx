import { useEffect, useState, useRef } from 'react';
import { useFileStore, FileNode } from '../stores/fileStore';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, RefreshCw, Upload } from 'lucide-react';
import { isElectronApp } from '../lib/directApi';

// Store directory handles for re-reading
const handleMap = new Map<string, FileSystemDirectoryHandle | FileSystemFileHandle>();

async function readDirHandle(dirHandle: FileSystemDirectoryHandle, parentPath: string): Promise<FileNode[]> {
  const entries: FileNode[] = [];
  for await (const [name, handle] of (dirHandle as any).entries()) {
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    handleMap.set(fullPath, handle);
    if (handle.kind === 'directory') {
      entries.push({ name, path: fullPath, type: 'directory', children: [], expanded: false });
    } else {
      entries.push({ name, path: fullPath, type: 'file' });
    }
  }
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function readFileHandle(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

async function expandDir(path: string): Promise<FileNode[]> {
  const handle = handleMap.get(path);
  if (!handle || handle.kind !== 'directory') return [];
  return readDirHandle(handle as FileSystemDirectoryHandle, path);
}

// Server-based fetch (fallback for Vercel with Express server running)
async function fetchTreeServer(path: string): Promise<FileNode[]> {
  try {
    const res = await fetch(`/api/files/tree?path=${encodeURIComponent(path)}`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

async function fetchFileServer(path: string): Promise<string> {
  try {
    const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    return data.content;
  } catch { return ''; }
}

function TreeItem({ node, depth, onExpand }: { node: FileNode; depth: number; onExpand: (path: string) => void }) {
  const { toggleDir, openFile, activeFile } = useFileStore();

  const handleClick = async () => {
    if (node.type === 'directory') {
      if (!node.expanded) onExpand(node.path);
      toggleDir(node.path);
    } else {
      // Read file content
      const handle = handleMap.get(node.path);
      let content = '';
      if (handle && handle.kind === 'file') {
        content = await readFileHandle(handle as FileSystemFileHandle);
      } else if (!isElectronApp) {
        content = await fetchFileServer(node.path);
      }
      openFile({ path: node.path, name: node.name, content, language: '', dirty: false });
    }
  };

  const isActive = activeFile === node.path;

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-0.5 cursor-pointer text-xs hover:bg-overlay transition-colors ${
          isActive ? 'bg-accent/15 text-accent' : 'text-text/80'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        {node.type === 'directory' ? (
          <>
            {node.expanded ? <ChevronDown className="w-3 h-3 text-muted shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted shrink-0" />}
            {node.expanded ? <FolderOpen className="w-3.5 h-3.5 text-accent shrink-0" /> : <Folder className="w-3.5 h-3.5 text-yellow shrink-0" />}
          </>
        ) : (
          <>
            <span className="w-3" />
            <File className="w-3.5 h-3.5 text-muted shrink-0" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {node.type === 'directory' && node.expanded && node.children?.map(child => (
        <TreeItem key={child.path} node={child} depth={depth + 1} onExpand={onExpand} />
      ))}
    </div>
  );
}

export function FileTree() {
  const { tree, setTree, projectPath, setProjectPath } = useFileStore();
  const [rootName, setRootName] = useState('');
  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null);

  const handleOpenFolder = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        // File System Access API (Electron + Chrome/Edge)
        const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        rootHandleRef.current = dirHandle;
        handleMap.clear();
        handleMap.set('', dirHandle);
        const children = await readDirHandle(dirHandle, '');
        setTree(children);
        setRootName(dirHandle.name);
        setProjectPath(dirHandle.name);
      } else {
        // Fallback: prompt path (for older browsers)
        const path = prompt('Enter project folder path:');
        if (path) {
          setProjectPath(path);
          const data = await fetchTreeServer(path);
          setTree(data);
          setRootName(path.split('/').pop() || path.split('\\').pop() || path);
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to open folder:', err);
      }
    }
  };

  const handleExpand = async (path: string) => {
    const children = await expandDir(path);
    if (children.length === 0) return;
    const updateChildren = (nodes: FileNode[]): FileNode[] =>
      nodes.map(n => {
        if (n.path === path) return { ...n, children, expanded: true };
        if (n.children) return { ...n, children: updateChildren(n.children) };
        return n;
      });
    setTree(updateChildren(tree));
  };

  const handleRefresh = async () => {
    if (rootHandleRef.current) {
      handleMap.clear();
      handleMap.set('', rootHandleRef.current);
      const children = await readDirHandle(rootHandleRef.current, '');
      setTree(children);
    } else if (projectPath) {
      const data = await fetchTreeServer(projectPath);
      setTree(data);
    }
  };

  useEffect(() => {
    const onOpenFolder = () => { void handleOpenFolder(); };
    const onRefreshTree = () => { void handleRefresh(); };

    window.addEventListener('gc:open-folder', onOpenFolder as EventListener);
    window.addEventListener('gc:refresh-tree', onRefreshTree as EventListener);

    return () => {
      window.removeEventListener('gc:open-folder', onOpenFolder as EventListener);
      window.removeEventListener('gc:refresh-tree', onRefreshTree as EventListener);
    };
  }, [projectPath]);

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-base">
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">Explorer</span>
        <div className="flex gap-1">
          <button onClick={handleOpenFolder} className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Open Folder">
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleRefresh} className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Folder className="w-8 h-8 text-muted/20 mx-auto mb-3" />
            <p className="text-muted text-xs mb-2">No folder open</p>
            <button onClick={handleOpenFolder} className="text-accent text-xs hover:underline">Open a folder</button>
          </div>
        ) : (
          <>
            {rootName && (
              <div className="px-3 py-1 text-[10px] font-semibold text-muted uppercase tracking-wider border-b border-base">
                {rootName}
              </div>
            )}
            {tree.map(node => <TreeItem key={node.path} node={node} depth={0} onExpand={handleExpand} />)}
          </>
        )}
      </div>
    </div>
  );
}
