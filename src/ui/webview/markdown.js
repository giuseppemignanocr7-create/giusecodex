(function () {
  const allowedTags = new Set([
    'A',
    'ABBR',
    'B',
    'BLOCKQUOTE',
    'BR',
    'CAPTION',
    'CODE',
    'DEL',
    'DIV',
    'EM',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'HR',
    'I',
    'KBD',
    'LI',
    'OL',
    'P',
    'PRE',
    'S',
    'SPAN',
    'STRONG',
    'TABLE',
    'TBODY',
    'TD',
    'TH',
    'THEAD',
    'TR',
    'UL'
  ]);

  const allowedAttrs = {
    A: new Set(['href', 'title', 'target', 'rel']),
    CODE: new Set(['class']),
    PRE: new Set(['class', 'data-gc-lang', 'data-gc-path', 'data-gc-code']),
    SPAN: new Set(['class']),
    DIV: new Set(['class'])
  };

  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function sanitizeHtml(inputHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(inputHtml, 'text/html');

    const walk = (node) => {
      const children = Array.from(node.children);
      for (const child of children) {
        const tag = child.tagName.toUpperCase();
        if (!allowedTags.has(tag)) {
          const replacement = document.createTextNode(child.textContent || '');
          child.replaceWith(replacement);
          continue;
        }

        for (const attr of Array.from(child.attributes)) {
          const name = attr.name.toLowerCase();
          const value = attr.value;
          const tagAttrs = allowedAttrs[tag];

          if (!tagAttrs || !tagAttrs.has(attr.name)) {
            child.removeAttribute(attr.name);
            continue;
          }

          if (name === 'href') {
            if (!/^https?:\/\//i.test(value) && !/^mailto:/i.test(value)) {
              child.removeAttribute(attr.name);
            }
          }

          if (name.startsWith('on')) {
            child.removeAttribute(attr.name);
          }
        }

        if (tag === 'A') {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }

        walk(child);
      }
    };

    walk(doc.body);
    return doc.body.innerHTML;
  }

  function normalizeFenceInfo(info) {
    const trimmed = (info || '').trim();
    if (!trimmed) {
      return {
        language: 'text',
        filepath: ''
      };
    }

    const first = trimmed.split(/\s+/)[0] || 'text';
    const second = trimmed.slice(first.length).trim();
    return {
      language: first.toLowerCase(),
      filepath: second
    };
  }

  function createMarkedRenderer() {
    const renderer = new marked.Renderer();

    renderer.code = (token) => {
      const rawCode = typeof token === 'string' ? token : token.text;
      const info = typeof token === 'string' ? '' : token.lang || '';
      const parsed = normalizeFenceInfo(info);
      const encodedCode = encodeURIComponent(rawCode || '');
      const encodedPath = encodeURIComponent(parsed.filepath || '');

      return `<pre class="gc-md-code" data-gc-lang="${escapeHtml(parsed.language)}" data-gc-path="${encodedPath}" data-gc-code="${encodedCode}"><code class="language-${escapeHtml(parsed.language)}">${escapeHtml(rawCode || '')}</code></pre>`;
    };

    renderer.link = ({ href = '', title = '', text = '' }) => {
      const safeHref = /^https?:\/\//i.test(href) || /^mailto:/i.test(href) ? href : '#';
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(safeHref)}"${titleAttr}>${text}</a>`;
    };

    return renderer;
  }

  marked.setOptions({
    gfm: true,
    breaks: true,
    renderer: createMarkedRenderer(),
    headerIds: false,
    mangle: false
  });

  function renderMarkdown(markdownText) {
    try {
      const parsed = marked.parse(markdownText || '');
      return sanitizeHtml(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'rendering error';
      return `<p>Markdown render error: ${escapeHtml(message)}</p>`;
    }
  }

  window.GiuseCoderMarkdown = {
    renderMarkdown,
    sanitizeHtml,
    escapeHtml
  };
})();
