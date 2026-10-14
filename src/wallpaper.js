const preferenceKey = 'luna-home-wallpaper-v1';
const choices = new Set(['twilight', 'aurora']);

export function readWallpaper(storage) {
  try {
    const value = storage().getItem(preferenceKey);
    return { value: choices.has(value) ? value : 'twilight', available: true };
  } catch { return { value: 'twilight', available: false }; }
}

export function saveWallpaper(value, storage) {
  if (!choices.has(value)) throw new Error('Choose one of the available wallpapers.');
  try { storage().setItem(preferenceKey, value); return true; }
  catch { return false; }
}

export function setupWallpaper(document, storage = () => globalThis.localStorage) {
  const settings = document.querySelector('#wallpaper-settings');
  const status = document.querySelector('#wallpaper-status');
  const radios = [...settings.querySelectorAll('input[name="wallpaper"]')];
  const selected = readWallpaper(storage);
  const apply = value => {
    document.body.dataset.wallpaper = value;
    for (const radio of radios) radio.checked = radio.value === value;
  };
  apply(selected.value);
  status.textContent = selected.available ? 'Only your wallpaper choice is saved here.' : 'Changes will last for this visit only.';
  settings.addEventListener('change', event => {
    const input = event.target;
    if (!radios.includes(input) || !input.checked) return;
    const saved = saveWallpaper(input.value, storage);
    apply(input.value);
    status.textContent = saved ? 'Wallpaper saved in this app.' : 'Wallpaper changed for this visit. This app could not save your choice.';
  });
  settings.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      settings.open = false;
      settings.querySelector('summary').focus();
    }
  });
}
