(function () {
  const iconMap = {
    read_file: 'codicon-file-code',
    write_file: 'codicon-save',
    edit_file: 'codicon-edit',
    run_command: 'codicon-terminal',
    search_files: 'codicon-search',
    resolve_context: 'codicon-symbol-file',
    chat_completion: 'codicon-hubot'
  };

  const agentIconMap = {
    haiku: 'codicon-rabbit',
    opus: 'codicon-lightbulb',
    sonnet: 'codicon-paintcan',
    codex: 'codicon-code'
  };

  function normalizeToolName(name) {
    if (!name) {
      return 'tool';
    }
    return String(name).toLowerCase();
  }

  function createToolCallElement(event) {
    const root = document.createElement('div');
    root.className = 'gc-tool-call';
    root.dataset.toolId = event.id;
    root.dataset.tool = normalizeToolName(event.name);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'gc-tool-call-header';

    const icon = document.createElement('span');
    icon.className = 'gc-tool-call-icon';
    var resolvedIcon = iconMap[normalizeToolName(event.name)];
    if (!resolvedIcon) {
      var nameLower = normalizeToolName(event.name);
      var agents = ['haiku', 'opus', 'sonnet', 'codex'];
      for (var a = 0; a < agents.length; a++) {
        if (nameLower.indexOf(agents[a] + '_') === 0) {
          resolvedIcon = agentIconMap[agents[a]];
          break;
        }
      }
    }
    icon.innerHTML = `<i class="codicon ${resolvedIcon || 'codicon-zap'}"></i>`;

    const name = document.createElement('span');
    name.className = 'gc-tool-call-name';
    name.textContent = event.name;

    const args = document.createElement('span');
    args.className = 'gc-tool-call-arg';
    args.textContent = event.args || '';

    const status = document.createElement('span');
    status.className = 'gc-tool-call-status';

    const details = document.createElement('div');
    details.className = 'gc-tool-call-details';

    const output = document.createElement('pre');
    output.className = 'gc-tool-call-output';
    output.textContent = '';
    details.appendChild(output);

    header.addEventListener('click', () => {
      root.classList.toggle('expanded');
    });

    header.appendChild(icon);
    header.appendChild(name);
    header.appendChild(args);
    header.appendChild(status);

    root.appendChild(header);
    root.appendChild(details);

    return root;
  }

  function setStatus(statusNode, event) {
    statusNode.classList.remove('success', 'error');

    if (event.phase === 'start' || event.status === 'running') {
      statusNode.innerHTML = '<span class="gc-tool-spinner" aria-label="running"></span>';
      return;
    }

    if (event.status === 'success') {
      statusNode.classList.add('success');
      statusNode.innerHTML = '<i class="codicon codicon-check"></i>';
      return;
    }

    statusNode.classList.add('error');
    statusNode.innerHTML = '<i class="codicon codicon-error"></i>';
  }

  function upsertToolCall(container, event) {
    if (!container || !event || !event.id) {
      return;
    }

    let node = container.querySelector(`[data-tool-id="${event.id}"]`);
    if (!node) {
      node = createToolCallElement(event);
      container.appendChild(node);
    }

    node.dataset.tool = normalizeToolName(event.name);

    const nameNode = node.querySelector('.gc-tool-call-name');
    const argNode = node.querySelector('.gc-tool-call-arg');
    const statusNode = node.querySelector('.gc-tool-call-status');
    const outputNode = node.querySelector('.gc-tool-call-output');

    if (nameNode) {
      nameNode.textContent = event.name || 'tool';
    }
    if (argNode) {
      argNode.textContent = event.args || '';
    }
    if (statusNode) {
      setStatus(statusNode, event);
    }

    if (outputNode && typeof event.output === 'string') {
      outputNode.textContent = event.output;
    }

    if (event.phase === 'end') {
      node.classList.add('expanded');
    }
  }

  window.GiuseCoderToolCall = {
    upsertToolCall
  };
})();
