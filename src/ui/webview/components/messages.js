(function () {
  function formatTime(timestamp) {
    const date = new Date(timestamp || Date.now());
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function iconForRole(role) {
    if (role === 'assistant') {
      return '<i class="codicon codicon-hubot"></i>';
    }
    if (role === 'error') {
      return '<i class="codicon codicon-error"></i>';
    }
    if (role === 'notice') {
      return '<i class="codicon codicon-info"></i>';
    }
    return '<i class="codicon codicon-person"></i>';
  }

  function roleLabel(role) {
    if (role === 'assistant') {
      return 'GiuseCoder';
    }
    if (role === 'notice') {
      return 'System';
    }
    if (role === 'error') {
      return 'Error';
    }
    return 'You';
  }

  function parseMessageRoleClass(role) {
    if (role === 'assistant') {
      return 'gc-message-assistant';
    }
    if (role === 'error') {
      return 'gc-message-error';
    }
    if (role === 'notice') {
      return 'gc-message-notice';
    }
    return 'gc-message-user';
  }

  function normalizeMessage(message) {
    return {
      id: message.id || `msg-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      role: message.role || 'assistant',
      content: typeof message.content === 'string' ? message.content : '',
      streamText: typeof message.streamText === 'string' ? message.streamText : '',
      streaming: Boolean(message.streaming),
      model: message.model || '',
      timestamp: message.timestamp || Date.now(),
      toolEvents: message.toolEvents || {},
      toolOrder: Array.isArray(message.toolOrder) ? message.toolOrder : [],
      diff: message.diff || null,
      sourcePrompt: message.sourcePrompt || ''
    };
  }

  function estimateHeight(message) {
    const text = message.streaming ? message.streamText : message.content;
    const base = 88;
    const textSize = Math.min(420, Math.ceil((text || '').length * 0.22));
    const toolSize = (message.toolOrder ? message.toolOrder.length : 0) * 52;
    const diffSize = message.diff && Array.isArray(message.diff.lines) ? Math.min(260, message.diff.lines.length * 16 + 38) : 0;
    return base + textSize + toolSize + diffSize;
  }

  function attachLinkInterceptor(element, onOpenExternal) {
    if (!onOpenExternal) {
      return;
    }

    const links = element.querySelectorAll('a[href]');
    links.forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const href = link.getAttribute('href') || '';
        if (href && href !== '#') {
          onOpenExternal(href);
        }
      });
    });
  }

  function thinkingIndicator() {
    const root = document.createElement('div');
    root.className = 'gc-thinking';

    const bar = document.createElement('div');
    bar.className = 'gc-thinking-bar';

    for (let i = 0; i < 5; i += 1) {
      const segment = document.createElement('span');
      segment.className = 'gc-thinking-segment';
      bar.appendChild(segment);
    }

    const label = document.createElement('span');
    label.className = 'gc-thinking-label';
    label.textContent = 'Thinking';

    root.appendChild(bar);
    root.appendChild(label);
    return root;
  }

  class MessagesController {
    constructor(options) {
      this.root = options.root;
      this.onApply = options.onApply;
      this.onDiff = options.onDiff;
      this.onOpenExternal = options.onOpenExternal;
      this.onRegenerate = options.onRegenerate;
      this.onCopyMessage = options.onCopyMessage;
      this.onEditMessage = options.onEditMessage;

      this.messages = [];
      this.heightMap = new Map();
      this.streamState = new Map();
      this.renderScheduled = false;
      this.measureScheduled = false;
      this.virtualEnabled = false;

      this.topSpacer = document.createElement('div');
      this.topSpacer.className = 'gc-virtual-spacer';

      this.list = document.createElement('div');
      this.list.className = 'gc-message-list';

      this.bottomSpacer = document.createElement('div');
      this.bottomSpacer.className = 'gc-virtual-spacer';

      this.root.innerHTML = '';
      this.root.appendChild(this.topSpacer);
      this.root.appendChild(this.list);
      this.root.appendChild(this.bottomSpacer);

      this.root.addEventListener('scroll', () => {
        if (this.virtualEnabled) {
          this.scheduleRender();
        }
      });
    }

    clear() {
      this.messages = [];
      this.heightMap.clear();
      this.streamState.forEach((entry) => {
        if (entry.raf) {
          cancelAnimationFrame(entry.raf);
        }
      });
      this.streamState.clear();
      this.virtualEnabled = false;
      this.scheduleRender();
    }

    setMessages(messages) {
      this.messages = messages.map((message) => normalizeMessage(message));
      this.virtualEnabled = this.messages.length > 50;
      this.scheduleRender();
    }

    addMessage(message) {
      const normalized = normalizeMessage(message);
      this.messages.push(normalized);
      this.virtualEnabled = this.messages.length > 50;
      this.scheduleRender();
    }

    updateMessage(id, patch) {
      const index = this.messages.findIndex((message) => message.id === id);
      if (index === -1) {
        return;
      }

      this.messages[index] = {
        ...this.messages[index],
        ...patch
      };

      this.scheduleRender();
    }

    appendStreamToken(messageId, token) {
      const message = this.messages.find((entry) => entry.id === messageId);
      if (!message) {
        return;
      }

      message.streaming = true;
      message.streamText += token;

      let streamEntry = this.streamState.get(messageId);
      if (!streamEntry) {
        streamEntry = {
          pending: '',
          raf: 0
        };
        this.streamState.set(messageId, streamEntry);
      }

      streamEntry.pending += token;

      if (!streamEntry.raf) {
        streamEntry.raf = requestAnimationFrame(() => {
          const target = this.list.querySelector(`[data-message-id="${messageId}"] .gc-stream-live`);
          if (target) {
            target.textContent += streamEntry.pending;

            const skeletonHost = this.list.querySelector(`[data-message-id="${messageId}"] .gc-code-skeleton-host`);
            if (skeletonHost) {
              const unmatchedFence = (target.textContent.match(/```/g) || []).length % 2 === 1;
              skeletonHost.innerHTML = '';
              if (unmatchedFence && window.GiuseCoderCodeBlock && typeof window.GiuseCoderCodeBlock.createSkeleton === 'function') {
                skeletonHost.appendChild(window.GiuseCoderCodeBlock.createSkeleton(5));
              }
            }
          }

          streamEntry.pending = '';
          streamEntry.raf = 0;
          if (this.isNearBottom()) {
            this.scrollToBottom(false);
          }
        });
      }
    }

    finalizeAssistant(messageId, payload) {
      const index = this.messages.findIndex((entry) => entry.id === messageId);
      if (index === -1) {
        return;
      }

      this.messages[index] = {
        ...this.messages[index],
        streaming: false,
        streamText: '',
        content: typeof payload.text === 'string' ? payload.text : this.messages[index].content,
        model: payload.model || this.messages[index].model
      };

      const streamEntry = this.streamState.get(messageId);
      if (streamEntry && streamEntry.raf) {
        cancelAnimationFrame(streamEntry.raf);
      }
      this.streamState.delete(messageId);

      this.scheduleRender();
    }

    upsertToolEvent(messageId, event) {
      const message = this.messages.find((entry) => entry.id === messageId);
      if (!message) {
        return;
      }

      if (!message.toolEvents[event.id]) {
        message.toolOrder.push(event.id);
      }

      message.toolEvents[event.id] = {
        ...(message.toolEvents[event.id] || {}),
        ...event
      };

      const toolHost = this.list.querySelector(`[data-message-id="${messageId}"] .gc-tool-host`);
      if (toolHost && window.GiuseCoderToolCall && typeof window.GiuseCoderToolCall.upsertToolCall === 'function') {
        window.GiuseCoderToolCall.upsertToolCall(toolHost, message.toolEvents[event.id]);
      }

      this.scheduleMeasure();
    }

    setDiff(messageId, diff) {
      const message = this.messages.find((entry) => entry.id === messageId);
      if (!message) {
        return;
      }

      message.diff = diff;
      this.scheduleRender();
    }

    isNearBottom() {
      const threshold = 120;
      const distance = this.root.scrollHeight - (this.root.scrollTop + this.root.clientHeight);
      return distance <= threshold;
    }

    scrollToBottom(smooth) {
      this.root.scrollTo({
        top: this.root.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }

    getMessages() {
      return this.messages.slice();
    }

    scheduleRender() {
      if (this.renderScheduled) {
        return;
      }

      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.render();
      });
    }

    scheduleMeasure() {
      if (this.measureScheduled) {
        return;
      }

      this.measureScheduled = true;
      requestAnimationFrame(() => {
        this.measureScheduled = false;
        this.measureVisibleRows();
      });
    }

    buildOffsets() {
      const offsets = [0];
      for (let i = 0; i < this.messages.length; i += 1) {
        const current = offsets[i] + (this.heightMap.get(i) || estimateHeight(this.messages[i]));
        offsets.push(current);
      }
      return offsets;
    }

    findOffsetIndex(offsets, target) {
      let low = 0;
      let high = offsets.length - 1;

      while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        if (offsets[mid] <= target) {
          low = mid;
        } else {
          high = mid - 1;
        }
      }

      return low;
    }

    render() {
      const count = this.messages.length;
      if (!count) {
        this.topSpacer.style.height = '0px';
        this.bottomSpacer.style.height = '0px';
        this.list.innerHTML = '';
        return;
      }

      const stickToBottom = this.isNearBottom();

      let start = 0;
      let end = count - 1;
      let topHeight = 0;
      let bottomHeight = 0;

      if (this.virtualEnabled) {
        const offsets = this.buildOffsets();
        const bufferPx = 400;
        const viewportTop = this.root.scrollTop;
        const viewportBottom = viewportTop + this.root.clientHeight;

        start = Math.max(0, this.findOffsetIndex(offsets, Math.max(0, viewportTop - bufferPx)) - 1);
        end = Math.min(count - 1, this.findOffsetIndex(offsets, viewportBottom + bufferPx) + 1);

        topHeight = offsets[start] || 0;
        bottomHeight = Math.max(0, offsets[count] - (offsets[end + 1] || offsets[count]));
      }

      this.topSpacer.style.height = `${topHeight}px`;
      this.bottomSpacer.style.height = `${bottomHeight}px`;
      this.list.innerHTML = '';

      for (let i = start; i <= end; i += 1) {
        const node = this.createMessageNode(this.messages[i], i);
        this.list.appendChild(node);
      }

      this.scheduleMeasure();

      if (stickToBottom) {
        this.scrollToBottom(false);
      }
    }

    measureVisibleRows() {
      const rows = Array.from(this.list.children);
      let changed = false;

      rows.forEach((row) => {
        const index = Number(row.dataset.index);
        if (Number.isNaN(index)) {
          return;
        }

        const measured = Math.ceil(row.getBoundingClientRect().height);
        const previous = this.heightMap.get(index);
        if (!previous || Math.abs(previous - measured) > 2) {
          this.heightMap.set(index, measured);
          changed = true;
        }
      });

      if (changed && this.virtualEnabled) {
        this.scheduleRender();
      }
    }

    createMessageNode(message, index) {
      const row = document.createElement('article');
      row.className = `gc-message ${parseMessageRoleClass(message.role)}`;
      row.dataset.index = String(index);
      row.dataset.messageId = message.id;

      const header = document.createElement('div');
      header.className = 'gc-message-header';

      const avatar = document.createElement('span');
      avatar.className = `gc-avatar ${message.role === 'assistant' ? 'gc-avatar-assistant' : 'gc-avatar-user'}`;
      if (message.role === 'assistant' && message.streaming) {
        avatar.classList.add('streaming');
      }
      avatar.innerHTML = iconForRole(message.role);

      const name = document.createElement('span');
      name.className = 'gc-message-name';
      name.textContent = roleLabel(message.role);

      header.appendChild(avatar);
      header.appendChild(name);

      if (message.model && message.role === 'assistant') {
        const model = document.createElement('span');
        model.className = 'gc-message-model';
        model.textContent = message.model;
        header.appendChild(model);
      }

      const time = document.createElement('span');
      time.className = 'gc-message-time';
      time.textContent = formatTime(message.timestamp);
      header.appendChild(time);

      row.appendChild(header);
      row.appendChild(this.createActions(message));

      const content = document.createElement('div');
      content.className = 'gc-message-content';

      if (message.streaming) {
        const live = document.createElement('pre');
        live.className = 'gc-stream-live';
        live.textContent = message.streamText;
        content.appendChild(live);

        const skeletonHost = document.createElement('div');
        skeletonHost.className = 'gc-code-skeleton-host';
        const unmatchedFence = (message.streamText.match(/```/g) || []).length % 2 === 1;
        if (unmatchedFence && window.GiuseCoderCodeBlock && typeof window.GiuseCoderCodeBlock.createSkeleton === 'function') {
          skeletonHost.appendChild(window.GiuseCoderCodeBlock.createSkeleton(5));
        }
        content.appendChild(skeletonHost);

        content.appendChild(thinkingIndicator());
      } else {
        const markdownRenderer = window.GiuseCoderMarkdown && typeof window.GiuseCoderMarkdown.renderMarkdown === 'function';
        content.innerHTML = markdownRenderer ? window.GiuseCoderMarkdown.renderMarkdown(message.content || '') : message.content || '';

        if (window.GiuseCoderCodeBlock && typeof window.GiuseCoderCodeBlock.enhanceMessageCodeBlocks === 'function') {
          window.GiuseCoderCodeBlock.enhanceMessageCodeBlocks(content, {
            messageId: message.id,
            onApply: this.onApply,
            onDiff: this.onDiff
          });
        }

        attachLinkInterceptor(content, this.onOpenExternal);
      }

      row.appendChild(content);

      const toolHost = document.createElement('div');
      toolHost.className = 'gc-tool-host';
      if (window.GiuseCoderToolCall && typeof window.GiuseCoderToolCall.upsertToolCall === 'function') {
        message.toolOrder.forEach((toolId) => {
          const event = message.toolEvents[toolId];
          if (event) {
            window.GiuseCoderToolCall.upsertToolCall(toolHost, event);
          }
        });
      }
      row.appendChild(toolHost);

      if (message.diff && window.GiuseCoderDiff && typeof window.GiuseCoderDiff.createDiffBlock === 'function') {
        row.appendChild(window.GiuseCoderDiff.createDiffBlock(message.diff));
      }

      return row;
    }

    createActions(message) {
      const container = document.createElement('div');
      container.className = 'gc-message-actions';

      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'gc-message-action-btn';
      copyButton.title = 'Copy message';
      copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
      copyButton.addEventListener('click', () => {
        if (this.onCopyMessage) {
          this.onCopyMessage(message);
        }
      });
      container.appendChild(copyButton);

      if (message.role === 'assistant') {
        const regenerateButton = document.createElement('button');
        regenerateButton.type = 'button';
        regenerateButton.className = 'gc-message-action-btn';
        regenerateButton.title = 'Regenerate';
        regenerateButton.innerHTML = '<i class="codicon codicon-refresh"></i>';
        regenerateButton.addEventListener('click', () => {
          if (this.onRegenerate) {
            this.onRegenerate(message);
          }
        });
        container.appendChild(regenerateButton);
      }

      if (message.role === 'user') {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'gc-message-action-btn';
        editButton.title = 'Edit prompt';
        editButton.innerHTML = '<i class="codicon codicon-edit"></i>';
        editButton.addEventListener('click', () => {
          if (this.onEditMessage) {
            this.onEditMessage(message);
          }
        });
        container.appendChild(editButton);
      }

      return container;
    }
  }

  function createMessagesController(options) {
    return new MessagesController(options);
  }

  window.GiuseCoderMessages = {
    createMessagesController
  };
})();
