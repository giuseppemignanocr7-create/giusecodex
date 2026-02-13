(function () {
  function createSettingsController(options) {
    var vscode = options.vscode;
    var settingsPanel = options.settingsPanel;
    var messagesPanel = options.messagesPanel;
    var quickActions = options.quickActions;
    var inputArea = options.inputArea;
    var contextWrapper = options.contextWrapper;

    var els = {
      keyAnthropic: document.getElementById('gc-key-anthropic'),
      keyOpenai: document.getElementById('gc-key-openai'),
      saveAnthropic: document.getElementById('gc-save-anthropic'),
      saveOpenai: document.getElementById('gc-save-openai'),
      statusAnthropic: document.getElementById('gc-status-anthropic'),
      statusOpenai: document.getElementById('gc-status-openai'),
      orchEnabled: document.getElementById('gc-orch-enabled'),
      orchReview: document.getElementById('gc-orch-review'),
      orchFix: document.getElementById('gc-orch-fix'),
      orchParallel: document.getElementById('gc-orch-parallel'),
      modelHaiku: document.getElementById('gc-model-haiku'),
      modelSonnet: document.getElementById('gc-model-sonnet'),
      modelOpus: document.getElementById('gc-model-opus'),
      modelCodex: document.getElementById('gc-model-codex'),
      saveModels: document.getElementById('gc-save-models'),
      openBtn: document.getElementById('gc-open-settings'),
      closeBtn: document.getElementById('gc-close-settings')
    };

    var visible = false;

    function show() {
      visible = true;
      settingsPanel.removeAttribute('hidden');
      messagesPanel.style.display = 'none';
      quickActions.style.display = 'none';
      inputArea.style.display = 'none';
      if (contextWrapper) {
        contextWrapper.style.display = 'none';
      }
      vscode.postMessage({ type: 'settings.getStatus' });
    }

    function hide() {
      visible = false;
      settingsPanel.setAttribute('hidden', 'true');
      messagesPanel.style.display = '';
      quickActions.style.display = '';
      inputArea.style.display = '';
      if (contextWrapper) {
        contextWrapper.style.display = '';
      }
    }

    function toggle() {
      if (visible) {
        hide();
      } else {
        show();
      }
    }

    function setStatus(el, text, type) {
      if (!el) {
        return;
      }
      el.textContent = text;
      el.className = 'gc-settings-status';
      if (type) {
        el.classList.add(type);
      }
    }

    function flashSaved(el) {
      setStatus(el, 'Saved!', 'success');
      setTimeout(function () {
        setStatus(el, '', '');
      }, 2000);
    }

    function flashError(el, msg) {
      setStatus(el, msg || 'Error', 'error');
      setTimeout(function () {
        setStatus(el, '', '');
      }, 3000);
    }

    // Save Anthropic key
    els.saveAnthropic.addEventListener('click', function () {
      var key = els.keyAnthropic.value.trim();
      if (!key) {
        flashError(els.statusAnthropic, 'Key is empty');
        return;
      }
      vscode.postMessage({ type: 'settings.setAnthropicKey', key: key });
    });

    // Save OpenAI key
    els.saveOpenai.addEventListener('click', function () {
      var key = els.keyOpenai.value.trim();
      if (!key) {
        flashError(els.statusOpenai, 'Key is empty');
        return;
      }
      vscode.postMessage({ type: 'settings.setOpenaiKey', key: key });
    });

    // Orchestrator toggles — save on change
    els.orchEnabled.addEventListener('change', function () {
      vscode.postMessage({ type: 'settings.setConfig', key: 'giuseCoder.orchestrator.enabled', value: els.orchEnabled.checked });
    });
    els.orchReview.addEventListener('change', function () {
      vscode.postMessage({ type: 'settings.setConfig', key: 'giuseCoder.orchestrator.autoReview', value: els.orchReview.checked });
    });
    els.orchFix.addEventListener('change', function () {
      vscode.postMessage({ type: 'settings.setConfig', key: 'giuseCoder.orchestrator.autoFix', value: els.orchFix.checked });
    });
    els.orchParallel.addEventListener('change', function () {
      vscode.postMessage({ type: 'settings.setConfig', key: 'giuseCoder.orchestrator.parallelExecution', value: els.orchParallel.checked });
    });

    // Save models
    els.saveModels.addEventListener('click', function () {
      vscode.postMessage({
        type: 'settings.setModels',
        models: {
          haiku: els.modelHaiku.value.trim(),
          sonnet: els.modelSonnet.value.trim(),
          opus: els.modelOpus.value.trim(),
          codex: els.modelCodex.value.trim()
        }
      });
    });

    // Open / close
    els.openBtn.addEventListener('click', toggle);
    els.closeBtn.addEventListener('click', hide);

    function handleMessage(payload) {
      var type = payload && payload.type ? payload.type : '';

      if (type === 'settings.status') {
        // API key status
        if (payload.anthropicKeySet) {
          setStatus(els.statusAnthropic, 'Key configured', 'success');
          els.keyAnthropic.placeholder = '••••••••••••••••';
        } else {
          setStatus(els.statusAnthropic, 'Not configured', 'warning');
          els.keyAnthropic.placeholder = 'sk-ant-...';
        }

        if (payload.openaiKeySet) {
          setStatus(els.statusOpenai, 'Key configured', 'success');
          els.keyOpenai.placeholder = '••••••••••••••••';
        } else {
          setStatus(els.statusOpenai, 'Not configured', 'warning');
          els.keyOpenai.placeholder = 'sk-proj-...';
        }

        // Orchestrator config
        els.orchEnabled.checked = Boolean(payload.orchestrator && payload.orchestrator.enabled);
        els.orchReview.checked = Boolean(payload.orchestrator && payload.orchestrator.autoReview);
        els.orchFix.checked = Boolean(payload.orchestrator && payload.orchestrator.autoFix);
        els.orchParallel.checked = Boolean(payload.orchestrator && payload.orchestrator.parallelExecution);

        // Models
        if (payload.models) {
          els.modelHaiku.value = payload.models.haiku || '';
          els.modelSonnet.value = payload.models.sonnet || '';
          els.modelOpus.value = payload.models.opus || '';
          els.modelCodex.value = payload.models.codex || '';
        }

        return true;
      }

      if (type === 'settings.keySaved') {
        if (payload.provider === 'anthropic') {
          flashSaved(els.statusAnthropic);
          els.keyAnthropic.value = '';
          els.keyAnthropic.placeholder = '••••••••••••••••';
        } else if (payload.provider === 'openai') {
          flashSaved(els.statusOpenai);
          els.keyOpenai.value = '';
          els.keyOpenai.placeholder = '••••••••••••••••';
        }
        return true;
      }

      if (type === 'settings.keyError') {
        if (payload.provider === 'anthropic') {
          flashError(els.statusAnthropic, payload.message || 'Save failed');
        } else if (payload.provider === 'openai') {
          flashError(els.statusOpenai, payload.message || 'Save failed');
        }
        return true;
      }

      if (type === 'settings.modelsSaved') {
        var btn = els.saveModels;
        var original = btn.innerHTML;
        btn.innerHTML = '<i class="codicon codicon-check"></i> Saved!';
        btn.classList.add('saved');
        setTimeout(function () {
          btn.innerHTML = original;
          btn.classList.remove('saved');
        }, 2000);
        return true;
      }

      return false;
    }

    return {
      show: show,
      hide: hide,
      toggle: toggle,
      isVisible: function () { return visible; },
      handleMessage: handleMessage
    };
  }

  window.GiuseCoderSettings = {
    createSettingsController: createSettingsController
  };
})();
