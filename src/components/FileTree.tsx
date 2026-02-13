import { useEffect } from 'react';
import { useFileStore, FileNode } from '../stores/fileStore';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, RefreshCw } from 'lucide-react';

async function fetchTree(path: string): Promise<FileNode[]> {
  const res = await fetch(`/api/files/tree?path=${encodeURIComponent(path)}`);
  return res.json();
}

async function fetchFileContent(path: string): Promise<string> {
  const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  return data.content;
}

function TreeItem({ node, depth }: { node: FileNode; depth: number }) {
  const { toggleDir, openFile, activeFile } = useFileStore();

  const handleClick = async () => {
    if (node.type === 'directory') {
      toggleDir(node.path);
    } else {
      const content = await fetchFileContent(node.path);
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
        <TreeItem key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function FileTree() {
  const { tree, setTree, projectPath, setProjectPath } = useFileStore();

  const loadTree = async (path?: string) => {
    const p = path || projectPath || '.';
    const data = await fetchTree(p);
    setTree(data);
    if (!projectPath) setProjectPath(p);
  };

  useEffect(() => { loadTree(); }, []);

  const handleOpenFolder = async () => {
    const path = prompt('Enter project folder path:', projectPath || 'C:\\Users\\HP\\Desktop\\myproject');
    if (path) {
      setProjectPath(path);
      loadTree(path);
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-base">
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">Explorer</span>
        <div className="flex gap-1">
          <button onClick={handleOpenFolder} className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Open Folder">
            <Folder className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => loadTree()} className="p-1 text-muted hover:text-text rounded hover:bg-overlay" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-muted text-xs mb-2">No folder open</p>
            <button onClick={handleOpenFolder} className="text-accent text-xs hover:underline">Open a folder</button>
          </div>
        ) : (
          tree.map(node => <TreeItem key={node.path} node={node} depth={0} />)
        )}
      </div>
    </div>
  );
}
