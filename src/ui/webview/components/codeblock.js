(function () {
  function escapeHtml(text) {
    if (window.GiuseCoderMarkdown && typeof window.GiuseCoderMarkdown.escapeHtml === 'function') {
      return window.GiuseCoderMarkdown.escapeHtml(text);
    }

    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function decodeAttr(value) {
    if (!value) {
      return '';
    }

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function normalizeLanguage(language) {
    const raw = (language || '').toLowerCase().trim();
    if (!raw) {
      return 'text';
    }

    if (raw === 'ts') {
      return 'typescript';
    }
    if (raw === 'js') {
      return 'javascript';
    }
    if (raw === 'shell' || raw === 'sh' || raw === 'zsh') {
      return 'bash';
    }
    if (raw === 'yml') {
      return 'yaml';
    }
    if (raw === 'md') {
      return 'markdown';
    }
    if (raw === 'html') {
      return 'markup';
    }

    return raw;
  }

  function prismLanguage(language) {
    const normalized = normalizeLanguage(language);
    if (normalized === 'text') {
      return '';
    }
    return normalized;
  }

  function highlightCode(code, language) {
    const normalized = prismLanguage(language);

    if (window.Prism && normalized && Prism.languages[normalized]) {
      try {
        return Prism.highlight(code, Prism.languages[normalized], normalized);
      } catch {
        return escapeHtml(code);
      }
    }

    return escapeHtml(code);
  }

  function lineNumberColumn(lineCount) {
    const lines = document.createElement('div');
    lines.className = 'gc-code-lines';

    for (let i = 1; i <= lineCount; i += 1) {
      const line = document.createElement('span');
      line.className = 'gc-code-line-number';
      line.textContent = String(i);
      lines.appendChild(line);
    }

    return lines;
  }

  async function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function createButton(label, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `gc-code-btn ${className}`;
    button.textContent = label;
    return button;
  }

  function makeCodeBlock(config) {
    const language = normalizeLanguage(config.language);
    const filepath = config.filepath || '';
    const code = config.code || '';

    const block = document.createElement('section');
    block.className = 'gc-code-block';

    const header = document.createElement('div');
    header.className = 'gc-code-header';

    const langWrap = document.createElement('div');
    langWrap.className = 'gc-code-lang';
    langWrap.dataset.lang = language;
    langWrap.textContent = language;

    if (filepath) {
      const filepathNode = document.createElement('span');
      filepathNode.className = 'gc-code-filepath';
      filepathNode.textContent = filepath;
      langWrap.appendChild(filepathNode);
    }

    const actions = document.createElement('div');
    actions.className = 'gc-code-actions';

    const wrapButton = createButton('Wrap', 'gc-code-btn-wrap');
    const copyButton = createButton('Copy', 'gc-code-btn-copy');
    const diffButton = createButton('Diff', 'gc-code-btn-diff');
    const applyButton = createButton('Apply', 'gc-code-btn-apply');

    actions.appendChild(wrapButton);
    actions.appendChild(copyButton);
    actions.appendChild(diffButton);
    actions.appendChild(applyButton);

    header.appendChild(langWrap);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'gc-code-body';

    const lines = lineNumberColumn(Math.max(1, code.split('\n').length));

    const pre = document.createElement('pre');
    pre.className = 'gc-code-content';

    const codeNode = document.createElement('code');
    codeNode.className = language !== 'text' ? `language-${language}` : '';
    codeNode.innerHTML = highlightCode(code, language);

    pre.appendChild(codeNode);
    body.appendChild(lines);
    body.appendChild(pre);

    wrapButton.addEventListener('click', () => {
      pre.classList.toggle('wrap');
      wrapButton.textContent = pre.classList.contains('wrap') ? 'NoWrap' : 'Wrap';
    });

    copyButton.addEventListener('click', async () => {
      await copyText(code);
      copyButton.classList.add('copied');
      copyButton.textContent = 'Copied';
      setTimeout(() => {
        copyButton.classList.remove('copied');
        copyButton.textContent = 'Copy';
      }, 900);
    });

    diffButton.addEventListener('click', () => {
      if (config.onDiff) {
        config.onDiff({
          path: filepath,
          code,
          messageId: config.messageId || ''
        });
      }
    });

    applyButton.addEventListener('click', () => {
      if (config.onApply) {
        config.onApply({
          path: filepath,
          code,
          messageId: config.messageId || ''
        });
      }

      applyButton.classList.add('applied');
      applyButton.textContent = 'Applied';
      setTimeout(() => {
        applyButton.classList.remove('applied');
        applyButton.textContent = 'Apply';
      }, 1200);
    });

    block.appendChild(header);
    block.appendChild(body);

    return block;
  }

  function createSkeleton(lines) {
    const block = document.createElement('div');
    block.className = 'gc-code-skeleton';

    const lineCount = Number(lines) > 0 ? Number(lines) : 6;
    for (let i = 0; i < lineCount; i += 1) {
      const line = document.createElement('div');
      line.className = 'gc-code-skeleton-line';
      block.appendChild(line);
    }

    return block;
  }

  function enhanceMessageCodeBlocks(container, context) {
    const nodes = Array.from(container.querySelectorAll('pre.gc-md-code'));
    nodes.forEach((node) => {
      const code = decodeAttr(node.getAttribute('data-gc-code'));
      const language = decodeAttr(node.getAttribute('data-gc-lang'));
      const filepath = decodeAttr(node.getAttribute('data-gc-path'));

      const block = makeCodeBlock({
        code,
        language,
        filepath,
        messageId: context && context.messageId ? context.messageId : '',
        onApply: context && context.onApply,
        onDiff: context && context.onDiff
      });

      node.replaceWith(block);
    });
  }

  window.GiuseCoderCodeBlock = {
    createSkeleton,
    enhanceMessageCodeBlocks,
    makeCodeBlock
  };
})();
