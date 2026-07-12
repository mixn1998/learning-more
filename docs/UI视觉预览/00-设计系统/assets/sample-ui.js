(function () {
  let activeTrigger = null;
  let toastTimer = null;

  function getToast() {
    let toast = document.getElementById('lm-global-toast');
    if (toast) return toast;
    toast = document.createElement('div');
    toast.id = 'lm-global-toast';
    toast.className = 'lm-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    return toast;
  }

  function showToast(message, tone = 'neutral', options = {}) {
    const toast = getToast();
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), options.duration ?? 2200);
  }

  async function runSimulation({ button, busyText = '处理中…', successText = '操作已完成', task, delay = 650 }) {
    if (!button || button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = busyText;
    try {
      const result = task ? await task() : await new Promise((resolve) => setTimeout(resolve, delay));
      showToast(successText, 'success');
      return result;
    } catch (error) {
      showToast(error?.message || '操作失败，请重试', 'danger');
      throw error;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = original;
    }
  }

  function openDialog(dialog, trigger = document.activeElement) {
    if (!dialog) return;
    activeTrigger = trigger instanceof HTMLElement ? trigger : null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.removeAttribute('hidden');
    requestAnimationFrame(() => dialog.querySelector('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus());
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.setAttribute('hidden', '');
    activeTrigger?.focus();
    activeTrigger = null;
  }

  function confirmAction({ title = '确认操作', message, confirmText = '确认', cancelText = '取消', tone = 'primary' }) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'lm-confirm';
      dialog.innerHTML = `<form method="dialog"><header><h2>${title}</h2><p>${message || ''}</p></header><footer><button class="lm-btn" value="cancel">${cancelText}</button><button class="lm-btn ${tone}" value="confirm">${confirmText}</button></footer></form>`;
      document.body.appendChild(dialog);
      const trigger = document.activeElement;
      dialog.addEventListener('close', () => {
        const accepted = dialog.returnValue === 'confirm';
        dialog.remove();
        trigger?.focus?.();
        resolve(accepted);
      }, { once: true });
      dialog.addEventListener('cancel', () => { dialog.returnValue = 'cancel'; });
      dialog.showModal();
      dialog.querySelector('[value="cancel"]')?.focus();
    });
  }

  window.SampleUI = Object.freeze({
    showToast,
    runSimulation,
    openDialog,
    closeDialog,
    confirm: confirmAction,
  });
})();
