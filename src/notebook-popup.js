import { notebookRequest } from './notebook-client.js';

// Voice supplies only the saved list ID. Contents always come from the vault.
export function createNotebookPopup({ request = notebookRequest } = {}) {
  const page = document.createElement('dialog');
  page.className = 'notebook-popup';
  page.setAttribute('aria-labelledby', 'notebook-popup-title');
  page.innerHTML = `<button type="button" class="notebook-popup-close" aria-label="Close notebook">×</button>
    <p class="notebook-popup-label">LUNA’S NOTEBOOK</p><h2 id="notebook-popup-title"></h2>
    <p class="notebook-popup-status" role="status"></p><ul class="notebook-popup-items"></ul><p class="notebook-popup-caption luna-caption" role="status" hidden></p>`;
  document.body.append(page);
  const title = page.querySelector('h2'), status = page.querySelector('[role="status"]'), items = page.querySelector('ul');
  let event, generation = 0;
  const close = () => { generation++; page.close(); };
  page.querySelector('button').addEventListener('click', close);
  page.addEventListener('cancel', () => { generation++; });
  return { async update(snapshot) {
    if (snapshot.status !== 'ready' || snapshot.capturePhase === 'off' ||
      (snapshot.activeTimers || []).some(timer => timer.remainingSeconds === 0)) {
      event = snapshot.notebookEvent; close(); return;
    }
    if (event === snapshot.notebookEvent) return;
    event = snapshot.notebookEvent;
    close();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(snapshot.notebookListId || '')) return;
    const current = generation;
    title.textContent = 'Your notebook'; status.textContent = 'Opening your list…'; items.replaceChildren();
    page.showModal();
    try {
      const result = await request({ action: 'snapshot' });
      if (current !== generation || !page.open) return;
      if (result.status !== 'read') throw Error();
      const list = result.notebook.lists.find(list => list.id === snapshot.notebookListId);
      if (!list) { status.textContent = 'This list is no longer available.'; return; }
      title.textContent = list.name;
      status.textContent = list.items.length ? '' : 'A fresh page. What shall we add?';
      for (const item of list.items) {
        const row = document.createElement('li');
        row.className = item.completed ? 'is-complete' : '';
        const mark = document.createElement('span'); mark.className = 'notebook-popup-check';
        mark.textContent = item.completed ? '✓' : '□'; mark.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = [item.quantity, item.unit, item.text].filter(value => value !== undefined && value !== '').join(' ');
        if (item.completed) text.setAttribute('aria-label', `${text.textContent}, completed`);
        row.append(mark, text);
        if (item.notes) { const note = document.createElement('small'); note.textContent = item.notes; row.append(note); }
        items.append(row);
      }
    } catch {
      if (current === generation && page.open) status.textContent = 'I couldn’t load this list. Please open the notebook to check it.';
    }
  } };
}
