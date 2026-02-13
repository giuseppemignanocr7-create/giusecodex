(function () {
  const actions = [
    {
      id: 'chat',
      command: '',
      icon: 'codicon-comment-discussion',
      title: 'Chat',
      description: 'Ask anything'
    },
    {
      id: 'cmdk',
      command: '/refactor',
      icon: 'codicon-edit',
      title: 'Cmd+K',
      description: 'Inline code edit'
    },
    {
      id: 'agent',
      command: '/agent',
      icon: 'codicon-rocket',
      title: 'Agent',
      description: 'Autonomous task mode'
    },
    {
      id: 'fix',
      command: '/fix',
      icon: 'codicon-tools',
      title: 'Fix',
      description: 'Resolve active errors'
    }
  ];

  function mountWelcome(root, options) {
    if (!root || root.querySelector('.gc-welcome')) {
      return;
    }

    const logoSrc = options && options.logoSrc ? options.logoSrc : '';
    const onAction = options && typeof options.onAction === 'function' ? options.onAction : () => {};

    const wrapper = document.createElement('section');
    wrapper.className = 'gc-welcome';

    const logo = document.createElement('img');
    logo.className = 'gc-welcome-logo';
    logo.alt = 'GiuseCoder';
    logo.src = logoSrc;
    wrapper.appendChild(logo);

    const title = document.createElement('h1');
    title.className = 'gc-welcome-title';
    title.textContent = 'GiuseCoder';
    wrapper.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'gc-welcome-subtitle';
    subtitle.textContent = 'Precision-first AI coding assistant for high-velocity engineering workflows.';
    wrapper.appendChild(subtitle);

    const actionGrid = document.createElement('div');
    actionGrid.className = 'gc-welcome-actions';

    actions.forEach((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gc-welcome-action';
      button.style.setProperty('--delay', `${index * 0.08}s`);
      button.dataset.command = entry.command;

      const iconWrap = document.createElement('span');
      iconWrap.className = 'gc-welcome-action-icon';
      iconWrap.innerHTML = `<i class="codicon ${entry.icon}"></i>`;

      const textWrap = document.createElement('span');

      const heading = document.createElement('span');
      heading.className = 'gc-welcome-action-text';
      heading.textContent = entry.title;

      const description = document.createElement('span');
      description.className = 'gc-welcome-action-desc';
      description.textContent = entry.description;

      textWrap.appendChild(heading);
      textWrap.appendChild(description);

      button.appendChild(iconWrap);
      button.appendChild(textWrap);

      button.addEventListener('click', () => {
        onAction(entry.command);
      });

      actionGrid.appendChild(button);
    });

    wrapper.appendChild(actionGrid);
    root.appendChild(wrapper);
  }

  function unmountWelcome(root) {
    if (!root) {
      return;
    }

    const existing = root.querySelector('.gc-welcome');
    if (existing) {
      existing.remove();
    }
  }

  window.GiuseCoderWelcome = {
    mountWelcome,
    unmountWelcome
  };
})();
