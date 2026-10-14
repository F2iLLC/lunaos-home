import { categories, createTask, toggleTask, removeTask } from './tasks.js';

let tasks = [];
const form = document.querySelector('#task-form');
const title = document.querySelector('#task-title');
const category = document.querySelector('#task-category');
const error = document.querySelector('#form-error');
const list = document.querySelector('#task-list');
const welcome = document.querySelector('#welcome');
const checklist = document.querySelector('#checklist');

function showPage(moveFocus = true) {
  const showChecklist = location.hash === '#checklist';
  welcome.hidden = showChecklist;
  checklist.hidden = !showChecklist;
  document.title = showChecklist ? 'Your checklist · Luna OS Home' : 'Luna OS Home';
  if (moveFocus) {
    document.querySelector(showChecklist ? '#checklist-heading' : '#welcome-heading').focus();
    window.scrollTo(0, 0);
  }
}

window.addEventListener('hashchange', () => showPage());
showPage(false);

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
    checkbox.addEventListener('change', () => {
      tasks = toggleTask(tasks, task.id);
      render();
      list.querySelector(`[data-task-id="${task.id}"]`).focus();
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
    remove.addEventListener('click', () => {
      tasks = removeTask(tasks, task.id);
      render();
      title.focus();
    });
    row.append(label, remove);
    list.append(row);
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  try {
    tasks = [...tasks, createTask(title.value, category.value)];
    error.textContent = '';
    form.reset();
    render();
    title.focus();
  } catch (failure) {
    error.textContent = failure.message;
  }
});

render();
