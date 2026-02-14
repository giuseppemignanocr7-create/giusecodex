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

// Smart file naming: assign proper names based on language/content
function smartFileName(lang: string, code: string, existingNames: Set<string>): string {
  const ext = LANG_EXT[lang] || lang || 'txt';

  // HTML → index.html (or page-2.html etc.)
  if (lang === 'html') {
    if (!existingNames.has('index.html')) return 'index.html';
    let i = 2;
    while (existingNames.has(`page-${i}.html`)) i++;
    return `page-${i}.html`;
  }
  // CSS → styles.css
  if (lang === 'css' || lang === 'scss') {
    const base = lang === 'scss' ? 'styles.scss' : 'styles.css';
    if (!existingNames.has(base)) return base;
    let i = 2;
    while (existingNames.has(`styles-${i}.${ext}`)) i++;
    return `styles-${i}.${ext}`;
  }
  // JS/TS → app.js / main.ts etc.
  if (['javascript', 'js'].includes(lang)) {
    if (!existingNames.has('app.js')) return 'app.js';
    if (!existingNames.has('main.js')) return 'main.js';
    let i = 2;
    while (existingNames.has(`script-${i}.js`)) i++;
    return `script-${i}.js`;
  }
  if (['typescript', 'ts'].includes(lang)) {
    if (!existingNames.has('app.ts')) return 'app.ts';
    if (!existingNames.has('main.ts')) return 'main.ts';
    let i = 2;
    while (existingNames.has(`script-${i}.ts`)) i++;
    return `script-${i}.ts`;
  }
  if (lang === 'json') {
    if (code.includes('"dependencies"') || code.includes('"name"')) return 'package.json';
    if (!existingNames.has('data.json')) return 'data.json';
  }
  if (lang === 'python' || lang === 'py') {
    if (!existingNames.has('main.py')) return 'main.py';
    if (!existingNames.has('app.py')) return 'app.py';
  }
  // Generic fallback
  let i = 1;
  let name = `file-${i}.${ext}`;
  while (existingNames.has(name)) { i++; name = `file-${i}.${ext}`; }
  return name;
}

// Derive a project folder name from user request text
function deriveProjectName(userRequest?: string): string {
  if (!userRequest) return `project-${Date.now()}`;
  // Strip common request prefixes
  const cleaned = userRequest
    .replace(/^(crea|create|build|make|genera|scrivi|write|fammi|fai)\s+(un|una|a|an|il|la|lo|the)?\s*/i, '')
    .replace(/\s+(completo|completa|complete|full|per me|please)$/i, '')
    .trim();
  // Convert to kebab-case, max 40 chars
  const slug = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug || `project-${Date.now()}`;
}

/**
 * Extract code blocks from markdown content.
 * Detects ```lang blocks and optional file path comments.
 * Falls back to detecting raw HTML/code if no fenced blocks found.
 */
export function extractCodeBlocks(markdown: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  const usedNames = new Set<string>();

  // Match ```lang\n...``` blocks, optionally preceded by a file path line
  const codeBlockRegex = /(?:(?:\/\/|#|<!--)\s*(\S+\.\w+)\s*(?:-->)?\s*\n)?```(\w+)?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    const filePathHint = match[1] || '';
    const lang = (match[2] || 'plaintext').toLowerCase();
    const code = match[3].trim();

    if (!code || code.length < 5) continue;

    // Try to find file path from hint or first line comment
    let fileName = filePathHint;
    if (!fileName) {
      const firstLine = code.split('\n')[0];
      const pathMatch = firstLine.match(/^(?:\/\/|#|\/\*|<!--)\s*(?:file:\s*)?(.+\.\w+)/);
      if (pathMatch) fileName = pathMatch[1].trim();
    }

    // Smart naming fallback
    if (!fileName) {
      fileName = smartFileName(lang, code, usedNames);
    }

    const name = fileName.split('/').pop() || fileName;
    usedNames.add(name);
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const language = EXT_LANG[ext] || lang || 'plaintext';

    // Path will be set later when we know the project name
    files.push({ path: fileName, name, content: code, language });
  }

  // Fallback: if no fenced code blocks, try to detect raw HTML or code
  if (files.length === 0) {
    const htmlMatch = markdown.match(/(<(!DOCTYPE|html)[\s\S]*<\/(html|body)>)/i);
    if (htmlMatch) {
      files.push({ path: 'index.html', name: 'index.html', content: htmlMatch[1].trim(), language: 'html' });
    } else if (/<(div|section|main|header|body|head|style|script)[\s>]/i.test(markdown) && markdown.length > 50) {
      files.push({ path: 'index.html', name: 'index.html', content: markdown.trim(), language: 'html' });
    }
  }

  return files;
}

/**
 * Open extracted code as a proper project in the file tree + editor tabs.
 * Creates a project folder, organizes files, and triggers preview.
 */
export function openCodeInEditor(content: string, userRequest?: string): void {
  const files = extractCodeBlocks(content);
  if (files.length === 0) return;

  const store = useFileStore.getState();
  const projectName = deriveProjectName(userRequest);

  // Prefix all paths with project folder
  const projectFiles = files.map(f => ({
    ...f,
    path: `${projectName}/${f.name}`,
  }));

  // Use the new addGeneratedProject to create folder in tree + open in editor
  store.addGeneratedProject(projectName, projectFiles);

  // Auto-trigger preview if we have HTML
  const hasHtml = projectFiles.some(f => f.name.endsWith('.html'));
  if (hasHtml) {
    // Small delay so file store updates propagate to PreviewPanel
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('gc:show-preview'));
    }, 200);
  }
}
