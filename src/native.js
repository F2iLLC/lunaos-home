import { createOfflineDraftClient } from '../lib/offline-drafts.js';
import { useOfflineDraftClient } from './draft-client.js';

useOfflineDraftClient(createOfflineDraftClient());
document.querySelector('.preview-note p').textContent = 'Use made-up details only. This app preview keeps its draft on this device until you close or reload it. It is not a secure vault.';
document.querySelector('#draft-empty p').textContent = 'Try our made-up family to explore the app. An assistant is not connected to this offline preview yet.';
document.querySelector('#native-notices').hidden = false;
if (typeof __ANDROID_VAULT_DEBUG__ !== 'undefined' && __ANDROID_VAULT_DEBUG__ && window.__TAURI__?.core) {
  const launch = document.createElement('button');
  launch.type = 'button';
  launch.className = 'primary-button';
  launch.textContent = 'Open fictional Android vault experiment (debug, API30+)';
  const result = document.createElement('p');
  result.setAttribute('role', 'status');
  launch.addEventListener('click', async () => {
    launch.disabled = true;
    try {
      await window.__TAURI__.core.invoke('open_fictional_vault');
      result.textContent = 'Native screen requested. Android verification and separate approval happen there.';
    } catch {
      result.textContent = 'Unavailable. Requires an Android debug build on API30+; the offline draft still works.';
    } finally { launch.disabled = false; }
  });
  document.querySelector('#home-actions').append(launch, result);
}
await import('./app.js');
