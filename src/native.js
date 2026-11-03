import { createOfflineDraftClient } from '../lib/offline-drafts.js';
import { useOfflineDraftClient } from './draft-client.js';

useOfflineDraftClient(createOfflineDraftClient());
document.querySelector('.preview-note p').textContent = 'Use made-up details only. This app preview keeps its draft on this device until you close or reload it. It is not a secure vault.';
document.querySelector('#draft-empty p').textContent = 'Try our made-up family to explore the app. An assistant is not connected to this offline preview yet.';
document.querySelector('#native-notices').hidden = false;
if (typeof __ANDROID_VAULT_DEBUG__ !== 'undefined' && __ANDROID_VAULT_DEBUG__ && window.__TAURI__?.core) {
  const lunaLink = document.createElement('a');
  lunaLink.href = '#luna';
  lunaLink.innerHTML = 'Meet Luna <small>Open the installed voice demo</small>';
  document.querySelector('#home-actions').append(lunaLink);
  const luna = document.createElement('section');
  luna.id = 'luna';
  luna.className = 'vault';
  luna.hidden = true;
  luna.innerHTML = `<a class="back-link" href="#welcome">← Back home</a>
    <div class="checklist-intro"><p class="eyebrow">LUNA VOICE DEMO</p>
    <h1 id="luna-heading" tabindex="-1">Meet Luna.</h1>
    <p>Luna's face, microphone controls and active timers are in the separately installed voice demo.</p></div>
    <div class="list-panel"><h2>Home voice status</h2>
    <p id="luna-state" role="status" aria-live="polite">Checking Home voice status…</p>
    <p id="luna-details">Home cannot read the separate demo's microphone or timers.</p>
    <button id="refresh-luna-state" type="button">Refresh status</button>
    <p>Opening the demo does not turn on its microphone. Tap Enable there to start listening. Online answers currently require the computer relay and USB.</p>
    <button id="open-luna-demo" class="primary-button" type="button">Open Luna voice demo</button>
    <p id="luna-demo-status" role="status" aria-live="polite"></p></div>`;
  document.querySelector('main').append(luna);
  const stateText = luna.querySelector('#luna-state');
  const stateDetails = luna.querySelector('#luna-details');
  const refreshState = luna.querySelector('#refresh-luna-state');
  const refreshSnapshot = async () => {
    refreshState.disabled = true;
    stateText.textContent = 'Checking Home voice status…';
    try {
      const snapshot = await window.__TAURI__.core.invoke('get_luna_snapshot');
      if (snapshot.status === 'unavailable' && snapshot.reason === 'voice_not_integrated') {
        stateText.textContent = 'Voice controls are not connected in Home yet.';
        stateDetails.textContent = 'Microphone, online-answer and timer status are unavailable here. The separate demo has its own controls and state.';
      } else {
        stateText.textContent = 'Voice status unavailable.';
        stateDetails.textContent = 'Home could not confirm microphone or timer state.';
      }
    } catch {
      stateText.textContent = 'Voice status unavailable.';
      stateDetails.textContent = 'Home could not confirm microphone or timer state.';
    } finally { refreshState.disabled = false; }
  };
  refreshState.addEventListener('click', refreshSnapshot);
  void refreshSnapshot();
  luna.querySelector('#open-luna-demo').addEventListener('click', async event => {
    const button = event.currentTarget;
    const status = luna.querySelector('#luna-demo-status');
    button.disabled = true;
    try {
      await window.__TAURI__.core.invoke('open_luna_probe');
      status.textContent = 'Voice demo opened. Listening remains under its local controls.';
    } catch {
      status.textContent = 'Could not open the voice demo. Check that the separate demo is installed and can open on this device, then try again.';
    } finally { button.disabled = false; }
  });
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

  const prepareDirect = document.createElement('button');
  prepareDirect.type = 'button';
  prepareDirect.textContent = 'Prepare or renew fictional computer identity (debug)';
  const openDirect = document.createElement('button');
  openDirect.type = 'button';
  openDirect.textContent = 'Open fictional computer connection (debug)';
  const directStatus = document.createElement('p');
  directStatus.setAttribute('role', 'status');
  prepareDirect.addEventListener('click', async () => {
    prepareDirect.disabled = true;
    try {
      await window.__TAURI__.core.invoke('open_fictional_vault', { kind: 'prepare-direct' });
      directStatus.textContent = 'Test identity prepared or renewed. Re-pair with the computer before connecting.';
    } catch {
      directStatus.textContent = 'Test identity unavailable. No computer access was granted.';
    } finally { prepareDirect.disabled = false; }
  });
  openDirect.addEventListener('click', async () => {
    openDirect.disabled = true;
    try {
      await window.__TAURI__.core.invoke('open_fictional_vault', { kind: 'open-direct' });
      directStatus.textContent = 'Native connection screen requested. Review the computer and selected read there.';
    } catch {
      directStatus.textContent = 'Private test connection unavailable. No computer access was granted.';
    } finally { openDirect.disabled = false; }
  });
  document.querySelector('#home-actions').append(prepareDirect, openDirect, directStatus);
  const vehicle = document.createElement('button');
  vehicle.type = 'button';
  vehicle.textContent = 'Set up vehicle greetings (parked, debug)';
  vehicle.addEventListener('click', async () => {
    vehicle.disabled = true;
    try {
      await window.__TAURI__.core.invoke('open_fictional_vault', { kind: 'vehicle' });
      directStatus.textContent = 'Vehicle setup requested. Choose your paired vehicle on the native screen.';
    } catch { directStatus.textContent = 'Vehicle setup unavailable. Requires Android 12 or later.'; }
    finally { vehicle.disabled = false; }
  });
  document.querySelector('#home-actions').append(vehicle);
}
await import('./app.js');
