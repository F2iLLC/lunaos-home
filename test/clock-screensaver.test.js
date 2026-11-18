import test from 'node:test';
import assert from 'node:assert/strict';
import { clockDelay, createIdleClock, DEFAULT_CLOCK_DELAY, CLOCK_DELAY_KEY, mountClockScreensaver } from '../src/clock-screensaver.js';

function harness(delay = 1) {
  const window = new EventTarget(), document = new EventTarget();
  document.hidden = false;
  let now = 0, nextId = 0, visible = false, ticks = 0, allowed = true;
  const timers = new Map();
  const controller = createIdleClock({ window, document, delay,
    show: () => { visible = true; }, hide: () => { visible = false; },
    tick: () => { ticks++; }, available: () => allowed,
    setTimer(callback, ms) { const id = ++nextId; timers.set(id, { callback, at: now + ms }); return id; },
    clearTimer: id => timers.delete(id),
  });
  return { window, document, controller, timers,
    get visible() { return visible; }, get ticks() { return ticks; },
    set allowed(value) { allowed = value; },
    activity(type) { const event = new Event(type, { cancelable: true }); window.dispatchEvent(event); return event; },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry || entry[1].at > end) break;
        const [id, timer] = entry; timers.delete(id); now = timer.at; timer.callback();
      }
      now = end;
    },
  };
}

test('clock waits for a full idle period, updates while visible and consumes the waking tap', () => {
  const h = harness();
  h.advance(59_999); assert.equal(h.visible, false);
  h.activity('pointermove'); h.advance(59_999); assert.equal(h.visible, false);
  h.advance(1); assert.equal(h.visible, true); assert.equal(h.ticks, 1);
  h.advance(2_000); assert.equal(h.ticks, 3);
  assert.equal(h.activity('pointerdown').defaultPrevented, true);
  assert.equal(h.visible, false);
  assert.equal(h.activity('click').defaultPrevented, true, 'the waking tap cannot click through');
  h.advance(60_000); assert.equal(h.visible, true);
  assert.equal(h.activity('keydown').defaultPrevented, true);
  assert.equal(h.visible, false);
  h.controller.dispose(); assert.equal(h.timers.size, 0);
});

test('delay changes restart waiting; turning off cancels the clock and all timers', () => {
  const h = harness();
  h.advance(30_000); h.controller.setDelay(2);
  h.advance(119_999); assert.equal(h.visible, false);
  h.advance(1); assert.equal(h.visible, true);
  h.controller.setDelay(0); assert.equal(h.visible, false);
  assert.equal(h.timers.size, 0);
  h.advance(1_000_000); assert.equal(h.visible, false);
  h.controller.setDelay(1); h.advance(60_000); assert.equal(h.visible, true);
  h.controller.dispose(); h.activity('keydown'); assert.equal(h.timers.size, 0);
});

test('hidden tabs pause inactivity and returning starts a fresh wait', () => {
  const h = harness();
  h.advance(60_000); assert.equal(h.visible, true);
  h.document.hidden = true; h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.visible, false); assert.equal(h.timers.size, 0);
  h.advance(600_000);
  h.document.hidden = false; h.document.dispatchEvent(new Event('visibilitychange'));
  h.advance(59_999); assert.equal(h.visible, false);
  h.advance(1); assert.equal(h.visible, true);
  h.activity('hashchange'); assert.equal(h.visible, false);
  h.controller.dispose();
});

test('open drawers, other pages and voice activity block entry and wake a visible clock', () => {
  const h = harness();
  h.allowed = false; h.advance(60_000); assert.equal(h.visible, false);
  h.allowed = true; h.advance(60_000); assert.equal(h.visible, true);
  h.allowed = false; h.advance(1_000); assert.equal(h.visible, false);
  h.controller.dispose();
});

test('saved clock delay accepts off and bounded minutes, with safe defaults for invalid storage', () => {
  for (const value of [null, '', undefined, 'garbage', '-1', '121', '0.5', 'Infinity']) {
    assert.equal(clockDelay(value), DEFAULT_CLOCK_DELAY, String(value));
  }
  for (const value of ['0', '1', '120']) assert.equal(clockDelay(value), Number(value));
});

