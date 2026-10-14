export const categories = ['General', 'Appointments', 'Forms', 'School paperwork'];

export function createTask(title, category = 'General') {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed || trimmed.length > 160) {
    throw new Error('Enter a task between 1 and 160 characters.');
  }
  if (!categories.includes(category)) throw new Error('Choose a supported category.');
  return { id: crypto.randomUUID(), title: trimmed, category, completed: false };
}

export function toggleTask(tasks, id) {
  return tasks.map(task => task.id === id ? { ...task, completed: !task.completed } : task);
}

export function removeTask(tasks, id) {
  return tasks.filter(task => task.id !== id);
}
