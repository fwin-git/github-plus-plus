// Keep native totals readable while either count enhancement is loading.
export function syncCountSpinners(targets, attribute, label) {
  const selector = `[${attribute}]`;
  const hosts = targets.map(target => target.querySelector('[data-component="CounterLabel"]') || target);
  for (const spinner of document.querySelectorAll(selector)) {
    if (!hosts.includes(spinner.parentElement)) {
      spinner.parentElement?.classList.remove('gdt-count-pending');
      spinner.remove();
    }
  }
  for (const status of document.querySelectorAll(`[data-gdt-loading-status="${attribute}"]`)) {
    if (!targets.includes(status.parentElement)) status.remove();
  }
  for (const [index, target] of targets.entries()) {
    const host = hosts[index];
    host.classList.add('gdt-count-pending');
    if (host.querySelector(selector)) continue;
    const spinner = document.createElement('span');
    spinner.setAttribute(attribute, '');
    spinner.className = 'gdt-count-loading';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', label);
    spinner.title = label;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M8 2a6 6 0 1 1-6 6');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    svg.append(path);
    spinner.append(svg);
    host.prepend(spinner);
    // Modern counters hide their visual label from assistive technology and
    // provide a separate count. Put the loading announcement outside it.
    if (host.closest('[aria-hidden="true"]') && !target.querySelector(`[data-gdt-loading-status="${attribute}"]`)) {
      const status = document.createElement('span');
      status.className = 'gdt-count-loading-status';
      status.setAttribute('data-gdt-loading-status', attribute);
      status.setAttribute('role', 'status');
      status.textContent = label;
      target.append(status);
    }
  }
}
