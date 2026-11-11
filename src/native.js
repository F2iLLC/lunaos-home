import { createOfflineDraftClient } from '../lib/offline-drafts.js';
import { useOfflineDraftClient } from './draft-client.js';
import { createNotebookPopup } from './notebook-popup.js';

useOfflineDraftClient(createOfflineDraftClient());
document.querySelector('.preview-note p').textContent = 'Use made-up details only. This app preview keeps its draft on this device until you close or reload it. It is not a secure vault.';
document.querySelector('#draft-empty p').textContent = 'Try our made-up family to explore the app. An assistant is not connected to this offline preview yet.';
document.querySelector('#native-notices').hidden = false;
if (typeof __ANDROID_VAULT_DEBUG__ !== 'undefined' && __ANDROID_VAULT_DEBUG__ && window.__TAURI__?.core) {
  // Luna lives on the home page: her face shows what she is doing, running
  // timers sit under it, and the gear opens settings and troubleshooting.
  const notebookPopup = createNotebookPopup();
  const welcome = document.querySelector('#welcome');
  const gear = document.createElement('a');
  gear.href = '#luna';
  gear.className = 'settings-gear';
  gear.setAttribute('aria-label', 'Settings and Luna troubleshooting');
  gear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6ZM13 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Z" transform="translate(-1 0)" fill="currentColor"/></svg>';
  welcome.append(gear);
  // Pressing Luna turns wake listening on or off. Asleep (mask, snoring) means
  // the microphone is off; a faint glow means she is listening for her name;
  // a bright glow means she is ready for a command.
  const face = document.createElement('button');
  face.type = 'button';
  face.id = 'home-luna-toggle';
  face.className = 'home-luna-face';
  face.setAttribute('aria-pressed', 'false');
  face.setAttribute('aria-label', 'Luna is asleep. Press to turn on Hey Luna listening.');
  face.innerHTML = `<svg class="luna-avatar" data-capture-phase="off" viewBox="0 0 400 410" aria-hidden="true">
      <circle class="luna-avatar-glow" cx="200" cy="172" r="150" fill="#8cefd9"/>
      <circle class="luna-avatar-halo" cx="200" cy="166" r="139" fill="#b7a9f2" opacity=".14"/>
      <path d="M91 119C57 98 28 133 37 169c7 26-8 51 2 70 28-3 48-31 44-55-4-26 25-41 8-65Z" fill="#b7a9f2"/><path d="M309 119c34-21 63 14 54 50-7 26 8 51-2 70-28-3-48-31-44-55 4-26-25-41-8-65Z" fill="#b7a9f2"/>
      <rect x="69" y="100" width="262" height="164" rx="78" fill="#fff1e0"/><path d="M73 169C55 82 119 55 195 72c78-23 152 24 134 99-14-14-19-37-19-60-43 10-80-9-94-25-14 35-70 46-105 29-17 13-24 36-38 54Z" fill="#b7a9f2"/>
      <path d="M200 65C177 42 143 24 130 36c-11 12-2 51 13 58 15 6 42-15 57-29Zm0 0c23-23 57-41 70-29 11 12 2 51-13 58-15 6-42-15-57-29Z" fill="#8cefd9" stroke="#fff1e0" stroke-width="5"/><circle cx="200" cy="66" r="15" fill="#6dd6c3"/>
      <g class="luna-avatar-eyes-closed" fill="none" stroke="#111426" stroke-width="9" stroke-linecap="round"><path d="M122 174q23-29 46 0m64 0q23-29 46 0"/></g>
      <g class="luna-avatar-eyes-open"><ellipse cx="145" cy="168" rx="13" ry="19" fill="#28243d"/><ellipse cx="255" cy="168" rx="13" ry="19" fill="#28243d"/><circle cx="149" cy="161" r="4" fill="white"/><circle cx="259" cy="161" r="4" fill="white"/></g>
      <g class="luna-avatar-mask"><path d="M104 160 70 152m226 8 34-8" fill="none" stroke="#6f63b8" stroke-width="7" stroke-linecap="round"/><path d="M104 158q40-26 80-4 16 8 32 0 40-22 80 4 8 26-18 38-34 14-58-8-20-8-40 0-24 22-58 8-26-12-18-38Z" fill="#6f63b8" stroke="#8cefd9" stroke-width="4" stroke-linejoin="round"/><path d="M128 176q17 14 34 0m76 0q17 14 34 0" fill="none" stroke="#d9d2ff" stroke-width="5" stroke-linecap="round"/></g>
      <ellipse cx="112" cy="213" rx="18" ry="8" fill="#f2a8ae"/><ellipse cx="288" cy="213" rx="18" ry="8" fill="#f2a8ae"/><path class="luna-avatar-smile" d="M184 211q16 23 32 0" fill="none" stroke="#111426" stroke-width="6" stroke-linecap="round"/><ellipse class="luna-avatar-snore" cx="200" cy="221" rx="9" ry="8" fill="#111426"/><path d="M304 96a18 18 0 1 0 15 29 19 19 0 0 1-15-29Z" fill="#ffda86"/>
      <g class="luna-avatar-zs" fill="#d9d2ff" font-family="system-ui, sans-serif" font-weight="800"><text x="318" y="150" font-size="26">z</text><text x="338" y="128" font-size="32">z</text><text x="356" y="100" font-size="40">Z</text></g>
      <g class="luna-notebook-feedback" aria-hidden="true"><path d="M117 250l79 11 87-11v52l-87 8-79-8Z" fill="#fff1e0" stroke="#b7a9f2" stroke-width="3"/><path d="M196 261v49" stroke="#28243d" stroke-width="3"/><text class="luna-notebook-mark" x="235" y="294" text-anchor="middle" font-size="35" fill="#28243d"></text></g>
    </svg>`;
  document.querySelector('.luna-companion').replaceWith(face);
  const avatar = face.querySelector('.luna-avatar');
  const notebookMark = face.querySelector('.luna-notebook-mark');
  const home = document.createElement('div');
  home.id = 'home-luna';
  home.className = 'home-luna';
  home.innerHTML = `<p id="home-luna-state" role="status" aria-live="polite">Checking on Luna…</p>
    <p id="home-luna-heard" hidden></p>
    <section id="home-timers" class="luna-timer-section" aria-labelledby="luna-timers-heading" hidden>
      <h2 id="luna-timers-heading">Active timers</h2>
      <div id="luna-timers" aria-live="off"></div>
    </section>
    <p id="luna-timer-status" role="status" aria-live="polite"></p>`;
  face.after(home);
  const homeState = home.querySelector('#home-luna-state');
  const heardText = home.querySelector('#home-luna-heard');
  let listening = false;
  const showListening = on => {
    listening = on;
    face.setAttribute('aria-pressed', on ? 'true' : 'false');
    face.setAttribute('aria-label', on ? 'Luna is listening for Hey Luna. Press to turn listening off.'
      : 'Luna is asleep. Press to turn on Hey Luna listening.');
  };
  const homeTimers = home.querySelector('#home-timers');
  const luna = document.createElement('section');
  luna.id = 'luna';
  luna.className = 'vault';
  luna.hidden = true;
  luna.innerHTML = `<a class="back-link" href="#welcome">← Back home</a>
    <div class="checklist-intro"><p class="eyebrow">SETTINGS</p>
    <h1 id="luna-heading" tabindex="-1">Luna settings.</h1>
    <p>Wake listening and Luna timers belong to this Home app. Nothing listens until you turn it on. Use this page when something is not working.</p></div>
    <div class="list-panel luna-panel">
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
    <p>Active timers are on the home page.</p></div>`;
  document.querySelector('main').append(luna);
  const stateText = luna.querySelector('#luna-state');
  const stateDetails = luna.querySelector('#luna-details');
  const onlineAnswers = luna.querySelector('#luna-online-answers');
  const onlineHelp = luna.querySelector('#luna-online-help');
  const refreshState = luna.querySelector('#refresh-luna-state');
  const timers = home.querySelector('#luna-timers');
  const timerStatus = home.querySelector('#luna-timer-status');
  const statusPollIntervalMs = 5000;
  // While Luna is listening her face follows her closely; otherwise it idles.
  const listeningPollIntervalMs = 1000;
  let pollIntervalMs = statusPollIntervalMs;
  let snapshotPoll;
  let timerCountdownPoll;
  let snapshotRefreshInFlight = false;
  // Luna's state is shown on the home page and on the settings page.
  const offscreen = () => (luna.hidden && welcome.hidden) || document.hidden;
  const formatTimerDuration = seconds => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const remainder = String(seconds % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
  };
  const showCountdown = (countdown, remaining) => {
    countdown.textContent = remaining > 0 ? formatTimerDuration(remaining) : 'Time is up';
    countdown.setAttribute('aria-label', remaining > 0 ? `${remaining} seconds remaining` : 'Time is up');
  };
  const stopTimerCountdown = () => {
    if (timerCountdownPoll !== undefined) {
      clearInterval(timerCountdownPoll);
      timerCountdownPoll = undefined;
    }
  };
  const updateTimerCountdowns = () => {
    const now = performance.now();
    for (const countdown of timers.querySelectorAll('[data-deadline]')) {
      showCountdown(countdown, Math.max(0, Math.ceil((Number(countdown.dataset.deadline) - now) / 1000)));
    }
  };
  const stopSnapshotPoll = () => {
    if (snapshotPoll !== undefined) {
      clearTimeout(snapshotPoll);
      snapshotPoll = undefined;
    }
  };
  const scheduleSnapshotPoll = () => {
    stopSnapshotPoll();
    if (offscreen()) {
      stopTimerCountdown();
      return;
    }
    if (timerCountdownPoll === undefined) timerCountdownPoll = setInterval(updateTimerCountdowns, 1000);
    snapshotPoll = setTimeout(async () => {
      snapshotPoll = undefined;
      await refreshSnapshot();
    }, pollIntervalMs);
  };
  const scheduleSnapshotPollAfterNavigation = () => queueMicrotask(() => {
    if (offscreen()) {
      stopSnapshotPoll();
      stopTimerCountdown();
      return;
    }
    void refreshSnapshot();
  });
  const refreshSnapshot = async announce => {
    if (snapshotRefreshInFlight) return;
    snapshotRefreshInFlight = true;
    refreshState.disabled = true;
    // Background polls stay quiet; only an asked-for check says it is checking.
    if (announce) stateText.textContent = 'Checking Home voice status…';
    try {
      const snapshot = await window.__TAURI__.core.invoke('get_luna_snapshot');
        const phases = { off: 'Microphone off.', preparing: 'Preparing wake listening; microphone is off.', waiting: 'Listening locally for Hey Luna.', awake: 'Luna heard the wake phrase and is listening for a timer command.', review: 'Luna is working out what she heard; microphone paused.', response: 'Luna is responding; microphone paused.', retry: 'Luna did not catch a command and is getting ready to listen again.' };
        const phase = phases[snapshot.capturePhase] ? snapshot.capturePhase : 'off';
        // Only 'off' means listening is disabled. While she thinks or resets between
        // requests she stays awake: no sleep mask.
        const face = { review: 'response', retry: 'waiting' }[phase] || phase;
        avatar.dataset.capturePhase = snapshot.status === 'ready' ? face : 'off';
        const notebookMarks = { 'new-page': '✧', scribble: '✎', read: '…', checkmark: '✓', 'cross-out': '×', 'erase-rewrite': '✎', hover: '…', puzzled: '?' };
        const animation = snapshot.status === 'ready' && phase === 'response' && !(snapshot.activeTimers || []).some(timer => timer.remainingSeconds === 0)
          && Object.hasOwn(notebookMarks, snapshot.notebookAnimation) ? snapshot.notebookAnimation : '';
        heardText.textContent = snapshot.status === 'ready' && phase !== 'off' && snapshot.lastHeard ? `Heard: “${snapshot.lastHeard}”` : '';
        heardText.hidden = !heardText.textContent;
        notebookPopup.update(snapshot);
        avatar.dataset.notebookAnimation = animation;
        notebookMark.textContent = notebookMarks[animation] || '';

        pollIntervalMs = snapshot.status === 'ready' && phase !== 'off' ? listeningPollIntervalMs : statusPollIntervalMs;
        if (snapshot.status !== 'ready') {
          stateText.textContent = snapshot.reason === 'local_model_unavailable' ? 'Local wake model unavailable. Listening is off.' : 'Home voice service unavailable.';
          homeState.textContent = 'Luna is not available right now. The gear has more.';
          showListening(false);
        } else {
          stateText.textContent = snapshot.microphoneInUse ? (phases[snapshot.capturePhase] || 'Microphone is on.') : (phases[snapshot.capturePhase] || 'Microphone off.');
          const friendly = { off: 'Luna is asleep. The microphone is off. Press her to wake her.', preparing: 'Luna is waking up…', waiting: 'Say “Hey Luna” when you need me.', awake: 'I’m listening…', review: 'Let me think…', response: 'One moment…', retry: 'I didn’t catch that. Say “Hey Luna” to try again.' };
          homeState.textContent = friendly[phase];
          showListening(phase !== 'off');
        }
      stateDetails.textContent = snapshot.onlineAnswersEnabled ? 'Online answers are enabled.' : 'Online answers are off. Questions are not sent anywhere.';
      onlineAnswers.setAttribute('aria-pressed', snapshot.onlineAnswersEnabled === true ? 'true' : 'false');
      onlineAnswers.textContent = snapshot.onlineAnswersEnabled === true ? 'Turn off Qwen answers' : 'Turn on Qwen answers';
      onlineAnswers.disabled = snapshot.onlineAnswersAvailable !== true;
      onlineHelp.textContent = snapshot.onlineAnswersAvailable
        ? 'Questions are sent to your configured Mac Studio relay. Changing this setting stops listening; enable wake listening again when ready.'
        : 'Configure the private Mac relay before enabling online answers. Changing this setting stops wake listening.';
      timers.replaceChildren();
      const activeTimers = snapshot.activeTimers || [];
      // The home page stays clear until there is a timer to show.
      homeTimers.hidden = activeTimers.length === 0;
      for (const timer of activeTimers) {
        const row = document.createElement('article');
        row.className = 'luna-timer-card';
        const label = document.createElement('span');
        label.className = 'luna-timer-label';
        label.textContent = `Timer ${timer.id}`;
        const countdown = document.createElement('time');
        countdown.className = 'luna-timer-countdown';
        countdown.setAttribute('role', 'timer');
        countdown.setAttribute('aria-live', 'off');
        countdown.dataset.deadline = String(performance.now() + Math.max(0, Number(timer.remainingSeconds) || 0) * 1000);
        showCountdown(countdown, Math.max(0, Math.ceil(Number(timer.remainingSeconds) || 0)));
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'luna-timer-cancel';
        cancel.textContent = 'Stop and cancel timer';
        cancel.setAttribute('aria-label', `Stop and cancel timer ${timer.id}`);
        cancel.addEventListener('click', async () => {
          cancel.disabled = true;
          cancel.textContent = 'Stopping timer…';
          try {
            await window.__TAURI__.core.invoke('cancel_luna_timer', { id: Number(timer.id) });
            timerStatus.textContent = `Timer ${timer.id} canceled.`;
            await refreshSnapshot();
          } catch {
            cancel.disabled = false;
            cancel.textContent = 'Stop and cancel timer';
            timerStatus.textContent = `Could not cancel timer ${timer.id}. Refresh status and try again.`;
          }
        });
        const details = document.createElement('div');
        details.className = 'luna-timer-details';
        details.append(label, countdown);
        row.append(details, cancel);
        timers.append(row);
      }
    } catch {
      stateText.textContent = 'Voice status unavailable.';
      stateDetails.textContent = 'Home could not confirm microphone or timer state.';
      homeState.textContent = 'Luna is not answering right now. The gear has more.';
      avatar.dataset.capturePhase = 'off';
      showListening(false);
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
  document.addEventListener?.('visibilitychange', () => {
    if (document.hidden) {
      stopSnapshotPoll();
      stopTimerCountdown();
    } else if (!offscreen()) {
      void refreshSnapshot();
    }
  });
  void refreshSnapshot(true);
  // Turning listening on or off is always the person's own press, on Luna
  // herself or in settings.
  face.addEventListener('click', async () => {
    const stopping = listening;
    face.disabled = true;
    let failed = false;
    try { await window.__TAURI__.core.invoke(stopping ? 'disable_luna_wake' : 'enable_luna_wake'); }
    catch { failed = true; }
    finally { face.disabled = false; await refreshSnapshot(); }
    if (failed) homeState.textContent = stopping ? 'Luna could not confirm that listening stopped. Open the gear to check.'
      : 'Luna could not start listening. Open the gear to allow the microphone.';
  });
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

await import('./notebook.js');
