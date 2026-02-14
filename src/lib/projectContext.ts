import { useFileStore, FileNode } from '../stores/fileStore';

/**
 * Build a concise project context string from the file tree and open files.
 * This is injected into the system prompt so the AI knows what the user is working on.
 */
export function buildProjectContext(): string {
  const { tree, openFiles, activeFile, projectPath } = useFileStore.getState();

  if (tree.length === 0 && openFiles.length === 0) return '';

  const parts: string[] = [];

  // Project name
  if (projectPath) {
    const name = projectPath.split(/[/\\]/).pop() || projectPath;
    parts.push(`## Active Project: ${name}`);
    parts.push(`Path: ${projectPath}`);
  }

  // File tree (compact, max 3 levels deep, max 80 entries)
  if (tree.length > 0) {
    parts.push('\n## Project Structure:');
    parts.push('```');
    let count = 0;
    const renderTree = (nodes: FileNode[], indent: string, depth: number) => {
      for (const node of nodes) {
        if (count >= 80) { parts.push(`${indent}... (more files)`); return; }
        // Skip common noise
        if (['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'venv'].includes(node.name)) continue;
        count++;
        const prefix = node.type === 'directory' ? '📁 ' : '  ';
        parts.push(`${indent}${prefix}${node.name}`);
        if (node.children && depth < 3) {
          renderTree(node.children, indent + '  ', depth + 1);
        }
      }
    };
    renderTree(tree, '', 0);
    parts.push('```');
  }

  // Open files with content (truncated)
  if (openFiles.length > 0) {
    parts.push(`\n## Open Files (${openFiles.length}):`);
    for (const f of openFiles) {
      const isActive = f.path === activeFile;
      const label = isActive ? `**${f.name}** (active)` : f.name;
      parts.push(`\n### ${label}`);
      parts.push(`Path: ${f.path} | Language: ${f.language}`);
      // Include content (truncated to 2000 chars per file, max 5 files with content)
      if (openFiles.indexOf(f) < 5 && f.content) {
        const truncated = f.content.length > 2000 ? f.content.slice(0, 2000) + '\n... [truncated]' : f.content;
        parts.push('```' + f.language);
        parts.push(truncated);
        parts.push('```');
      }
    }
  }

  return parts.join('\n');
}

/**
 * Build a context-aware system prompt by appending project context.
 */
export function withProjectContext(basePrompt: string): string {
  const ctx = buildProjectContext();
  if (!ctx) return basePrompt;
  return `${basePrompt}\n\n---\n# CURRENT PROJECT CONTEXT\nThe user has the following project open in GiuseCoder. Use this context to understand their codebase and give relevant answers.\n\n${ctx}`;
}
