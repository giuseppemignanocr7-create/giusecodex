// Agent Tool Loop — parse tool calls from AI responses and execute them

export interface ToolCall {
  tool: string;
  args: Record<string, string>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
}

// Parse tool calls from AI response text
// Format: <tool_call tool="read_file" path="src/App.tsx" />
// or multi-line: <tool_call tool="write_file" path="src/foo.ts">content here</tool_call>
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Self-closing: <tool_call tool="name" arg1="val1" arg2="val2" />
  const selfClosing = /<tool_call\s+([^/]*?)\/>/g;
  let match;
  while ((match = selfClosing.exec(text)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (attrs.tool) {
      const { tool, ...args } = attrs;
      calls.push({ tool, args });
    }
  }

  // With body: <tool_call tool="name" path="...">body</tool_call>
  const withBody = /<tool_call\s+([^>]*?)>([\s\S]*?)<\/tool_call>/g;
  while ((match = withBody.exec(text)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (attrs.tool) {
      const { tool, ...args } = attrs;
      args.content = match[2];
      calls.push({ tool, args });
    }
  }

  return calls;
}

function parseAttributes(str: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = regex.exec(str)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

// Execute a single tool call
export async function executeTool(call: ToolCall): Promise<ToolResult> {
  try {
    switch (call.tool) {
      case 'read_file': {
        const path = call.args.path;
        if (!path) return { tool: call.tool, success: false, output: 'Missing path argument' };
        const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        if (!res.ok) return { tool: call.tool, success: false, output: data.error || 'Read failed' };
        return { tool: call.tool, success: true, output: data.content.slice(0, 20000) };
      }

      case 'write_file': {
        const path = call.args.path;
        const content = call.args.content || '';
        if (!path) return { tool: call.tool, success: false, output: 'Missing path argument' };
        const res = await fetch('/api/files/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content }),
        });
        const data = await res.json();
        if (!res.ok) return { tool: call.tool, success: false, output: data.error || 'Write failed' };
        return { tool: call.tool, success: true, output: `Written ${content.length} bytes to ${path}` };
      }

      case 'run_command': {
        const command = call.args.command;
        if (!command) return { tool: call.tool, success: false, output: 'Missing command argument' };
        const res = await fetch('/api/terminal/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, timeout: 15000 }),
        });
        const data = await res.json();
        if (!res.ok) return { tool: call.tool, success: false, output: data.error || 'Exec failed' };
        const output = [
          data.stdout ? `STDOUT:\n${data.stdout.slice(0, 10000)}` : '',
          data.stderr ? `STDERR:\n${data.stderr.slice(0, 5000)}` : '',
          `Exit code: ${data.exitCode}`,
        ].filter(Boolean).join('\n');
        return { tool: call.tool, success: data.exitCode === 0, output };
      }

      case 'search_files': {
        const query = call.args.query || call.args.q;
        if (!query) return { tool: call.tool, success: false, output: 'Missing query argument' };
        const params = new URLSearchParams({ q: query });
        if (call.args.ext) params.set('ext', call.args.ext);
        const res = await fetch(`/api/files/search?${params}`);
        const data = await res.json();
        if (!res.ok) return { tool: call.tool, success: false, output: data.error || 'Search failed' };
        const lines = (data.results || []).slice(0, 30).map(
          (r: { file: string; line: number; text: string }) => `${r.file}:${r.line}: ${r.text}`
        );
        return { tool: call.tool, success: true, output: lines.join('\n') || 'No results' };
      }

      case 'list_files': {
        const path = call.args.path || '.';
        const res = await fetch(`/api/files/tree?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        if (!res.ok) return { tool: call.tool, success: false, output: (data as any).error || 'List failed' };
        const flatList = flattenTree(data, '', 0);
        return { tool: call.tool, success: true, output: flatList.slice(0, 5000) };
      }

      default:
        return { tool: call.tool, success: false, output: `Unknown tool: ${call.tool}` };
    }
  } catch (err) {
    return { tool: call.tool, success: false, output: `Error: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

function flattenTree(nodes: any[], prefix: string, depth: number): string {
  if (depth > 3) return '';
  let result = '';
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    if (node.type === 'directory') {
      result += `${indent}📁 ${node.name}/\n`;
      if (node.children) result += flattenTree(node.children, prefix, depth + 1);
    } else {
      result += `${indent}📄 ${node.name}\n`;
    }
  }
  return result;
}

// Format tool results as a message for the AI
export function formatToolResults(results: ToolResult[]): string {
  return results.map(r =>
    `<tool_result tool="${r.tool}" success="${r.success}">\n${r.output}\n</tool_result>`
  ).join('\n\n');
}

// Check if response contains tool calls
export function hasToolCalls(text: string): boolean {
  return /<tool_call\s/.test(text);
}

// Tool definitions to inject into system prompt
export const TOOL_DEFINITIONS = `
You have access to the following tools to help complete tasks. Use them when needed:

<available_tools>
- read_file: Read a file's content
  Usage: <tool_call tool="read_file" path="src/App.tsx" />

- write_file: Create or overwrite a file
  Usage: <tool_call tool="write_file" path="src/new.ts">file content here</tool_call>

- run_command: Execute a shell command
  Usage: <tool_call tool="run_command" command="npm install express" />

- search_files: Search for text across project files
  Usage: <tool_call tool="search_files" query="useState" ext="tsx" />

- list_files: List project file structure
  Usage: <tool_call tool="list_files" path="src" />
</available_tools>

When you need information from the project, use tools first before guessing. You can use multiple tools in one response. After tool results are provided, give your final answer.`;
