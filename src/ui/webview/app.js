(function () {
  const vscode = acquireVsCodeApi();

  const MODELS = [
    'claude-sonnet-4-20250514',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-1-20250805'
  ];

  const state = {
    model: MODELS[0],
    contextCollapsed: false
  };

  const elements = {
    shell: document.getElementById('gc-shell'),
    logoButton: document.getElementById('gc-logo-btn'),
    logoIcon: document.getElementById('gc-logo-icon'),
    modelBadge: document.getElementById('gc-model-badge'),
    modelMenu: document.getElementById('gc-model-menu'),
    clearChat: document.getElementById('gc-clear-chat'),
    toggleContext: document.getElementById('gc-toggle-context'),
    contextWrapper: document.getElementById('gc-context-wrapper'),
    contextBar: document.getElementById('gc-context-bar'),
    messages: document.getElementById('gc-messages'),
    quickActions: document.getElementById('gc-quick-actions'),
    inputContainer: document.getElementById('gc-input-container'),
    inputField: document.getElementById('gc-input-field'),
    inputTags: document.getElementById('gc-input-tags'),
    inputMenu: document.getElementById('gc-input-menu'),
    sendButton: document.getElementById('gc-send-btn'),
    toolAttach: document.getElementById('gc-tool-attach'),
    toolCommand: document.getElementById('gc-tool-command'),
    toolStop: document.getElementById('gc-tool-stop'),
    statTokens: document.getElementById('gc-stat-tokens'),
    statCost: document.getElementById('gc-stat-cost'),
    statModel: document.getElementById('gc-stat-model'),
    settingsPanel: document.getElementById('gc-settings'),
    inputArea: document.querySelector('.gc-input-area')
  };

  const messagesController = window.GiuseCoderMessages.createMessagesController({
    root: elements.messages,
    onApply: (payload) => {
      vscode.postMessage({
        type: 'code.apply',
        path: payload.path,
        code: payload.code,
        messageId: payload.messageId
      });
    },
    onDiff: (payload) => {
      vscode.postMessage({
        type: 'code.previewDiff',
        path: payload.path,
        code: payload.code,
        messageId: payload.messageId
      });
    },
    onOpenExternal: (url) => {
      vscode.postMessage({
        type: 'open.external',
        url
      });
    },
    onRegenerate: (message) => {
      const prompt = (message && message.sourcePrompt) || '';
      if (!prompt) {
        return;
      }
      inputController.setValue(prompt);
      inputController.sendCurrentInput();
    },
    onCopyMessage: async (message) => {
      await copyText(message && message.content ? message.content : '');
      pushNotice('Message copied to clipboard.');
    },
    onEditMessage: (message) => {
      const text = message && message.content ? message.content : '';
      inputController.focus(text);
    }
  });

  const inputController = window.GiuseCoderInput.createInputController({
    field: elements.inputField,
    tagsHost: elements.inputTags,
    menu: elements.inputMenu,
    sendButton: elements.sendButton,
    attachButton: elements.toolAttach,
    commandButton: elements.toolCommand,
    stopButton: elements.toolStop,
    container: elements.inputContainer,
    model: state.model,
    onSend: (payload) => {
      hideWelcome();
      setLogoState('processing');

      messagesController.addMessage({
        id: makeId('user'),
        role: 'user',
        content: payload.text,
        timestamp: Date.now(),
        sourcePrompt: payload.text
      });

      messagesController.scrollToBottom(true);

      vscode.postMessage({
        type: 'chat.send',
        text: payload.text,
        model: payload.model,
        tags: payload.tags
      });
    },
    onCancel: () => {
      vscode.postMessage({ type: 'chat.cancel' });
    },
    onClear: () => {
      vscode.postMessage({ type: 'chat.clear' });
    },
    onSearchMentions: (payload) => {
      vscode.postMessage({
        type: 'context.searchMentions',
        requestId: payload.requestId,
        query: payload.query
      });
    },
    onTagsChange: (tags) => {
      vscode.postMessage({
        type: 'context.setActiveTags',
        tags
      });
    }
  });

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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

  function formatMoney(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) {
      return '$0.0000';
    }
    return `$${numeric.toFixed(4)}`;
  }

  function animateStat(node, text) {
    if (!node) {
      return;
    }

    node.textContent = text;
    node.classList.add('updating');
    setTimeout(() => {
      node.classList.remove('updating');
    }, 300);
  }

  function updateUsage(usage) {
    if (!usage) {
      return;
    }

    const input = Number(usage.inputTokens || 0);
    const output = Number(usage.outputTokens || 0);
    const total = input + output;

    animateStat(elements.statTokens, total.toLocaleString());
    animateStat(elements.statCost, formatMoney(usage.costUsd));
  }

  function setModel(model, notifyHost) {
    const nextModel = model || MODELS[0];
    state.model = nextModel;
    inputController.setModel(nextModel);

    elements.modelBadge.textContent = shortModel(nextModel);
    elements.statModel.textContent = shortModel(nextModel);

    highlightActiveModel();

    if (notifyHost) {
      vscode.postMessage({
        type: 'chat.setModel',
        model: nextModel
      });
    }
  }

  function shortModel(model) {
    return String(model)
      .replace('claude-', '')
      .replace(/-\d{8}$/g, '')
      .replaceAll('-', ' ')
      .toUpperCase();
  }

  function renderModelMenu() {
    elements.modelMenu.innerHTML = '';

    MODELS.forEach((model) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gc-model-option';
      button.dataset.model = model;
      button.textContent = shortModel(model);

      button.addEventListener('click', () => {
        setModel(model, true);
        closeModelMenu();
      });

      elements.modelMenu.appendChild(button);
    });

    highlightActiveModel();
  }

  function highlightActiveModel() {
    const nodes = Array.from(elements.modelMenu.querySelectorAll('.gc-model-option'));
    nodes.forEach((node) => {
      const active = node.dataset.model === state.model;
      node.classList.toggle('active', active);
    });
  }

  function toggleModelMenu() {
    const hidden = elements.modelMenu.hasAttribute('hidden');
    if (hidden) {
      elements.modelMenu.removeAttribute('hidden');
    } else {
      closeModelMenu();
    }
  }

  function closeModelMenu() {
    elements.modelMenu.setAttribute('hidden', 'true');
  }

  function renderContextSummary(summary) {
    elements.contextBar.innerHTML = '';

    const chips = (summary && Array.isArray(summary.chips) ? summary.chips : []).slice(0, 16);
    chips.forEach((chip) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gc-context-chip active';
      button.dataset.tagId = chip.id;
      button.textContent = chip.label;

      button.addEventListener('click', () => {
        inputController.removeTagById(chip.id);
      });

      elements.contextBar.appendChild(button);
    });

    const errors = Number(summary && summary.errorCount ? summary.errorCount : 0);
    const warnings = Number(summary && summary.warningCount ? summary.warningCount : 0);

    if (errors > 0) {
      const errorChip = document.createElement('span');
      errorChip.className = 'gc-context-chip error';
      errorChip.textContent = `${errors} errors`;
      elements.contextBar.appendChild(errorChip);
    }

    if (warnings > 0) {
      const warningChip = document.createElement('span');
      warningChip.className = 'gc-context-chip warning';
      warningChip.textContent = `${warnings} warnings`;
      elements.contextBar.appendChild(warningChip);
    }

    if (!chips.length && errors === 0 && warnings === 0) {
      const empty = document.createElement('span');
      empty.className = 'gc-context-chip';
      empty.textContent = 'No pinned context';
      elements.contextBar.appendChild(empty);
    }
  }

  function pushNotice(text) {
    messagesController.addMessage({
      id: makeId('notice'),
      role: 'notice',
      content: text,
      timestamp: Date.now()
    });

    messagesController.scrollToBottom(true);
    hideWelcome();
  }

  function setLogoState(stateName) {
    elements.logoIcon.classList.remove('processing', 'success', 'error');
    if (stateName) {
      elements.logoIcon.classList.add(stateName);
    }
  }

  function pushError(text) {
    messagesController.addMessage({
      id: makeId('error'),
      role: 'error',
      content: text,
      timestamp: Date.now()
    });

    messagesController.scrollToBottom(true);
    hideWelcome();
  }

  function showWelcome() {
    if (!window.GiuseCoderWelcome || typeof window.GiuseCoderWelcome.mountWelcome !== 'function') {
      return;
    }

    window.GiuseCoderWelcome.mountWelcome(elements.messages, {
      logoSrc: document.querySelector('.gc-logo-icon img') ? document.querySelector('.gc-logo-icon img').src : '',
      onAction: (command) => {
        if (!command) {
          inputController.focus('');
          return;
        }

        inputController.focus(`${command} `);
      }
    });
  }

  function hideWelcome() {
    if (window.GiuseCoderWelcome && typeof window.GiuseCoderWelcome.unmountWelcome === 'function') {
      window.GiuseCoderWelcome.unmountWelcome(elements.messages);
    }
  }

  function syncWelcome() {
    const hasMessages = messagesController.getMessages().length > 0;
    if (hasMessages) {
      hideWelcome();
      return;
    }

    showWelcome();
  }

  function buildCostReportMarkdown(usage) {
    if (!usage) {
      return 'No usage data available.';
    }

    const input = Number(usage.inputTokens || 0);
    const output = Number(usage.outputTokens || 0);
    const total = input + output;
    const requests = Number(usage.requests || 0);

    return [
      '## Session Cost Report',
      '',
      `- Requests: **${requests.toLocaleString()}**`,
      `- Input tokens: **${input.toLocaleString()}**`,
      `- Output tokens: **${output.toLocaleString()}**`,
      `- Total tokens: **${total.toLocaleString()}**`,
      `- Estimated cost: **${formatMoney(usage.costUsd)}**`
    ].join('\n');
  }

  function updatePipelineProgress(messageId, progress) {
    var messageNode = elements.messages.querySelector('[data-message-id="' + messageId + '"]');
    if (!messageNode) {
      return;
    }

    var pipelineHost = messageNode.querySelector('.gc-pipeline');
    if (!pipelineHost) {
      pipelineHost = document.createElement('div');
      pipelineHost.className = 'gc-pipeline';
      var toolHost = messageNode.querySelector('.gc-tool-host');
      if (toolHost) {
        messageNode.insertBefore(pipelineHost, toolHost);
      } else {
        messageNode.appendChild(pipelineHost);
      }
    }

    var steps = progress.steps || [];
    var doneCount = steps.filter(function (s) { return s.status === 'done'; }).length;
    var totalCount = steps.length;
    var pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    var taskType = (progress.taskType || 'unknown').replace(/_/g, ' ');
    var cost = '$' + (progress.totalCostUsd || 0).toFixed(4);
    var elapsed = ((progress.elapsedMs || 0) / 1000).toFixed(1) + 's';

    var html = '<div class="gc-pipeline-header">'
      + '<div class="gc-pipeline-header-left">'
      + '<span class="gc-pipeline-task-badge">' + taskType + '</span>'
      + '<span>' + elapsed + '</span>'
      + '</div>'
      + '<span class="gc-pipeline-cost">' + cost + '</span>'
      + '</div>'
      + '<div class="gc-pipeline-bar"><div class="gc-pipeline-bar-fill" style="width:' + pct + '%"></div></div>'
      + '<div class="gc-pipeline-steps">';

    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      var status = step.status || 'waiting';
      var agent = step.agent || '';
      var label = step.label || step.stepId || '';
      var icon = '';

      if (status === 'done') {
        icon = '<i class="codicon codicon-check"></i>';
      } else if (status === 'running') {
        icon = '<span class="gc-tool-spinner" aria-label="running"></span>';
      } else if (status === 'failed') {
        icon = '<i class="codicon codicon-error"></i>';
      } else {
        icon = '<i class="codicon codicon-circle-outline"></i>';
      }

      var meta = '';
      if (step.costUsd && step.costUsd > 0) {
        meta = '$' + step.costUsd.toFixed(4);
      }
      if (step.durationMs && step.durationMs > 0) {
        meta += (meta ? ' · ' : '') + (step.durationMs / 1000).toFixed(1) + 's';
      }

      html += '<div class="gc-pipeline-step ' + status + '">'
        + '<span class="gc-pipeline-step-icon">' + icon + '</span>'
        + '<span class="gc-pipeline-step-label">' + label + '</span>'
        + '<span class="gc-pipeline-step-agent" data-agent="' + agent + '">' + agent + '</span>'
        + (meta ? '<span class="gc-pipeline-step-meta">' + meta + '</span>' : '')
        + '</div>';
    }

    html += '</div>';
    pipelineHost.innerHTML = html;

    if (messagesController.isNearBottom()) {
      messagesController.scrollToBottom(false);
    }
  }

  var settingsController = window.GiuseCoderSettings
    ? window.GiuseCoderSettings.createSettingsController({
        vscode: vscode,
        settingsPanel: elements.settingsPanel,
        messagesPanel: elements.messages,
        quickActions: elements.quickActions,
        inputArea: elements.inputArea,
        contextWrapper: elements.contextWrapper
      })
    : null;

  function handleHostMessage(payload) {
    if (settingsController && settingsController.handleMessage(payload)) {
      return;
    }

    const type = payload && payload.type ? payload.type : '';

    switch (type) {
      case 'chat.bootstrap':
        if (payload.model) {
          setModel(payload.model, false);
        }
        if (payload.usage) {
          updateUsage(payload.usage);
        }
        syncWelcome();
        return;

      case 'chat.model':
        setModel(payload.model, false);
        return;

      case 'chat.startAssistant': {
        const message = payload.message || {};

        setLogoState('processing');

        messagesController.addMessage({
          id: message.id || makeId('assistant'),
          role: 'assistant',
          content: '',
          streamText: '',
          streaming: true,
          model: message.model || state.model,
          timestamp: message.timestamp || Date.now(),
          sourcePrompt: message.sourcePrompt || ''
        });

        messagesController.scrollToBottom(true);
        hideWelcome();
        return;
      }

      case 'chat.streamToken':
        if (payload.messageId) {
          messagesController.appendStreamToken(payload.messageId, payload.token || '');
        }
        return;

      case 'chat.complete':
        if (payload.messageId) {
          messagesController.finalizeAssistant(payload.messageId, payload);
        }

        if (payload.usage) {
          updateUsage(payload.usage);
        }

        if (payload.failed) {
          setLogoState('error');
          setTimeout(() => {
            setLogoState('');
          }, 1200);
        } else if (payload.cancelled) {
          setLogoState('');
        } else {
          setLogoState('success');
          setTimeout(() => {
            setLogoState('');
          }, 900);
        }
        messagesController.scrollToBottom(true);
        return;

      case 'tool.event':
        if (payload.messageId && payload.event) {
          messagesController.upsertToolEvent(payload.messageId, payload.event);
        }
        return;

      case 'code.diffPreview':
        if (payload.messageId && payload.diff) {
          messagesController.setDiff(payload.messageId, payload.diff);
          messagesController.scrollToBottom(true);
        }
        return;

      case 'context.mentionResults':
        inputController.setMentionResults(payload.requestId || '', payload.items || []);
        return;

      case 'context.summary':
        renderContextSummary(payload.summary || {});
        return;

      case 'chat.notice':
        pushNotice(payload.message || 'Done.');
        return;

      case 'chat.error':
        setLogoState('error');
        setTimeout(() => {
          setLogoState('');
        }, 1200);
        pushError(payload.message || 'Unexpected error.');
        return;

      case 'chat.cleared':
        setLogoState('');
        messagesController.clear();
        inputController.clear();
        syncWelcome();
        return;

      case 'chat.focusInput':
        inputController.focus(payload.prefill || '');
        return;

      case 'chat.costReport':
        pushNotice(buildCostReportMarkdown(payload.usage || {}));
        return;

      case 'pipeline.progress':
        if (payload.messageId && payload.progress) {
          updatePipelineProgress(payload.messageId, payload.progress);
        }
        return;

      case 'pipeline.stepStart':
      case 'pipeline.stepComplete':
      case 'pipeline.stepFailed':
        return;

      default:
        return;
    }
  }

  function bindTopLevelEvents() {
    elements.modelBadge.addEventListener('click', () => {
      toggleModelMenu();
    });

    elements.clearChat.addEventListener('click', () => {
      vscode.postMessage({ type: 'chat.clear' });
    });

    elements.toggleContext.addEventListener('click', () => {
      state.contextCollapsed = !state.contextCollapsed;
      elements.contextWrapper.classList.toggle('collapsed', state.contextCollapsed);
      elements.toggleContext.innerHTML = state.contextCollapsed
        ? '<i class="codicon codicon-unfold"></i>'
        : '<i class="codicon codicon-fold"></i>';
    });

    elements.logoButton.addEventListener('click', () => {
      inputController.focus('');
    });

    elements.quickActions.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest('.gc-quick-action');
      if (!button) {
        return;
      }

      const action = button.dataset.action || '';
      inputController.focus(`${action} `);
    });

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!elements.modelMenu.contains(target) && !elements.modelBadge.contains(target)) {
        closeModelMenu();
      }
    });
  }

  function bootstrap() {
    renderModelMenu();
    bindTopLevelEvents();
    setModel(state.model, false);
    syncWelcome();

    window.addEventListener('message', (event) => {
      handleHostMessage(event.data || {});
    });

    vscode.postMessage({ type: 'ready' });
  }

  bootstrap();
})();
