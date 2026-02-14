import { memo, useMemo, lazy, Suspense, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Check } from 'lucide-react';

const SyntaxHighlighter = lazy(() =>
  import('react-syntax-highlighter/dist/esm/prism-async-light').then(m => ({ default: m.default }))
);
const vscDarkPlusPromise = import('react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus').then(m => m.default);
let _vscDarkPlus: Record<string, any> | null = null;
vscDarkPlusPromise.then(s => { _vscDarkPlus = s; });

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-base">
      <div className="flex items-center justify-between px-3 py-1 bg-overlay text-[10px] text-muted">
        <span>{language || 'code'}</span>
        <button onClick={handleCopy} className="flex items-center gap-1 hover:text-text transition-colors">
          {copied ? <Check className="w-3 h-3 text-green" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <Suspense fallback={<pre className="p-3 text-xs font-mono bg-[#1a1a2e] overflow-x-auto">{children}</pre>}>
        <SyntaxHighlighter
          language={language || 'text'}
          style={_vscDarkPlus || {}}
          customStyle={{ margin: 0, padding: '12px', fontSize: '12px', background: '#1a1a2e' }}
          wrapLongLines
        >
          {children}
        </SyntaxHighlighter>
      </Suspense>
    </div>
  );
}

export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  const components = useMemo(() => ({
    code({ className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '');
      const text = String(children).replace(/\n$/, '');
      if (match || text.includes('\n')) {
        return <CodeBlock language={match?.[1] || ''} children={text} />;
      }
      return <code className="bg-overlay px-1.5 py-0.5 rounded text-accent text-[11px] font-mono" {...props}>{children}</code>;
    },
    p({ children }: any) { return <p className="mb-1.5 leading-relaxed">{children}</p>; },
    ul({ children }: any) { return <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>; },
    ol({ children }: any) { return <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>; },
    h1({ children }: any) { return <h1 className="text-sm font-bold text-accent mb-1">{children}</h1>; },
    h2({ children }: any) { return <h2 className="text-xs font-bold text-accent mb-1">{children}</h2>; },
    h3({ children }: any) { return <h3 className="text-xs font-semibold text-text mb-1">{children}</h3>; },
    blockquote({ children }: any) { return <blockquote className="border-l-2 border-accent/30 pl-3 italic text-muted">{children}</blockquote>; },
    a({ href, children }: any) { return <a href={href} target="_blank" rel="noopener" className="text-accent hover:underline">{children}</a>; },
    strong({ children }: any) { return <strong className="font-semibold text-text">{children}</strong>; },
    table({ children }: any) { return <table className="border-collapse text-[11px] my-1.5 w-full">{children}</table>; },
    th({ children }: any) { return <th className="border border-base px-2 py-1 bg-overlay text-left font-semibold">{children}</th>; },
    td({ children }: any) { return <td className="border border-base px-2 py-1">{children}</td>; },
  }), []);

  return (
    <div className="text-xs text-text/90 leading-relaxed prose-compact">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  );
});