test('settings restore and save the device preference, validate input and tolerate unavailable storage', () => {
  const saved = new Map([[CLOCK_DELAY_KEY, '12']]);
  const mount = (blocked = false) => {
    const window = new EventTarget(), document = new EventTarget();
    window.localStorage = {
      getItem(key) { if (blocked) throw Error('Unavailable'); return saved.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw Error('Unavailable'); saved.set(key, value); },
    };
    const enabled = new EventTarget(), minutes = new EventTarget(), settings = new EventTarget();
    const status = {}, welcome = { hidden: false };
    minutes.reportValidity = () => Number.isInteger(Number(minutes.value)) && Number(minutes.value) >= 1 && Number(minutes.value) <= 120;
    settings.querySelector = selector => ({ '#clock-enabled': enabled, '#clock-delay': minutes, '#clock-save-status': status })[selector];
    settings.closest = () => welcome;
    const dialog = new EventTarget();
    dialog.prepend = () => {};
    dialog.querySelector = () => ({});
    let moved;
    document.querySelector = selector => ({ '#clock-settings': settings, '#clock-screensaver': dialog,
      '#luna .luna-panel': { append(node) { moved = node; } },
      '.landscape': { cloneNode: () => ({}) }, '#welcome': welcome })[selector] ?? null;
    const controller = mountClockScreensaver({ window, document });
    assert.equal(moved, settings, 'native settings receive the same controls');
    return { enabled, minutes, status, controller };
  };
  const h = mount();
  assert.equal(h.minutes.value, 12); assert.equal(h.enabled.checked, true);
  h.minutes.value = '0'; h.minutes.dispatchEvent(new Event('change'));
  assert.equal(saved.get(CLOCK_DELAY_KEY), '12', 'invalid delay is not saved');
  h.minutes.value = '3'; h.minutes.dispatchEvent(new Event('change'));
  assert.equal(saved.get(CLOCK_DELAY_KEY), '3');
  assert.equal(h.status.textContent, 'Saved on this device.');
  h.enabled.checked = false; h.enabled.dispatchEvent(new Event('change'));
  assert.equal(saved.get(CLOCK_DELAY_KEY), '0'); assert.equal(h.minutes.disabled, true);
  h.controller.dispose();
  const reloaded = mount();
  assert.equal(reloaded.enabled.checked, false); reloaded.controller.dispose();
  const blocked = mount(true);
  assert.equal(blocked.minutes.value, DEFAULT_CLOCK_DELAY);
  blocked.minutes.value = '7'; blocked.minutes.dispatchEvent(new Event('change'));
  assert.match(blocked.status.textContent, /Set for this visit/);
  blocked.controller.dispose();
});

test('the waking tap never reaches a control behind the clock', () => {
  const h = harness();
  const reached = [];
  for (const type of ['pointerdown', 'pointerup', 'click']) h.window.addEventListener(type, () => reached.push(type));
  h.advance(60_000); assert.equal(h.visible, true);
  for (const type of ['pointerdown', 'pointerup', 'click']) h.activity(type);
  assert.deepEqual(reached, [], 'the waking pointer sequence stops at the clock');
  assert.equal(h.visible, false);
  h.controller.dispose();
});

test('mounted clock is blocked by other pages, open settings on Home, drawers and voice activity', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const voice = '#welcome .luna2[data-state="listening"], #welcome .luna2[data-state="thinking"], #welcome .luna2[data-state="talking"], #welcome .luna2[data-state="working"]';
  const mount = ({ native = false } = {}) => {
    const window = new EventTarget(), document = new EventTarget();
    document.hidden = false; document.body = { classList: { add() {}, remove() {} } };
    window.localStorage = { getItem: () => '1', setItem() {} };
    const page = { welcome: { hidden: false }, drawer: null, commandReady: null, voice: null };
    const settings = new EventTarget();
    settings.open = false;
    settings.querySelector = () => new EventTarget();
    settings.closest = selector => (selector === '#welcome' && !native ? page.welcome : null);
    const dialog = new EventTarget();
    Object.assign(dialog, { shown: false, prepend() {}, querySelector: () => ({}),
      showModal() { this.shown = true; }, close() { this.shown = false; } });
    document.querySelector = selector => ({ '#clock-settings': settings, '#clock-screensaver': dialog,
      '#luna .luna-panel': native ? { append() {} } : null, '.landscape': { cloneNode: () => ({}) },
      '#welcome': page.welcome, 'dialog[open]:not(#clock-screensaver)': page.drawer,
      '#home-luna[data-command-ready="true"]': page.commandReady, [voice]: page.voice })[selector] ?? null;
    const controller = mountClockScreensaver({ window, document });
    const idle = () => { controller.wake(); t.mock.timers.tick(60_000); return dialog.shown; };
    return { page, settings, dialog, controller, idle };
  };
  const browser = mount();
  assert.equal(browser.idle(), true, 'idle Home shows the clock');
  for (const [name, block, clear] of [
    ['another page', p => { p.page.welcome.hidden = true; }, p => { p.page.welcome.hidden = false; }],
    ['open settings on Home', p => { p.settings.open = true; }, p => { p.settings.open = false; }],
    ['an open drawer', p => { p.page.drawer = {}; }, p => { p.page.drawer = null; }],
    ['a ready command window', p => { p.page.commandReady = {}; }, p => { p.page.commandReady = null; }],
    ['voice activity', p => { p.page.voice = {}; }, p => { p.page.voice = null; }],
  ]) {
    block(browser);
    assert.equal(browser.idle(), false, `${name} blocks the clock`);
    clear(browser);
    assert.equal(browser.idle(), true, `the clock returns after ${name}`);
    block(browser); t.mock.timers.tick(1_000);
    assert.equal(browser.dialog.shown, false, `${name} wakes a visible clock`);
    clear(browser);
  }
  browser.controller.dispose();
  // Native Settings is its own page: its controls are visible only while Home is hidden.
  const native = mount({ native: true });
  native.settings.open = true; native.page.welcome.hidden = true;
  assert.equal(native.idle(), false, 'open native settings cannot be covered');
  native.page.welcome.hidden = false;
  assert.equal(native.idle(), true, 'a section left open in Settings does not disable the clock on Home');
  native.controller.dispose();
});
