import { useFileStore } from '../stores/fileStore';

export interface ExtractedFile {
  path: string;
  name: string;
  content: string;
  language: string;
}

const LANG_EXT: Record<string, string> = {
  typescript: 'ts', tsx: 'tsx', javascript: 'js', jsx: 'jsx',
  python: 'py', rust: 'rs', go: 'go', java: 'java', c: 'c', cpp: 'cpp',
  html: 'html', css: 'css', scss: 'scss', json: 'json', markdown: 'md',
  yaml: 'yaml', yml: 'yaml', xml: 'xml', sql: 'sql', shell: 'sh', bash: 'sh',
  dockerfile: 'Dockerfile', toml: 'toml', ini: 'ini',
};

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp',
  html: 'html', css: 'css', scss: 'scss', json: 'json', md: 'markdown',
  yaml: 'yaml', yml: 'yaml', xml: 'xml', sql: 'sql', sh: 'shell',
  toml: 'toml', ini: 'ini',
};

/**
 * Extract code blocks from markdown content.
 * Detects ```lang blocks and optional file path comments.
 * Falls back to detecting raw HTML/code if no fenced blocks found.
 */
export function extractCodeBlocks(markdown: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  // Match ```lang\n...``` blocks, optionally preceded by a file path line
  const codeBlockRegex = /(?:(?:\/\/|#|<!--)\s*(\S+\.\w+)\s*(?:-->)?\s*\n)?```(\w+)?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    const filePathHint = match[1] || '';
    const lang = (match[2] || 'plaintext').toLowerCase();
    const code = match[3].trim();

    if (!code || code.length < 5) continue;

    let fileName = filePathHint;
    if (!fileName) {
      const firstLine = code.split('\n')[0];
      const pathMatch = firstLine.match(/^(?:\/\/|#|\/\*|<!--)\s*(?:file:\s*)?(\S+\.\w+)/);
      if (pathMatch) fileName = pathMatch[1];
    }

    if (!fileName) {
      const ext = LANG_EXT[lang] || lang || 'txt';
      index++;
      fileName = `generated-${index}.${ext}`;
    }

    const name = fileName.split('/').pop() || fileName;
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const language = EXT_LANG[ext] || lang || 'plaintext';

    files.push({ path: `generated/${fileName}`, name, content: code, language });
  }

  // Fallback: if no fenced code blocks, try to detect raw HTML or code
  if (files.length === 0) {
    // Check for raw HTML content
    const htmlMatch = markdown.match(/(<(!DOCTYPE|html)[\s\S]*<\/(html|body)>)/i);
    if (htmlMatch) {
      files.push({ path: 'generated/index.html', name: 'index.html', content: htmlMatch[1].trim(), language: 'html' });
    } else if (/<(div|section|main|header|body|head|style|script)[\s>]/i.test(markdown) && markdown.length > 50) {
      // Partial HTML
      files.push({ path: 'generated/index.html', name: 'index.html', content: markdown.trim(), language: 'html' });
    }
  }

  return files;
}

/**
 * Open extracted code files in the editor tabs.
 */
export function openCodeInEditor(content: string): void {
  const files = extractCodeBlocks(content);
  if (files.length === 0) return;

  const store = useFileStore.getState();

  for (const file of files) {
    // Check if already open with same path
    const existing = store.openFiles.find(f => f.path === file.path);
    if (existing) {
      // Update content
      store.updateContent(file.path, file.content);
    } else {
      store.openFile({
        path: file.path,
        name: file.name,
        content: file.content,
        language: file.language,
        dirty: true,
      });
    }
  }

  // Focus the first new file
  if (files.length > 0) {
    store.setActiveFile(files[0].path);
  }
}
