import { categories, createTask, toggleTask, removeTask } from './tasks.js';
import { refreshDraft } from './vault.js';
import { preserveSaveRoutes } from './draft-storage.js';

preserveSaveRoutes();

let tasks = [];
let saved = null; // the notebook's checklist list id ('' until it exists), once the vault answers
const form = document.querySelector('#task-form');
const title = document.querySelector('#task-title');
const category = document.querySelector('#task-category');
const error = document.querySelector('#form-error');
const list = document.querySelector('#task-list');
const welcome = document.querySelector('#welcome');
const checklist = document.querySelector('#checklist');

function showPage(moveFocus = true) {
  const hash = location.hash.split('?')[0];
  const page = ['#checklist', '#vault', '#luna', '#notebook'].includes(hash) && document.querySelector(hash) ? hash.slice(1) : 'welcome';
  welcome.hidden = page !== 'welcome';
  checklist.hidden = page !== 'checklist';
  document.querySelector('#vault').hidden = page !== 'vault';
  if (document.querySelector('#luna')) document.querySelector('#luna').hidden = page !== 'luna';
  if (document.querySelector('#notebook')) document.querySelector('#notebook').hidden = page !== 'notebook';
  document.title = page === 'welcome' ? 'Luna OS Home' : `${page === 'vault' ? 'Your family draft' : page === 'luna' ? 'Meet Luna' : page === 'notebook' ? "Luna's notebook" : 'Your checklist'} · Luna OS Home`;
  if (page === 'vault') refreshDraft();
  if (page === 'checklist' && saved !== null) connectChecklist(); // pick up what Luna or another page changed
  if (moveFocus) {
    document.querySelector(`#${page}-heading`).focus();
    window.scrollTo(0, 0);
  }
}

window.addEventListener('hashchange', () => showPage());
showPage(false);

document.querySelector('#home-actions-toggle').addEventListener('click', event => {
  const toggle = event.currentTarget;
  const expanded = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(expanded));
  document.querySelector('#home-actions').hidden = !expanded;
});

for (const name of categories) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name;
  category.append(option);
}

function render() {
  list.replaceChildren();
  document.querySelector('#empty-state').hidden = tasks.length > 0;
  document.querySelector('#task-count').textContent = `${tasks.filter(task => !task.completed).length} remaining`;
  for (const task of tasks) {
    const row = document.createElement('li');
    row.className = task.completed ? 'completed' : '';
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.addEventListener('change', async () => {
      if (saved !== null) {
        try { await change({ op: 'complete_item', list: saved, item: task.id, completed: checkbox.checked }); error.textContent = ''; }
        catch (failure) { error.textContent = failure.message; render(); }
      } else {
        tasks = toggleTask(tasks, task.id);
        render();
      }
      list.querySelector(`[data-task-id="${task.id}"]`)?.focus();
    });
    checkbox.dataset.taskId = task.id;
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'task-title';
    name.textContent = task.title;
    const tag = document.createElement('small');
    tag.textContent = task.category;
    text.append(name, tag);
    label.append(checkbox, text);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${task.title}`);
    remove.addEventListener('click', async () => {
      if (saved !== null) {
        try { await change({ op: 'remove_item', list: saved, item: task.id }); error.textContent = ''; }
        catch (failure) { error.textContent = failure.message; }
      } else {
        tasks = removeTask(tasks, task.id);
        render();
      }
      title.focus();
    });
    row.append(label, remove);
    list.append(row);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const task = createTask(title.value, category.value);
    if (saved !== null) {
      // Saved first; the list shown afterwards is what the vault returned.
      if (saved === '') await change({ op: 'create_list', ...CHECKLIST });
      await change({ op: 'add_items', list: saved, allowDuplicate: true, items: [{ text: task.title, category: task.category }] });
    } else tasks = [...tasks, task];
    error.textContent = '';
    form.reset();
    render();
    title.focus();
  } catch (failure) {
    error.textContent = failure.message;
  }
});

render();

// When Home is connected to the household vault, this checklist is one of the
// lists in Luna's notebook: the same record the notebook page and Luna change.
// Without a vault it stays a list for this visit only, as before.
const CHECKLIST = { name: 'My checklist', type: 'checklist' };
async function notebook(body) {
  const response = await fetch('/api/notebook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Home-Preview': '1' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('unavailable');
  return response.json();
}
function adopt(data) {
  if (!data.notebook) return;
  // By type; or the list of that name, so a "My checklist" made by voice is this checklist too.
  const found = data.notebook.lists.find(entry => entry.type === CHECKLIST.type)
    ?? data.notebook.lists.find(entry => entry.name.trim().toLowerCase() === CHECKLIST.name.toLowerCase());
  saved = found?.id ?? '';
  tasks = (found?.items ?? []).map(item => ({
    id: item.id, title: item.text, category: item.category ?? categories[0], completed: item.completed,
  }));
  document.querySelector('#checklist-saved-note').hidden = false;
  document.querySelector('#checklist-visit-note').hidden = true;
  render();
}
async function change(operation) {
  const data = await notebook({ action: 'op', operation });
  adopt(data);
  if (data.status !== 'applied') throw new Error(data.reply ?? 'Nothing was changed.');
}
async function connectChecklist() {
  if (typeof fetch !== 'function') return;
  // Anything typed before the vault answered is saved into it, not dropped.
  const typed = saved === null ? tasks.filter(task => !task.completed) : [];
  try {
    adopt(await notebook({ action: 'snapshot' }));
    if (saved !== null && typed.length) {
      if (saved === '') await change({ op: 'create_list', ...CHECKLIST });
      await change({ op: 'add_items', list: saved, allowDuplicate: true, items: typed.map(task => ({ text: task.title, category: task.category })) });
    }
  } catch { /* no vault: this visit only */ }
}
connectChecklist();
