/** The device owns both installed voices and the saved choice. */
export function createLunaVoiceSettings(group, status, { invoke, document }) {
  let voices = [], selected = '', saving = false, available = false, optionsKey = '', preview = 0;
  let buttons = [];
  const render = () => {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.value === selected));
      button.disabled = saving || !available;
    }
  };
  const choose = async voice => {
    if (saving || !available) return;
    const attempt = ++preview;
    saving = true; render();
    status.textContent = 'Saving voice…';
    try {
      await invoke('set_luna_voice', { voice });
      selected = voice;
    } catch {
      status.textContent = 'Could not save the voice. Your previous choice is still selected. Try again.';
      saving = false; render(); return;
    }
    saving = false; render();
    const label = voices.find(option => option.id === voice).label;
    status.textContent = `${label} selected. Playing sample…`;
    try {
      await invoke('preview_luna_voice', { voice });
      if (attempt === preview) status.textContent = `${label} selected. Tap again to hear the sample.`;
    } catch {
      if (attempt === preview) status.textContent = `${label} is saved, but the preview could not play. Tap again to retry.`;
    }
  };
  return {
    update(snapshot) {
      if (saving) return;
      voices = (snapshot.voices || []).filter(voice => ['lori', 'original'].includes(voice.id));
      available = true;
      const key = JSON.stringify(voices);
      if (key !== optionsKey) {
        buttons = voices.map(voice => {
          const button = document.createElement('button');
          button.type = 'button'; button.value = voice.id; button.textContent = voice.label;
          button.addEventListener('click', () => choose(voice.id));
          return button;
        });
        group.replaceChildren(...buttons);
        optionsKey = key;
      }
      selected = snapshot.selectedVoice || '';
      if (!voices.length) status.textContent = 'No voice packs are installed in this build.';
      render();
    },
    unavailable() { available = false; render(); },
  };
}
