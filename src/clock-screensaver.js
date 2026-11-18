export const CLOCK_DELAY_KEY = 'home-clock-delay-minutes';
export const DEFAULT_CLOCK_DELAY = 5;

export function clockDelay(value) {
  if (value === null || value === '') return DEFAULT_CLOCK_DELAY;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= 120 ? minutes : DEFAULT_CLOCK_DELAY;
}

// One timer for inactivity and one for the visible clock. The clock always reads
// system time, so sleep, time-zone changes and delayed callbacks cannot add drift.
export function createIdleClock({ window, document, show, hide, tick, available,
  delay = DEFAULT_CLOCK_DELAY, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let idleTimer, clockTimer, active = false, disposed = false, swallowUntil = 0;
  const cancel = () => {
    clearTimer(idleTimer); clearTimer(clockTimer);
    idleTimer = clockTimer = undefined;
  };
  const update = () => {
    if (!active || disposed) return;
    if (document.hidden || !available()) { wake(); return; }
    tick();
    clockTimer = setTimer(update, 1000);
  };
  const arm = () => {
    if (disposed || !delay || document.hidden) return;
    idleTimer = setTimer(() => {
      idleTimer = undefined;
      if (document.hidden || !available()) { arm(); return; }
      active = true;
      show(); update();
    }, delay * 60_000);
  };
  const wake = () => {
    cancel();
    if (active) { active = false; hide(); }
    arm();
  };
  const activity = event => {
    if (active) {
      // Consume the waking gesture so a tap cannot activate a hidden control.
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.type === 'pointerdown') swallowUntil = Date.now() + 750;
    } else if (Date.now() < swallowUntil && ['pointerup', 'click'].includes(event.type)) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    wake();
  };
  const events = ['pointerdown', 'pointerup', 'pointermove', 'click', 'keydown', 'wheel'];
  for (const type of events) window.addEventListener(type, activity, { capture: true, passive: false });
  window.addEventListener('hashchange', wake);
  document.addEventListener('visibilitychange', wake);
  arm();
  return {
    wake,
    setDelay(value) { delay = clockDelay(value); wake(); },
    dispose() {
      disposed = true; cancel();
      if (active) { active = false; hide(); }
      for (const type of events) window.removeEventListener(type, activity, true);
      window.removeEventListener('hashchange', wake);
      document.removeEventListener('visibilitychange', wake);
    },
  };
}

export function mountClockScreensaver({ window, document }) {
  const settings = document.querySelector('#clock-settings');
  const dialog = document.querySelector('#clock-screensaver');
  if (!settings || !dialog) return;
  dialog.prepend(document.querySelector('.landscape').cloneNode(true));
  // The same controls live in native Settings or on the browser welcome page.
  document.querySelector('#luna .luna-panel')?.append(settings);
  const enabled = settings.querySelector('#clock-enabled');
  const minutes = settings.querySelector('#clock-delay');
  const status = settings.querySelector('#clock-save-status');
  let delay = DEFAULT_CLOCK_DELAY;
  try { delay = clockDelay(window.localStorage.getItem(CLOCK_DELAY_KEY)); } catch { /* Session preference still works. */ }
  enabled.checked = delay > 0;
  minutes.value = delay || DEFAULT_CLOCK_DELAY;
  minutes.disabled = !enabled.checked;
  const time = dialog.querySelector('time');
  const date = dialog.querySelector('.clock-date');
  const controller = createIdleClock({ window, document, delay,
    available: () => !document.querySelector('#welcome').hidden &&
      !(settings.open && settings.closest('#welcome')) && !document.querySelector('dialog[open]:not(#clock-screensaver)') &&
      !document.querySelector('#home-luna[data-command-ready="true"]') &&
      !document.querySelector('#welcome .luna2[data-state="listening"], #welcome .luna2[data-state="thinking"], #welcome .luna2[data-state="talking"], #welcome .luna2[data-state="working"]'),
    show: () => { dialog.showModal(); document.body.classList.add('clock-asleep'); },
    hide: () => { document.body.classList.remove('clock-asleep'); dialog.close(); },
    tick: () => {
      const now = new Date();
      time.dateTime = now.toISOString();
      time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    },
  });
  const save = () => {
    if (enabled.checked && !minutes.reportValidity()) return;
    delay = enabled.checked ? Number(minutes.value) : 0;
    minutes.disabled = !enabled.checked;
    controller.setDelay(delay);
    try {
      window.localStorage.setItem(CLOCK_DELAY_KEY, String(delay));
      status.textContent = 'Saved on this device.';
    } catch { status.textContent = 'Set for this visit. This device could not save the setting.'; }
  };
  enabled.addEventListener('change', () => { minutes.disabled = !enabled.checked; save(); });
  minutes.addEventListener('change', save);
  dialog.addEventListener('cancel', event => { event.preventDefault(); controller.wake(); });
  // Return from a drawer or settings with a fresh idle period.
  document.addEventListener('close', controller.wake, true);
  settings.addEventListener('toggle', controller.wake);
  window.addEventListener('pagehide', () => controller.dispose(), { once: true });
  return controller;
}
