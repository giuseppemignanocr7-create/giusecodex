// NOTE: Do NOT import monaco-editor here — it would pull the entire bundle.
// Instead, receive the monaco namespace from the caller.

const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let abortController: AbortController | null = null;
let registered = false;

function getApiKey(): string {
  return localStorage.getItem('gc_anthropic_key') || '';
}

async function fetchCompletion(
  prefix: string,
  suffix: string,
  language: string,
  signal: AbortSignal,
): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const prompt = `Complete the following ${language} code. Only output the completion text, no explanation, no markdown fences, no backticks. If no completion is appropriate, respond with exactly NONE.

Code before cursor:
\`\`\`
${prefix.slice(-1500)}
\`\`\`

Code after cursor:
\`\`\`
${suffix.slice(0, 500)}
\`\`\`

Completion:`;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model: 'claude-haiku-4-5-20251001',
        apiKey,
        provider: 'anthropic',
        systemPrompt: 'You are a code completion engine. Output ONLY the code that should be inserted at the cursor position. No explanation. No markdown. If nothing to complete, output NONE.',
      }),
      signal,
    });

    if (!res.ok) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let result = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
      if (result.length > 500) break;
    }

    const trimmed = result.trim();
    if (!trimmed || trimmed === 'NONE' || trimmed.startsWith('```')) return null;
    return trimmed;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerInlineCompletion(editor: any): void {
  // Only register the provider once globally
  if (registered || !isLocalhost) return;
  registered = true;

  // Get the monaco namespace from the editor's internal reference
  const monacoNs = (window as any).monaco;
  if (!monacoNs?.languages?.registerInlineCompletionsProvider) return;

  monacoNs.languages.registerInlineCompletionsProvider('*', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideInlineCompletions: async (model: any, position: any, _context: any, token: any) => {
      if (abortController) { abortController.abort(); abortController = null; }
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }

      const completion = await new Promise<string | null>((resolve) => {
        debounceTimer = setTimeout(async () => {
          const ac = new AbortController();
          abortController = ac;

          token.onCancellationRequested(() => ac.abort());

          const offset = model.getOffsetAt(position);
          const fullText = model.getValue();
          const prefix = fullText.slice(0, offset);
          const suffix = fullText.slice(offset);
          const lang = model.getLanguageId();

          const result = await fetchCompletion(prefix, suffix, lang, ac.signal);
          resolve(result);
        }, 600);
      });

      if (!completion || token.isCancellationRequested) return { items: [] };

      return {
        items: [{
          insertText: completion,
          range: new monacoNs.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
        }],
      };
    },
    freeInlineCompletions: () => {},
  });
}
