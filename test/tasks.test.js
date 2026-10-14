import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, toggleTask, removeTask } from '../src/tasks.js';

test('creates distinct tasks with trimmed titles and supported categories', () => {
  const first = createTask('  Review a fictional form  ', 'Forms');
  assert.equal(first.title, 'Review a fictional form');
  assert.equal(first.category, 'Forms');
  assert.equal(first.completed, false);
  assert.notEqual(first.id, createTask(first.title).id);
});

test('rejects empty, invalid, and oversized task input', () => {
  for (const title of ['', '   ', undefined, 123, 'x'.repeat(161)]) {
    assert.throws(() => createTask(title), /between 1 and 160/);
  }
  assert.equal(createTask('x'.repeat(160)).title.length, 160);
  assert.throws(() => createTask('Fictional task', 'Unknown'), /supported category/);
});

test('completion can be toggled without changing other tasks or the original state', () => {
  const tasks = [createTask('Sample task one'), createTask('Sample task two')];
  const updated = toggleTask(tasks, tasks[0].id);
  assert.equal(updated[0].completed, true);
  assert.equal(tasks[0].completed, false);
  assert.equal(updated[1], tasks[1]);
  assert.equal(toggleTask(updated, tasks[0].id)[0].completed, false);
  assert.deepEqual(toggleTask(tasks, 'missing'), tasks);
});

test('removes only the requested task', () => {
  const tasks = [createTask('Sample task one'), createTask('Sample task two')];
  assert.deepEqual(removeTask(tasks, tasks[0].id), [tasks[1]]);
  assert.equal(tasks.length, 2);
  assert.deepEqual(removeTask(tasks, 'missing'), tasks);
});
