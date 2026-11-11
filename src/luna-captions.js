// Only the preference is persisted. Reply text stays in memory.
export function createLunaCaptions(button, { storage, document = globalThis.document, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const key = 'luna-captions-enabled';
  let enabled = true, text = '', lastReply = '', wasSpeaking = false, expiry;
  const stopExpiry = () => { if (expiry !== undefined) clearTimer(expiry); expiry = undefined; };
  try { storage ??= window.localStorage; enabled = storage?.getItem(key) !== 'false'; } catch { /* Session preference still works. */ }
  const caption = document.createElement('p');
  caption.className = 'luna-caption luna-caption-floating';
  caption.setAttribute('role', 'status');
  caption.setAttribute('aria-live', 'polite');
  caption.hidden = true;
  document.body.append(caption);
  let previousRender = '';
  function render() {
    const popupOpen = document.querySelector('.notebook-popup')?.open === true;
    const signature = JSON.stringify([enabled, text, popupOpen]);
    if (signature === previousRender) return;
    previousRender = signature;
    button.textContent = `Luna captions: ${enabled ? 'On' : 'Off'}`;
    button.setAttribute('aria-pressed', String(enabled));
    const inner = document.querySelector('.notebook-popup-caption');
    const line = enabled && text ? `Luna: ${text}` : '';
    caption.textContent = line;
    caption.hidden = !line || popupOpen;
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
    const next = snapshot.status === 'ready' && typeof snapshot.replyCaption === 'string' ? snapshot.replyCaption : '';
    const speaking = snapshot.capturePhase === 'response';
    if (next !== lastReply || (speaking && !wasSpeaking)) {
      stopExpiry(); text = next;
    }
    if (speaking) stopExpiry();
    else if (text && expiry === undefined) expiry = setTimer(() => { text = ''; expiry = undefined; render(); }, 6000);
    lastReply = next; wasSpeaking = speaking;
    render();
  } };
}
