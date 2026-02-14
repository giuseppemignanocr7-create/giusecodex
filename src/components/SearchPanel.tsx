import { useState, useRef, useCallback } from 'react';
import { Search, FileText, X, Filter } from 'lucide-react';
import { useFileStore } from '../stores/fileStore';

interface SearchResult {
  file: string;
  line: number;
  text: string;
}

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [ext, setExt] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string, extension: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (extension) params.set('ext', extension);
      const res = await fetch(`/api/files/search?${params}`);
      const data = await res.json();
      setResults(data.results || []);
      setTruncated(data.truncated || false);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val, ext), 300);
  };

  const handleExtChange = (val: string) => {
    setExt(val);
    if (query.trim()) doSearch(query, val);
  };

  const openResult = (r: SearchResult) => {
    const name = r.file.split('/').pop() || r.file.split('\\').pop() || r.file;
    // Read file content then open
    fetch(`/api/files/read?path=${encodeURIComponent(r.file)}`)
      .then(res => res.json())
      .then(data => {
        useFileStore.getState().openFile({
          path: r.file,
          name,
          content: data.content || '',
          language: '',
          dirty: false,
        });
      })
      .catch(() => {
        // Open with empty content as fallback
        useFileStore.getState().openFile({
          path: r.file,
          name,
          content: '',
          language: '',
          dirty: false,
        });
      });
  };

  // Group results by file
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.file]) acc[r.file] = [];
    acc[r.file].push(r);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col bg-surface">
      <div className="px-3 py-2 border-b border-base space-y-1.5">
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Search in project..."
            className="flex-1 bg-overlay rounded px-2 py-1 text-xs text-text placeholder-muted outline-none focus:ring-1 focus:ring-accent"
            autoFocus
          />
          <button
            onClick={() => setShowFilter(!showFilter)}
            className={`p-1 rounded transition-colors ${showFilter ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text hover:bg-overlay'}`}
            title="Filter by extension"
          >
            <Filter className="w-3 h-3" />
          </button>
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); }} className="p-1 text-muted hover:text-text rounded hover:bg-overlay">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {showFilter && (
          <input
            type="text"
            value={ext}
            onChange={(e) => handleExtChange(e.target.value)}
            placeholder="File extension (e.g. ts, tsx, css)"
            className="w-full bg-overlay rounded px-2 py-1 text-xs text-text placeholder-muted outline-none focus:ring-1 focus:ring-accent"
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-3 py-4 text-center text-muted text-xs">Searching...</div>
        )}

        {!loading && query && results.length === 0 && (
          <div className="px-3 py-4 text-center text-muted text-xs">No results found</div>
        )}

        {!loading && Object.entries(grouped).map(([file, hits]) => (
          <div key={file} className="border-b border-base">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-overlay/50 text-[10px] text-muted font-medium">
              <FileText className="w-3 h-3" />
              <span className="truncate">{file}</span>
              <span className="ml-auto text-muted/60">{hits.length}</span>
            </div>
            {hits.map((r, i) => (
              <button
                key={`${r.file}-${r.line}-${i}`}
                onClick={() => openResult(r)}
                className="w-full text-left px-3 py-1 text-xs hover:bg-overlay transition-colors flex items-start gap-2"
              >
                <span className="text-muted text-[10px] w-8 text-right shrink-0 pt-0.5">{r.line}</span>
                <span className="text-text truncate font-mono text-[11px]">
                  {highlightMatch(r.text, query)}
                </span>
              </button>
            ))}
          </div>
        ))}

        {truncated && (
          <div className="px-3 py-2 text-center text-yellow text-[10px]">
            Results truncated to 200 matches. Refine your search.
          </div>
        )}

        {!query && !loading && (
          <div className="px-3 py-8 text-center text-muted text-xs">
            <Search className="w-5 h-5 mx-auto mb-2 opacity-20" />
            Type to search across all project files
          </div>
        )}
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-accent/30 text-accent font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}
