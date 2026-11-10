import { createSearchUI } from './search-ui.js';

// Native modal dialog keeps keyboard focus inside the palette and makes the
// underlying GitHub page inert without replacing or hiding its content.
export function createCommandPalette({ onClose = () => {} } = {}) {
  let dialog, input, panel, status, searchUI, previousFocus, origin;
  let finishClosing = null;

  function close({ immediate = false } = {}) {
    if (!dialog) return;
    if (finishClosing) { if (immediate) finishClosing(); return; }
    searchUI?.destroy({ preserveResults: true });
    searchUI = null;
    const closingDialog = dialog;
    let fallback;
    const finish = () => {
      if (dialog !== closingDialog) return;
      clearTimeout(fallback);
      closingDialog.close();
      closingDialog.remove();
      dialog = null;
      finishClosing = null;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    finishClosing = finish;
    onClose();
    if (immediate || !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    closingDialog.inert = true;
    closingDialog.classList.add('gdt-palette-closing');
    closingDialog.addEventListener('animationend', event => {
      if (event.target === closingDialog && event.animationName === 'gdt-palette-out') finish();
    });
    // Also clean up when host styles or a background tab suppress animations.
    fallback = setTimeout(finish, 180);
  }

  function setMessage(message) {
    if (!dialog || finishClosing) return;
    panel.hidden = false;
    panel.textContent = '';
    const note = document.createElement('div');
    note.className = 'gdt-palette-message';
    note.textContent = message;
    panel.append(note);
    status.textContent = message;
  }

  return {
    open({ repository, theme = 'auto' }) {
      finishClosing?.();
      if (dialog) return;
      previousFocus = document.activeElement;
      origin = location.href;
      dialog = document.createElement('dialog');
      dialog.id = 'gdt-command-palette';
      dialog.dataset.gdtTheme = theme;
      dialog.setAttribute('aria-labelledby', 'gdt-palette-title');
      dialog.innerHTML = `<div class="gdt-palette-heading"><span id="gdt-palette-title">Search documentation</span><span data-gdt-palette-repo></span></div>
        <div class="gdt-palette-field"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input data-gdt-palette-input aria-label="Search documentation" placeholder="Search docs, headings, and pages…" autocomplete="off" spellcheck="false" autofocus><button type="button" data-gdt-palette-close aria-label="Close search">esc</button></div>
        <div id="gdt-palette-results"></div>
        <div class="gdt-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open</span><span data-gdt-palette-status role="status" aria-live="polite"></span></div>`;
      dialog.querySelector('[data-gdt-palette-repo]').textContent = repository;
      input = dialog.querySelector('input');
      panel = dialog.querySelector('#gdt-palette-results');
      status = dialog.querySelector('[data-gdt-palette-status]');
      dialog.querySelector('button').addEventListener('click', close);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
      });
      document.body.append(dialog);
      setMessage('Loading documentation…');
      dialog.showModal();
      input.focus();
    },
    setSource(source, theme = 'auto') {
      if (!dialog || finishClosing) return;
      dialog.dataset.gdtTheme = theme;
      searchUI?.destroy();
      searchUI = createSearchUI({ ...source, input, panel, showSuggestions: true,
        onDismiss: close,
        onNavigate(item) { close({ immediate: true }); source.onNavigate(item); },
        onResults(count) { status.textContent = `${count} result${count === 1 ? '' : 's'}`; },
      });
      searchUI.refresh();
    },
    setMessage,
    close,
    isOpen: () => !!dialog && !finishClosing,
    closeIfNavigated() { if (dialog && origin !== location.href) close({ immediate: true }); },
  };
}
