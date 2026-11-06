import { createOfflineDraftClient } from '../lib/offline-drafts.js';
import { useOfflineDraftClient } from './draft-client.js';

useOfflineDraftClient(createOfflineDraftClient());
document.querySelector('.preview-note p').textContent = 'Use made-up details only. This app preview keeps its draft on this device until you close or reload it. It is not a secure vault.';
document.querySelector('#draft-empty p').textContent = 'Try our made-up family to explore the app. An assistant is not connected to this offline preview yet.';
document.querySelector('#native-notices').hidden = false;
if (typeof __ANDROID_VAULT_DEBUG__ !== 'undefined' && __ANDROID_VAULT_DEBUG__ && window.__TAURI__?.core) {
  const lunaLink = document.createElement('a');
  lunaLink.href = '#luna';
  lunaLink.innerHTML = 'Meet Luna <small>Wake listening and timers</small>';
  document.querySelector('#home-actions').append(lunaLink);
  const luna = document.createElement('section');
  luna.id = 'luna';
  luna.className = 'vault';
  luna.hidden = true;
  luna.innerHTML = `<a class="back-link" href="#welcome">← Back home</a>
    <div class="checklist-intro"><p class="eyebrow">LUNA</p>
    <h1 id="luna-heading" tabindex="-1">Meet Luna.</h1>
    <p>Wake listening and Luna timers belong to this Home app. Nothing listens until you enable it here.</p></div>
    <div class="list-panel luna-panel"><svg class="luna-avatar" viewBox="0 0 400 410" role="img" aria-labelledby="luna-avatar-title"><title id="luna-avatar-title">Luna, your chibi voice companion</title>
      <circle cx="200" cy="166" r="139" fill="#b7a9f2" opacity=".14"/>
      <path d="M91 119C57 98 28 133 37 169c7 26-8 51 2 70 28-3 48-31 44-55-4-26 25-41 8-65Z" fill="#b7a9f2"/><path d="M309 119c34-21 63 14 54 50-7 26 8 51-2 70-28-3-48-31-44-55 4-26-25-41-8-65Z" fill="#b7a9f2"/>
      <rect x="69" y="100" width="262" height="164" rx="78" fill="#fff1e0"/><path d="M73 169C55 82 119 55 195 72c78-23 152 24 134 99-14-14-19-37-19-60-43 10-80-9-94-25-14 35-70 46-105 29-17 13-24 36-38 54Z" fill="#b7a9f2"/>
      <path d="M200 65C177 42 143 24 130 36c-11 12-2 51 13 58 15 6 42-15 57-29Zm0 0c23-23 57-41 70-29 11 12 2 51-13 58-15 6-42-15-57-29Z" fill="#8cefd9" stroke="#fff1e0" stroke-width="5"/><circle cx="200" cy="66" r="15" fill="#6dd6c3"/>
      <path d="M122 174q23-29 46 0m64 0q23-29 46 0" fill="none" stroke="#111426" stroke-width="9" stroke-linecap="round"/><ellipse cx="112" cy="213" rx="18" ry="8" fill="#f2a8ae"/><ellipse cx="288" cy="213" rx="18" ry="8" fill="#f2a8ae"/><path d="M184 211q16 23 32 0" fill="none" stroke="#111426" stroke-width="6" stroke-linecap="round"/><path d="M304 96a18 18 0 1 0 15 29 19 19 0 0 1-15-29Z" fill="#ffda86"/>
    </svg>
    <h2>Home voice status</h2>
    <p id="luna-state" role="status" aria-live="polite">Checking Home voice status…</p>
      <p id="luna-details">Online answers are off. Questions are not sent anywhere.</p>
    <button id="luna-online-answers" class="luna-online-toggle" type="button" aria-pressed="false" disabled>Turn on Qwen answers</button>
    <p id="luna-online-label">Send finalized questions to Qwen on my Mac Studio for spoken answers</p>
    <p id="luna-online-help">Configure the private Mac relay before enabling online answers. Changing this setting stops wake listening.</p>
    <button id="refresh-luna-state" type="button">Refresh status</button>
    <p>Allow microphone access, then choose Enable. Locking, muting, or revoking permission stops listening. Timers continue when listening is disabled.</p>
    <button id="allow-luna-mic" type="button">Allow microphone</button>
    <button id="enable-luna-wake" class="primary-button" type="button">Enable wake-word listening</button>
    <button id="disable-luna-wake" type="button">Disable listening</button>
    <div id="luna-timers" aria-live="polite"></div></div>`;
  document.querySelector('main').append(luna);
  const stateText = luna.querySelector('#luna-state');
  const stateDetails = luna.querySelector('#luna-details');
  const onlineAnswers = luna.querySelector('#luna-online-answers');
  const onlineHelp = luna.querySelector('#luna-online-help');
  const refreshState = luna.querySelector('#refresh-luna-state');
  const statusPollIntervalMs = 5000;
  let snapshotPoll;
  let snapshotRefreshInFlight = false;
  const stopSnapshotPoll = () => {
    if (snapshotPoll !== undefined) {
      clearTimeout(snapshotPoll);
      snapshotPoll = undefined;
    }
  };
  const scheduleSnapshotPoll = () => {
    stopSnapshotPoll();
    if (luna.hidden || document.hidden) return;
    snapshotPoll = setTimeout(async () => {
      snapshotPoll = undefined;
      await refreshSnapshot();
    }, statusPollIntervalMs);
  };
  const scheduleSnapshotPollAfterNavigation = () => queueMicrotask(scheduleSnapshotPoll);
  const refreshSnapshot = async () => {
    if (snapshotRefreshInFlight) return;
    snapshotRefreshInFlight = true;
    refreshState.disabled = true;
    stateText.textContent = 'Checking Home voice status…';
    try {
      const snapshot = await window.__TAURI__.core.invoke('get_luna_snapshot');
        const phases = { off: 'Microphone off.', preparing: 'Preparing wake listening; microphone is off.', waiting: 'Listening locally for Hey Luna.', awake: 'Luna heard the wake phrase and is listening for a timer command.', response: 'Luna is responding; microphone paused.', retry: 'Listening paused. Enable it again when ready.' };
        if (snapshot.status !== 'ready') {
          stateText.textContent = snapshot.reason === 'local_model_unavailable' ? 'Local wake model unavailable. Listening is off.' : 'Home voice service unavailable.';
        } else {
          stateText.textContent = snapshot.microphoneInUse ? (phases[snapshot.capturePhase] || 'Microphone is on.') : (phases[snapshot.capturePhase] || 'Microphone off.');
        }
      stateDetails.textContent = snapshot.onlineAnswersEnabled ? 'Online answers are enabled.' : 'Online answers are off. Questions are not sent anywhere.';
      onlineAnswers.setAttribute('aria-pressed', snapshot.onlineAnswersEnabled === true ? 'true' : 'false');
      onlineAnswers.textContent = snapshot.onlineAnswersEnabled === true ? 'Turn off Qwen answers' : 'Turn on Qwen answers';
      onlineAnswers.disabled = snapshot.onlineAnswersAvailable !== true;
      onlineHelp.textContent = snapshot.onlineAnswersAvailable
        ? 'Questions are sent to your configured Mac Studio relay. Changing this setting stops listening; enable wake listening again when ready.'
        : 'Configure the private Mac relay before enabling online answers. Changing this setting stops wake listening.';
      const timers = luna.querySelector('#luna-timers');
      timers.replaceChildren();
      for (const timer of snapshot.activeTimers || []) {
        const row = document.createElement('p');
        row.textContent = `Timer ${timer.id}: ${timer.remainingSeconds} seconds remaining. `;
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.textContent = `Cancel timer ${timer.id}`;
        cancel.addEventListener('click', async () => {
          cancel.disabled = true;
          try { await window.__TAURI__.core.invoke('cancel_luna_timer', { id: Number(timer.id) }); await refreshSnapshot(); }
          catch { cancel.disabled = false; stateText.textContent = 'Could not confirm timer cancellation. Refresh the status before retrying.'; }
        });
        row.append(cancel); timers.append(row);
      }
    } catch {
      stateText.textContent = 'Voice status unavailable.';
      stateDetails.textContent = 'Home could not confirm microphone or timer state.';
    } finally {
      snapshotRefreshInFlight = false;
      refreshState.disabled = false;
      scheduleSnapshotPoll();
    }
  };
  refreshState.addEventListener('click', refreshSnapshot);
  onlineAnswers.addEventListener('click', async () => {
    const enabled = onlineAnswers.getAttribute('aria-pressed') !== 'true';
    onlineAnswers.disabled = true;
    try { await window.__TAURI__.core.invoke('set_luna_online_answers', { enabled }); }
    catch { stateText.textContent = 'Could not change online-answer setting. Check the private relay configuration.'; }
    await refreshSnapshot();
  });
  window.addEventListener?.('hashchange', scheduleSnapshotPollAfterNavigation);
  document.addEventListener?.('visibilitychange', scheduleSnapshotPoll);
  void refreshSnapshot();
  luna.querySelector('#allow-luna-mic').addEventListener('click', async () => {
      try { await window.__TAURI__.core.invoke('request_luna_microphone'); }
      catch { stateText.textContent = 'Could not request microphone access.'; }
    await refreshSnapshot();
  });
  luna.querySelector('#enable-luna-wake').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await window.__TAURI__.core.invoke('enable_luna_wake'); }
    catch { stateText.textContent = 'Could not start listening. Check microphone permission, lock, mute, and model availability.'; }
    finally { button.disabled = false; await refreshSnapshot(); }
  });
  luna.querySelector('#disable-luna-wake').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await window.__TAURI__.core.invoke('disable_luna_wake'); }
    catch { stateText.textContent = 'Could not confirm listening stopped. Refresh status.'; }
    finally { button.disabled = false; await refreshSnapshot(); }
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
