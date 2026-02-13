(function () {
  const SLASH_COMMANDS = [
    { value: '/fix', title: '/fix', description: 'Fix active file issues' },
    { value: '/explain', title: '/explain', description: 'Explain selected code' },
    { value: '/refactor', title: '/refactor', description: 'Refactor selected code' },
    { value: '/test', title: '/test', description: 'Generate unit tests' },
    { value: '/commit', title: '/commit', description: 'Generate commit message' },
    { value: '/review', title: '/review', description: 'Review active file' },
    { value: '/doc', title: '/doc', description: 'Generate documentation' },
    { value: '/optimize', title: '/optimize', description: 'Suggest optimizations' },
    { value: '/agent', title: '/agent', description: 'Enter agent mode' },
    { value: '/model ', title: '/model', description: 'Switch active model' },
    { value: '/clear', title: '/clear', description: 'Clear chat' },
    { value: '/cost', title: '/cost', description: 'Show session cost report' }
  ];

  class InputController {
    constructor(options) {
      this.field = options.field;
      this.tagsHost = options.tagsHost;
      this.menu = options.menu;
      this.sendButton = options.sendButton;
      this.attachButton = options.attachButton;
      this.commandButton = options.commandButton;
      this.stopButton = options.stopButton;
      this.container = options.container;

      this.onSend = options.onSend;
      this.onCancel = options.onCancel;
      this.onClear = options.onClear;
      this.onSearchMentions = options.onSearchMentions;
      this.onTagsChange = options.onTagsChange;

      this.model = options.model || '';
      this.tags = [];
      this.history = [];
      this.historyCursor = 0;

      this.menuState = {
        open: false,
        type: '',
        items: [],
        activeIndex: 0,
        requestId: '',
        query: '',
        triggerStart: -1,
        triggerEnd: -1
      };

      this.bind();
      this.autoResize();
      this.renderTags();
      this.updateSendState();
    }

    bind() {
      this.field.addEventListener('input', () => {
        this.autoResize();
        this.detectTrigger();
        this.updateSendState();
      });

      this.field.addEventListener('keydown', (event) => {
        this.onKeyDown(event);
      });

      this.sendButton.addEventListener('click', () => {
        this.sendCurrentInput();
      });

      this.attachButton.addEventListener('click', () => {
        this.openMentionMenu('');
      });

      this.commandButton.addEventListener('click', () => {
        this.openSlashMenu('');
      });

      this.stopButton.addEventListener('click', () => {
        if (this.onCancel) {
          this.onCancel();
        }
      });

      this.menu.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
    }

    setModel(model) {
      this.model = model;
    }

    getModel() {
      return this.model;
    }

    getTags() {
      return this.tags.slice();
    }

    setMentionResults(requestId, items) {
      if (!this.menuState.open || this.menuState.type !== 'mention') {
        return;
      }

      if (requestId !== this.menuState.requestId) {
        return;
      }

      this.menuState.items = (Array.isArray(items) ? items : []).map((item) => ({
        id: item.id,
        type: item.type,
        value: item.value,
        title: item.label,
        subtitle: item.description
      }));
      this.menuState.activeIndex = 0;
      this.renderMenu();
    }

    setValue(text) {
      this.field.value = text || '';
      this.field.selectionStart = this.field.value.length;
      this.field.selectionEnd = this.field.value.length;
      this.autoResize();
      this.updateSendState();
    }

    focus(prefill) {
      if (typeof prefill === 'string' && prefill.length) {
        this.setValue(prefill);
      }

      this.field.focus();
    }

    clear() {
      this.tags = [];
      this.renderTags();
      this.setValue('');
      this.closeMenu();
    }

    removeTagById(tagId) {
      const before = this.tags.length;
      this.tags = this.tags.filter((tag) => tag.id !== tagId);
      if (this.tags.length !== before) {
        this.renderTags();
      }
    }

    addTag(tag) {
      if (!tag || !tag.id) {
        return;
      }

      if (this.tags.some((existing) => existing.id === tag.id)) {
        return;
      }

      this.tags.push({
        id: tag.id,
        type: tag.type,
        value: tag.value,
        label: tag.label || tag.title || tag.value
      });

      this.renderTags();
    }

    renderTags() {
      this.tagsHost.innerHTML = '';

      this.tags.forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'gc-input-tag';
        chip.textContent = tag.label;

        const remove = document.createElement('span');
        remove.className = 'remove';
        remove.innerHTML = '<i class="codicon codicon-close"></i>';
        remove.addEventListener('click', () => {
          this.removeTagById(tag.id);
        });

        chip.appendChild(remove);
        this.tagsHost.appendChild(chip);
      });

      this.notifyTagsChange();
    }

    notifyTagsChange() {
      if (typeof this.onTagsChange === 'function') {
        this.onTagsChange(this.tags.slice());
      }
    }

    onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
          navigator.clipboard.readText().then((text) => {
            this.insertTextAtCursor(text || '');
          });
        }
        return;
      }

      if (this.menuState.open) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.menuState.activeIndex = Math.min(this.menuState.items.length - 1, this.menuState.activeIndex + 1);
          this.renderMenu();
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          this.menuState.activeIndex = Math.max(0, this.menuState.activeIndex - 1);
          this.renderMenu();
          return;
        }

        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          const item = this.menuState.items[this.menuState.activeIndex];
          if (item) {
            this.selectMenuItem(item);
          }
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          this.closeMenu();
          return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'l') {
        event.preventDefault();
        if (this.onClear) {
          this.onClear();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'ArrowUp') {
        event.preventDefault();
        this.recallHistory(-1);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'ArrowDown') {
        event.preventDefault();
        this.recallHistory(1);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (this.onCancel) {
          this.onCancel();
        }
        this.closeMenu();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.sendCurrentInput();
      }
    }

    sendCurrentInput() {
      const text = this.field.value.trim();
      if (!text) {
        return;
      }

      this.history.push(this.field.value);
      if (this.history.length > 40) {
        this.history = this.history.slice(this.history.length - 40);
      }
      this.historyCursor = this.history.length;

      const payload = {
        text,
        model: this.model,
        tags: this.tags.slice()
      };

      if (this.onSend) {
        this.onSend(payload);
      }

      this.field.value = '';
      this.autoResize();
      this.closeMenu();
      this.updateSendState();
    }

    recallHistory(direction) {
      if (!this.history.length) {
        return;
      }

      this.historyCursor = Math.max(0, Math.min(this.history.length, this.historyCursor + direction));

      if (this.historyCursor === this.history.length) {
        this.setValue('');
        return;
      }

      this.setValue(this.history[this.historyCursor]);
    }

    detectTrigger() {
      const cursor = this.field.selectionStart;
      if (cursor !== this.field.selectionEnd) {
        this.closeMenu();
        return;
      }

      const before = this.field.value.slice(0, cursor);
      const mentionMatch = before.match(/(^|\s)@([^\s@/]*)$/);
      if (mentionMatch) {
        const query = mentionMatch[2] || '';
        const start = cursor - mentionMatch[2].length - 1;
        this.openMentionMenu(query, start, cursor);
        return;
      }

      const slashMatch = before.match(/(^|\s)\/([^\s/]*)$/);
      if (slashMatch) {
        const query = slashMatch[2] || '';
        const start = cursor - slashMatch[2].length - 1;
        this.openSlashMenu(query, start, cursor);
        return;
      }

      this.closeMenu();
    }

    openMentionMenu(query, triggerStart, triggerEnd) {
      const requestId = `mentions-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

      this.menuState.open = true;
      this.menuState.type = 'mention';
      this.menuState.items = [];
      this.menuState.activeIndex = 0;
      this.menuState.requestId = requestId;
      this.menuState.query = query || '';
      this.menuState.triggerStart = Number.isFinite(triggerStart) ? triggerStart : this.field.selectionStart;
      this.menuState.triggerEnd = Number.isFinite(triggerEnd) ? triggerEnd : this.field.selectionStart;

      this.renderMenu();

      if (this.onSearchMentions) {
        this.onSearchMentions({
          query: this.menuState.query,
          requestId
        });
      }
    }

    openSlashMenu(query, triggerStart, triggerEnd) {
      const normalized = (query || '').toLowerCase();
      const filtered = SLASH_COMMANDS.filter((entry) => {
        const haystack = `${entry.title} ${entry.description}`.toLowerCase();
        return haystack.includes(normalized);
      });

      this.menuState.open = true;
      this.menuState.type = 'slash';
      this.menuState.items = filtered.map((entry) => ({
        id: entry.value,
        type: 'slash',
        value: entry.value,
        title: entry.title,
        subtitle: entry.description
      }));
      this.menuState.activeIndex = 0;
      this.menuState.requestId = '';
      this.menuState.query = query || '';
      this.menuState.triggerStart = Number.isFinite(triggerStart) ? triggerStart : this.field.selectionStart;
      this.menuState.triggerEnd = Number.isFinite(triggerEnd) ? triggerEnd : this.field.selectionStart;

      this.renderMenu();
    }

    renderMenu() {
      if (!this.menuState.open) {
        this.menu.hidden = true;
        this.menu.innerHTML = '';
        return;
      }

      this.menu.hidden = false;
      this.menu.innerHTML = '';

      if (!this.menuState.items.length) {
        const empty = document.createElement('div');
        empty.className = 'gc-input-menu-item';
        empty.innerHTML = '<span class="gc-input-menu-title">No results</span>';
        this.menu.appendChild(empty);
        return;
      }

      this.menuState.items.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `gc-input-menu-item ${index === this.menuState.activeIndex ? 'active' : ''}`;

        const title = document.createElement('span');
        title.className = 'gc-input-menu-title';
        title.textContent = item.title;

        const subtitle = document.createElement('span');
        subtitle.className = 'gc-input-menu-subtitle';
        subtitle.textContent = item.subtitle || '';

        button.appendChild(title);
        button.appendChild(subtitle);

        button.addEventListener('click', () => {
          this.selectMenuItem(item);
        });

        this.menu.appendChild(button);
      });
    }

    selectMenuItem(item) {
      if (this.menuState.type === 'mention') {
        this.replaceTriggerText('');
        this.addTag({
          id: item.id,
          type: item.type,
          value: item.value,
          label: item.title
        });
      } else if (this.menuState.type === 'slash') {
        const commandText = String(item.value || '');
        const suffix = commandText.endsWith(' ') ? '' : ' ';
        this.replaceTriggerText(commandText + suffix);
      }

      this.closeMenu();
      this.field.focus();
      this.updateSendState();
    }

    replaceTriggerText(replacement) {
      const value = this.field.value;
      const start = Math.max(0, this.menuState.triggerStart);
      const end = Math.max(start, this.menuState.triggerEnd);

      this.field.value = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
      const nextCursor = start + replacement.length;
      this.field.selectionStart = nextCursor;
      this.field.selectionEnd = nextCursor;
      this.autoResize();
    }

    closeMenu() {
      this.menuState.open = false;
      this.menuState.type = '';
      this.menuState.items = [];
      this.menuState.activeIndex = 0;
      this.menuState.requestId = '';
      this.menuState.triggerStart = -1;
      this.menuState.triggerEnd = -1;

      this.menu.hidden = true;
      this.menu.innerHTML = '';
    }

    autoResize() {
      this.field.style.height = 'auto';
      const nextHeight = Math.max(24, Math.min(this.field.scrollHeight, 180));
      this.field.style.height = `${nextHeight}px`;
    }

    insertTextAtCursor(text) {
      const start = this.field.selectionStart;
      const end = this.field.selectionEnd;
      const value = this.field.value;

      this.field.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
      const next = start + text.length;
      this.field.selectionStart = next;
      this.field.selectionEnd = next;
      this.autoResize();
      this.updateSendState();
    }

    updateSendState() {
      const hasText = this.field.value.trim().length > 0;
      this.sendButton.disabled = !hasText;
    }
  }

  function createInputController(options) {
    return new InputController(options);
  }

  window.GiuseCoderInput = {
    createInputController,
    slashCommands: SLASH_COMMANDS.slice()
  };
})();
