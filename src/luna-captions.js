// Only the preference is persisted. Reply text stays in memory.
export function createLunaCaptions(button, { storage, document = globalThis.document } = {}) {
  const key = 'luna-captions-enabled';
  let enabled = true, text = '';
  try { storage ??= window.localStorage; enabled = storage?.getItem(key) !== 'false'; } catch { /* Session preference still works. */ }
  const caption = document.createElement('p');
  caption.className = 'luna-caption luna-caption-floating';
  caption.setAttribute('role', 'status');
  caption.setAttribute('aria-live', 'polite');
  caption.hidden = true;
  document.body.append(caption);
  function render() {
    button.textContent = `Luna captions: ${enabled ? 'On' : 'Off'}`;
    button.setAttribute('aria-pressed', String(enabled));
    const popup = document.querySelector('.notebook-popup');
    const inner = document.querySelector('.notebook-popup-caption');
    const line = enabled && text ? `Luna: ${text}` : '';
    caption.textContent = line;
    caption.hidden = !line || popup?.open === true;
    if (inner) { inner.textContent = line; inner.hidden = !line; }
  }
  button.addEventListener('click', () => {
    enabled = !enabled;
    try { storage?.setItem(key, String(enabled)); } catch { /* Keep the session choice. */ }
    render();
  });
  document.querySelector('.notebook-popup')?.addEventListener('close', render);
  render();
  return { update(snapshot) {
    text = snapshot.status === 'ready' && typeof snapshot.replyCaption === 'string' ? snapshot.replyCaption : '';
    render();
  } };
}
