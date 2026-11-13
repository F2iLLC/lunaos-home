import { createOfflineDraftClient } from '../lib/offline-drafts.js';
import { useOfflineDraftClient } from './draft-client.js';
import { createLunaCaptions } from './luna-captions.js';
import { createNotebookPopup } from './notebook-popup.js';
import { mountLunaAvatar } from './luna/avatar.js';
import { homeAvatarState, homeCommandReady } from './luna/presentation.js';
import { createLunaVoiceSettings } from './luna-voice-settings.js';

const welcomeAvatarHost = document.querySelector('#welcome-luna');
const avatar = welcomeAvatarHost
  ? mountLunaAvatar(welcomeAvatarHost, { label: 'Luna, your animated chibi companion', size: 'min(34vw, 190px)' })
  : null;
window.addEventListener?.('pagehide', () => avatar?.dispose(), { once: true });

const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
useOfflineDraftClient(createOfflineDraftClient());
document.querySelector('.preview-note p').textContent = 'Use made-up details only. This app preview keeps its draft on this device until you close or reload it. It is not a secure vault.';
document.querySelector('#draft-empty p').textContent = 'Try our made-up family to explore the app. An assistant is not connected to this offline preview yet.';
document.querySelector('#native-notices').hidden = false;
if (typeof __ANDROID_VAULT_DEBUG__ !== 'undefined' && __ANDROID_VAULT_DEBUG__ && window.__TAURI__?.core) {
  // Luna lives on the home page: her face shows what she is doing, running
  // timers sit under it, and the gear opens settings and troubleshooting.
  let character = 'luna', scienceOutfit = false;
  try { character = window.localStorage.getItem('home-character') === 'liam' ? 'liam' : 'luna'; scienceOutfit = window.localStorage.getItem('liam-science-outfit') === 'true'; } catch { /* Session choice still works. */ }
  const applyCharacter = value => {
    character = value === 'liam' ? 'liam' : 'luna';
    avatar.update({ character, scienceOutfit, label: character === 'liam' ? 'Liam' : 'Luna' });
    setText(document.querySelector('#welcome-heading'), character === 'liam' ? 'Welcome home, Liam.' : 'Welcome home.');
    setText(document.querySelector('.header-note'), character === 'liam' ? 'A little room to think.' : 'A little room to breathe.');
    const intro = document.querySelector('#welcome .intro');
    setText(intro, character === 'liam' ? 'A curious mind at your side.\nExplore, ask, calculate, and discover together.' : 'A little less to carry.\nA little more space for you.');
  };
  const notebookPopup = createNotebookPopup({ character, onCharacter: applyCharacter });
  applyCharacter(character);
  const welcome = document.querySelector('#welcome');
  welcome.dataset.nativeHome = 'true';
  const gear = document.createElement('a');
  gear.href = '#luna';
  gear.className = 'settings-gear';
  gear.setAttribute('aria-label', 'Settings and Luna troubleshooting');
  gear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6ZM13 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Z" transform="translate(-1 0)" fill="currentColor"/></svg>';
  welcome.append(gear);
  // Pressing Luna controls wake listening. Her presentation follows the native snapshot.
  const face = document.createElement('button');
  face.type = 'button';
  face.id = 'home-luna-toggle';
  face.className = 'home-luna-face';
  face.setAttribute('aria-pressed', 'false');
  face.setAttribute('aria-label', 'Luna’s voice status is loading. Press to enable Hey Luna listening.');
  welcomeAvatarHost.className = 'home-luna-avatar-host';
  welcomeAvatarHost.replaceWith(face);
  face.append(welcomeAvatarHost);
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
  const showListening = (on, status = on ? 'enabled' : 'disabled', commandReady = false) => {
    if (listening !== on) {
      listening = on;
      face.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const labels = {
      enabled: commandReady ? 'Luna heard Hey Luna and is waiting for your command. Press to turn listening off.' : 'Luna is listening for Hey Luna. Press to turn listening off.',
      disabled: 'Luna is asleep and wake-word listening is disabled. Press to turn it on.',
      permission: 'Luna cannot listen because microphone permission is unavailable. Press to retry.',
      muted: 'Luna cannot listen because the microphone is muted. Press to retry.',
      locked: 'Luna cannot listen while this device is locked. Press to retry.',
      disconnected: 'Luna’s voice service disconnected. Press to retry listening.',
      unavailable: 'Luna’s voice service is unavailable. Open settings for details.',
    };
    face.setAttribute('aria-label', (labels[status] || labels.unavailable).replaceAll('Luna', character === 'liam' ? 'Liam' : 'Luna'));
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
    <h2>Voice</h2>
    <div id="luna-voice" class="luna-voice-choices" role="group" aria-label="Luna’s voice" aria-describedby="luna-voice-help luna-voice-status"></div>
    <p id="luna-voice-help">Tap a voice to select it and hear a sample: “Set for 5 minutes.” This is only a preview; no timer starts. Your choice stays saved for timer replies and online answers.</p>
    <p id="luna-voice-status" role="status" aria-live="polite"></p>
    <h2>Companion</h2>
    <label for="home-character">Home character</label><select id="home-character"><option value="luna">Luna</option><option value="liam">Liam</option></select>
    <label for="liam-outfit">Liam’s wardrobe</label><select id="liam-outfit"><option value="everyday">Everyday hoodie</option><option value="science">Science lab coat and goggles</option></select>
    <p>Say “Hey Luna” or “Hey Liam” to choose a companion. Both use the same voice service. Choose Liam’s science outfit here whenever you want it.</p>
    <button id="open-assistant-drawer" type="button">Open notebook / calculator</button>
    <h2>Accessibility</h2>
    <button id="luna-captions-toggle" type="button" aria-pressed="true">Luna captions: On</button>
    <p>Show Luna’s replies as readable text. Captions clear six seconds after she finishes speaking.</p>
    <h2>Home voice status</h2>
    <p id="luna-state" role="status" aria-live="polite">Checking Home voice status…</p>
      <p id="luna-details">Online answers are off. Questions are not sent anywhere.</p>
    <button id="luna-online-answers" class="luna-online-toggle" type="button" aria-pressed="false" disabled>Turn on Qwen answers</button>
    <p id="luna-online-label">Use my Mac for speech recognition and Qwen answers</p>
    <p id="luna-online-help">Configure the private Mac relay before enabling online answers. When listening is enabled, speech segments go to your Mac for wake-word and command recognition. Changing this setting stops listening.</p>
    <button id="refresh-luna-state" type="button">Refresh status</button>
    <p>Allow microphone access, then choose Enable. Locking, muting, or revoking permission stops listening. Timers continue when listening is disabled.</p>
    <button id="allow-luna-mic" type="button">Allow microphone</button>
    <button id="enable-luna-wake" class="primary-button" type="button">Enable wake-word listening</button>
    <button id="disable-luna-wake" type="button">Disable listening</button>
    <p>Active timers are on the home page.</p></div>`;
  document.querySelector('main').append(luna);
  const characterChoice = luna.querySelector('#home-character'), outfitChoice = luna.querySelector('#liam-outfit');
  characterChoice.value = character; outfitChoice.value = scienceOutfit ? 'science' : 'everyday';
  characterChoice.addEventListener('change', () => {
    applyCharacter(characterChoice.value); notebookPopup.setCharacter(character);
    try { window.localStorage.setItem('home-character', character); } catch { /* Session only. */ }
  });
  outfitChoice.addEventListener('change', () => {
    scienceOutfit = outfitChoice.value === 'science'; applyCharacter(character);
    try { window.localStorage.setItem('liam-science-outfit', String(scienceOutfit)); } catch { /* Session only. */ }
  });
  luna.querySelector('#open-assistant-drawer').addEventListener('click', () => notebookPopup.open());
  const captions = createLunaCaptions(luna.querySelector('#luna-captions-toggle'), { document });
  const voiceSettings = createLunaVoiceSettings(luna.querySelector('#luna-voice'), luna.querySelector('#luna-voice-status'), {
    document, invoke: (command, args) => window.__TAURI__.core.invoke(command, args),
  });
  const stateText = luna.querySelector('#luna-state');
  const stateDetails = luna.querySelector('#luna-details');
  const onlineAnswers = luna.querySelector('#luna-online-answers');
  const onlineHelp = luna.querySelector('#luna-online-help');
  const refreshState = luna.querySelector('#refresh-luna-state');
  const timers = home.querySelector('#luna-timers');
  const timerStatus = home.querySelector('#luna-timer-status');
  let timerStatusTimeout;
  let timerStatusClearTimeout;
  const announceTimerStatus = message => {
    if (timerStatusTimeout !== undefined) clearTimeout(timerStatusTimeout);
    if (timerStatusClearTimeout !== undefined) clearTimeout(timerStatusClearTimeout);
    setText(timerStatus, message);
    timerStatus.classList.add('is-visible');
    timerStatusTimeout = setTimeout(() => {
      timerStatus.classList.remove('is-visible');
      timerStatusTimeout = undefined;
      timerStatusClearTimeout = setTimeout(() => {
        setText(timerStatus, '');
        timerStatusClearTimeout = undefined;
      }, 500);
    }, 3000);
  };
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
  const showCountdown = (countdown, remaining, paused = false) => {
    countdown.textContent = paused ? `Paused · ${formatTimerDuration(remaining)}` : remaining > 0 ? formatTimerDuration(remaining) : 'Time is up';
    countdown.setAttribute('aria-label', paused ? `Paused with ${remaining} seconds remaining` : remaining > 0 ? `${remaining} seconds remaining` : 'Time is up');
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
      voiceSettings.update(snapshot);
        const phases = { off: 'Microphone off.', preparing: 'Preparing wake listening; microphone is off.', waiting: 'Listening for Hey Luna on your Mac.', awake: 'Luna heard the wake phrase and is waiting for your command.', review: 'Luna is working out what she heard; microphone paused.', response: snapshot.replyPlaying === true ? 'Luna is speaking; microphone paused.' : 'Luna is preparing her reply; microphone paused.', retry: 'Luna did not catch a command and is getting ready to listen again.' };
        const phase = phases[snapshot.capturePhase] ? snapshot.capturePhase : 'off';
        const commandReady = homeCommandReady(snapshot);
        home.dataset.commandReady = String(commandReady);
        avatar.update({ state: homeAvatarState(snapshot), listeningDisabled: snapshot.listeningStatus === 'disabled' });
        setText(heardText, snapshot.status === 'ready' && phase !== 'off' && snapshot.lastHeard ? `Heard: “${snapshot.lastHeard}”` : '');
        heardText.hidden = !heardText.textContent;
        void notebookPopup.update(snapshot);
        characterChoice.value = character;
        captions.update({ ...snapshot, activeAssistant: character });
        pollIntervalMs = snapshot.status === 'ready' && snapshot.listeningStatus === 'enabled' ? listeningPollIntervalMs : statusPollIntervalMs;
        if (snapshot.status !== 'ready') {
          const blocked = { permission: 'Microphone permission is unavailable.', muted: 'The microphone is muted.', locked: 'The device is locked.', disconnected: 'Luna’s voice service disconnected.' }[snapshot.listeningStatus];
          stateText.textContent = blocked || (snapshot.reason === 'mac_speech_unavailable' ? 'Mac speech recognition unavailable. Listening is off.' : 'Home voice service unavailable.');
          homeState.textContent = blocked ? `${blocked} Open settings to review.` : 'Luna is not available right now. The gear has more.';
          showListening(false, snapshot.listeningStatus || 'unavailable');
        } else {
          const statusText = { disabled: 'Wake-word listening is disabled. Microphone off.', enabled: phases[snapshot.capturePhase] || 'Microphone is on.', permission: 'Microphone permission is unavailable. Listening is off.', muted: 'Microphone is muted. Listening is paused.', locked: 'Device is locked. Listening is paused.', disconnected: 'Voice service disconnected. Listening is off.', unavailable: 'Voice service is unavailable.' };
          setText(stateText, statusText[snapshot.listeningStatus] || phases[phase]);
          const timerRinging = (snapshot.activeTimers || []).some(timer => Number(timer.remainingSeconds) === 0);
          const friendly = { off: 'Luna is asleep. The microphone is off. Press to wake.', preparing: 'Luna is waking up…', waiting: 'Say “Hey Luna” when you need me.', awake: commandReady ? 'Speak now. Luna is listening for your command.' : timerRinging ? 'Luna is handling an active timer.' : 'I’m listening…', review: 'Let me think…', response: snapshot.replyPlaying === true ? 'Luna is speaking…' : 'One moment…', retry: 'I didn’t catch that. Say “Hey Luna” to try again.' };
          const availabilityText = { permission: 'Microphone permission is unavailable. Open settings to review access.', muted: 'The microphone is muted. Luna is paused.', locked: 'The device is locked. Luna is paused.', disconnected: 'Luna’s voice service disconnected. Open settings to check it.', unavailable: 'Luna’s voice service is unavailable.' };
          setText(homeState, snapshot.listeningStatus === 'disabled' ? friendly.off
            : snapshot.listeningStatus === 'enabled' ? friendly[phase]
              : (availabilityText[snapshot.listeningStatus] || 'Luna’s voice status needs attention.'));
          setText(homeState, homeState.textContent.replaceAll('Luna', character === 'liam' ? 'Liam' : 'Luna'));
          showListening(snapshot.listeningStatus === 'enabled', snapshot.listeningStatus, commandReady);
        }
      setText(stateDetails, snapshot.onlineAnswersEnabled ? 'Online answers are enabled.' : 'Online answers are off. Questions are not sent anywhere.');
      onlineAnswers.setAttribute('aria-pressed', snapshot.onlineAnswersEnabled === true ? 'true' : 'false');
      setText(onlineAnswers, snapshot.onlineAnswersEnabled === true ? 'Turn off Qwen answers' : 'Turn on Qwen answers');
      onlineAnswers.disabled = snapshot.onlineAnswersAvailable !== true;
      setText(onlineHelp, snapshot.onlineAnswersAvailable
        ? 'Questions are sent to your configured Mac Studio relay. Changing this setting stops listening; enable wake listening again when ready.'
        : 'Configure the private Mac relay before enabling online answers. When listening is enabled, speech segments go to your Mac for wake-word and command recognition. Changing this setting stops listening.');
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
        if (timer.paused !== true) countdown.dataset.deadline = String(performance.now() + Math.max(0, Number(timer.remainingSeconds) || 0) * 1000);
        showCountdown(countdown, Math.max(0, Math.ceil(Number(timer.remainingSeconds) || 0)), timer.paused === true);
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
            announceTimerStatus(`Timer ${timer.id} canceled.`);
            await refreshSnapshot();
          } catch {
            cancel.disabled = false;
            cancel.textContent = 'Stop and cancel timer';
            announceTimerStatus(`Could not cancel timer ${timer.id}. Refresh status and try again.`);
          }
        });
        const details = document.createElement('div');
        details.className = 'luna-timer-details';
        details.append(label, countdown);
        row.append(details, cancel);
        timers.append(row);
      }
    } catch {
      voiceSettings.unavailable();
      void notebookPopup.update({ status: 'unavailable' });
      home.dataset.commandReady = 'false';
      stateText.textContent = 'Voice status unavailable.';
      stateDetails.textContent = 'Home could not confirm microphone or timer state.';
      homeState.textContent = 'Luna is not answering right now. The gear has more.';
      avatar.update({ state: 'error' });
      showListening(false, 'unavailable');
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
    catch { stateText.textContent = 'Could not start listening. Check microphone permission, lock, mute, and the Mac connection.'; }
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
