import { notebookRequest } from './notebook-client.js';
import { voicePresentation } from './voice-presentation.js';
import { calculate, expressionFromSpeech } from './calculator.js';
import { drawerIcon, drawerDecorations, displaySticker } from './drawer-art.js';

// One drawer, fed by the existing voice snapshot. Dismissal never changes voice state.
export function createNotebookPopup({ request = notebookRequest, character = 'luna', onCharacter = () => {} } = {}) {
  const page = document.createElement('dialog');
  page.id = 'notebook-popup'; page.className = 'notebook-popup assistant-drawer';
  page.setAttribute('aria-labelledby', 'notebook-popup-title');
  page.innerHTML = `<button type="button" class="notebook-popup-handle" aria-label="Expand drawer" aria-expanded="false" aria-controls="notebook-popup"><span aria-hidden="true"></span></button>
    <button type="button" class="notebook-popup-close" aria-label="Close drawer">×</button>
    <div class="drawer-binding" aria-hidden="true">${'<i></i>'.repeat(14)}</div><div class="drawer-spine" aria-hidden="true"></div>${drawerDecorations()}
    <header class="drawer-header"><span class="drawer-title-moon" aria-hidden="true">${drawerIcon('moon')}</span><p class="notebook-popup-label">A LITTLE SPACE TO THINK</p><h2 id="notebook-popup-title" tabindex="-1">Luna’s Notebook</h2>
      <svg class="drawer-model-label" viewBox="0 0 180 20" aria-hidden="true"><text x="90" y="14" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="600" letter-spacing="2.3" fill="currentColor">GRAPHING CALCULATOR</text></svg><span class="drawer-doodles" aria-hidden="true">${drawerIcon('graph')}</span>
    </header>
    <div class="notebook-popup-scroll">
      <div class="drawer-lcd"><div class="drawer-status-row"><span class="drawer-phase" role="status"></span><svg class="drawer-wave" viewBox="0 0 60 20" aria-hidden="true"><path d="M1 10h7l4-7 6 14 6-14 6 14 6-14 6 14 4-7h13" fill="none" stroke="currentColor" stroke-width="2"/></svg></div>
        <section class="drawer-heard"><h3>I heard: <small class="drawer-transcript-kind"></small></h3><p class="drawer-transcript" aria-live="polite" aria-atomic="true"></p></section>
        <div class="drawer-lcd-trim" aria-hidden="true"><span class="lcd-battery">▥</span>${drawerIcon('graph')}${drawerIcon('flask')}</div>${displaySticker()}
      </div>
      <div class="drawer-notes">
        <section class="drawer-plan"><h3 class="drawer-plan-heading">Plan:</h3><p class="drawer-working"></p></section>
        <section class="drawer-next"><h3><span class="drawer-result-heading">Next:</span> <span class="drawer-sparkles" aria-hidden="true">✧ ✦ ✧</span></h3><p class="drawer-result" role="status"></p></section>
      </div>
      <section class="drawer-calculator" hidden><details class="calculator-entry"><summary>Calculate or graph</summary><form class="calculator-form"><label for="calculator-expression">Expression</label><input id="calculator-expression" maxlength="240" autocomplete="off" spellcheck="false" placeholder="sqrt(9) + 2^3 or sin(x)"><p class="calculator-help">Radians · use * to multiply · graphs: −10 to 10</p><button class="calculator-submit" type="submit">Calculate</button></form></details><p class="calculator-result" role="status"></p><div class="calculator-graph"></div></section>
      <section class="drawer-saved" hidden><h3 class="drawer-list-title"></h3><p class="notebook-popup-status" role="status"></p><ul class="notebook-popup-items"></ul></section>
      <p class="drawer-unavailable" role="status" hidden></p>
      <p class="notebook-popup-caption luna-caption" role="status" hidden></p>
    </div>
    <nav class="drawer-tabs notebook-tabs" aria-label="Notebook destinations">${['lists','vault','calendar','settings'].map(name => `<button type="button" data-destination="${name}"><span aria-hidden="true">${drawerIcon(name)}</span>${name[0].toUpperCase()+name.slice(1)}</button>`).join('')}</nav>
    <nav class="drawer-tabs calculator-tabs" aria-label="Calculator destinations">${[['calculate','calculator','Calculator'],['graph','graph','Graph'],['science','flask','Science'],['notebook','notebook','Notebook'],['settings','settings','Settings']].map(([name,icon,label]) => `<button type="button" data-calculator-tab="${name}" aria-label="${label}"><span aria-hidden="true">${drawerIcon(icon)}</span><span class="drawer-tab-name">${label}</span></button>`).join('')}</nav>
    <div class="calculator-keys" hidden></div>
    <div class="notebook-popup-actions"><button type="button" class="notebook-popup-edit">Open full notebook to edit</button></div>`;
  document.body.append(page);
  const $ = selector => page.querySelector(selector);
  const handle = $('.notebook-popup-handle'), transcript = $('.drawer-transcript'), result = $('.drawer-result');
  let generation = 0, event, wakeEvent, previousPhase, sessionActive = false, dismissed = false, manual = false;
  let dragStart = null, dragged = false, lastVoiceCalculation;
  const text = (selector, value) => { const node = $(selector); if (node.textContent !== value) node.textContent = value; };
  function setCharacter(value) {
    character = value === 'liam' ? 'liam' : 'luna'; page.dataset.character = character;
    text('h2', character === 'liam' ? 'Liam TX-18' : 'Luna’s Notebook');
    text('.notebook-popup-label', character === 'liam' ? 'GRAPHING CALCULATOR' : '');
    text('.drawer-plan-heading', character === 'liam' ? 'Hypothesis:' : 'Plan:');
    text('.drawer-result-heading', character === 'liam' ? 'Next Action:' : 'Next:');
    $('.calculator-keys').hidden = character !== 'liam';
    $('.drawer-calculator').hidden = character !== 'liam';
  }
  function setExpanded(value) { page.dataset.expanded = String(value); handle.setAttribute('aria-expanded', String(value)); handle.setAttribute('aria-label', value ? 'Collapse drawer' : 'Expand drawer'); }
  function close() { manual = false; dismissed = true; generation++; setExpanded(false); if (page.open) page.close(); }
  function open() { if (!page.open && !dismissed) { setExpanded(false); page.showModal(); $('h2').focus({ preventScroll:true }); } }
  $('.notebook-popup-close').addEventListener('click', close);
  page.addEventListener('cancel', e => { e.preventDefault(); close(); });
  page.addEventListener('click', e => { if (e.target !== page) return; const r = page.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); });
  handle.addEventListener('click', () => { if (dragged) { dragged = false; return; } setExpanded(page.dataset.expanded !== 'true'); });
  handle.addEventListener('pointerdown', e => { if (e.isPrimary === false) return; dragStart = e.clientY; dragged = false; handle.setPointerCapture?.(e.pointerId); });
  handle.addEventListener('pointermove', e => { if (dragStart === null) return; const d = e.clientY - dragStart; if (d > 44) { dragged = true; dragStart = null; close(); } else if (d < -44) { dragged = true; dragStart = null; setExpanded(true); } });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(name, () => { dragStart = null; });
  $('.notebook-popup-edit').addEventListener('click', () => { close(); location.hash = '#notebook'; });
  const destinations = { lists: '#notebook', vault: '#vault', settings: '#luna' };
  for (const name of ['lists', 'vault', 'calendar', 'settings']) $(`[data-destination="${name}"]`).addEventListener('click', () => {
    if (name === 'calendar' || (name === 'settings' && !document.querySelector('#luna'))) {
      $('.drawer-unavailable').hidden = false; text('.drawer-unavailable', name === 'calendar' ? 'Calendar is not available in Home yet.' : 'Voice settings are available in the native Home app.'); return;
    }
    close(); location.hash = destinations[name];
  });
  const input = $('#calculator-expression');
  function runCalculator() {
    $('.calculator-entry').open = true;
    $('.calculator-graph').replaceChildren();
    try {
      const output = calculate(input.value);
      text('.calculator-result', output.text); page.dataset.calculation = 'success';
      if (output.segments) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 400 240'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Computed graph: ${output.text}`);
        const path = (d, color) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', '2'); svg.append(p); };
        path('M0 120H400M200 0V240', '#89968e');
        for (const points of output.segments) path(points.map(([x,y], i) => `${i ? 'L' : 'M'}${(x+10)*20},${(10-y)*12}`).join(' '), '#314f65');
        $('.calculator-graph').append(svg);
      }
    } catch (error) { text('.calculator-result', error.message); page.dataset.calculation = 'error'; }
  }
  for (const name of ['calculate', 'graph', 'science', 'notebook', 'settings']) $(`[data-calculator-tab="${name}"]`).addEventListener('click', () => {
    if (name === 'notebook') { close(); location.hash = '#notebook'; return; }
    if (name === 'settings') { $('[data-destination="settings"]').click(); return; }
    $('.calculator-entry').open = true;
    if (name === 'graph' && !input.value) input.value = 'sin(x)';
    if (name === 'science' && !input.value) input.value = 'sqrt(9)';
    input.focus();
  });
  $('.calculator-form').addEventListener('submit', e => { e.preventDefault(); runCalculator(); });
  for (const [label, insert] of [['AC', ''], ['(', '('], [')', ')'], ['x²', '^2'], ['√', 'sqrt('], ['π', 'π'], ['Enter', null]]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.dataset.key = label;
    button.setAttribute('aria-label', { AC: 'Clear calculation', 'x²': 'Square', '√': 'Square root', 'π': 'Pi' }[label] || label);
    button.addEventListener('click', () => {
      if (insert === null) { runCalculator(); return; }
      if (label === 'AC') { input.value = ''; text('.calculator-result', ''); $('.calculator-graph').replaceChildren(); page.dataset.calculation = ''; }
      else { const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start; input.setRangeText(insert, start, end, 'end'); }
      $('.calculator-entry').open = true;
      input.focus();
    });
    $('.calculator-keys').append(button);
  }
  async function loadList(snapshot) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(snapshot.notebookListId || '')) return;
    const current = generation; $('.drawer-saved').hidden = false;
    text('.notebook-popup-status', 'Opening your saved list…'); $('.notebook-popup-items').replaceChildren();
    try {
      const data = await request({ action: 'snapshot' });
      if (current !== generation || !page.open) return;
      if (data.status !== 'read') throw Error();
      const list = data.notebook.lists.find(item => item.id === snapshot.notebookListId);
      if (!list) { text('.notebook-popup-status', 'This list is no longer available.'); return; }
      text('.drawer-list-title', list.name); text('.notebook-popup-status', list.items.length ? 'Saved list · read from your vault' : 'This saved list is empty.');
      for (const item of list.items) {
        const row = document.createElement('li'); row.className = item.completed ? 'is-complete' : '';
        const mark = document.createElement('span'); mark.className = 'notebook-popup-check'; mark.textContent = item.completed ? '✓' : '□'; mark.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.textContent = [item.quantity, item.unit, item.text].filter(v => v !== undefined && v !== '').join(' ');
        if (item.completed) label.setAttribute('aria-label', `${label.textContent}, completed`);
        row.append(mark, label);
        if (item.notes) { const note = document.createElement('small'); note.textContent = item.notes; row.append(note); }
        $('.notebook-popup-items').append(row);
      }
    } catch { if (current === generation && page.open) text('.notebook-popup-status', 'Could not load the saved list. Open Lists to check it.'); }
  }
  setCharacter(character);
  return { element: page, setCharacter, close,
    open() {
      dismissed = false; manual = true;
      if (!sessionActive) { text('.drawer-transcript', 'No speech captured.'); text('.drawer-result', 'No result yet.'); }
      text('.drawer-working', 'Ready for your notes or calculation.');
      text('.drawer-phase', 'Opened manually');
      open();
    },
    async update(snapshot) {
      const view = voicePresentation(snapshot);
      const timerRinging = (snapshot.activeTimers || []).some(timer => Number(timer.remainingSeconds) === 0);
      const blocked = ['disabled', 'unavailable'].includes(view.state) || timerRinging;
      const newWake = snapshot.wakeEvent !== undefined && snapshot.wakeEvent !== wakeEvent;
      const enteredAwake = snapshot.capturePhase === 'awake' && previousPhase !== 'awake';
      const newList = snapshot.notebookEvent !== event && Boolean(snapshot.notebookListId);
      // A wake event survives fast wake+command exchanges between snapshot polls.
      const start = (newWake && Number(snapshot.wakeEvent) > 0) || enteredAwake;
      wakeEvent = snapshot.wakeEvent; previousPhase = snapshot.capturePhase;
      if (blocked) {
        event = snapshot.notebookEvent;
        if (!timerRinging && page.open && (manual || view.state === 'unavailable')) {
          text('.drawer-phase', view.state === 'disabled' ? 'Listening disabled' : 'Voice unavailable');
          text('.drawer-working', view.working);
          if (!manual) text('.drawer-result', snapshot.commandError || 'Voice service unavailable. No outcome has been confirmed.');
          page.dataset.phase = view.state;
        } else { sessionActive = false; close(); }
        return;
      }
      if (manual && !start) return;
      if (start) {
        generation++; dismissed = false; manual = false; sessionActive = true; lastVoiceCalculation = undefined;
        if (snapshot.activeAssistant) { setCharacter(snapshot.activeAssistant); onCharacter(character); }
        $('.drawer-saved').hidden = true; $('.drawer-unavailable').hidden = true;
        input.value = ''; text('.calculator-result', ''); $('.calculator-graph').replaceChildren(); page.dataset.calculation = '';
        transcript.textContent = ''; result.textContent = ''; open();
      }
      // Compatibility with an older service that only publishes a saved-list event.
      if (newList && !sessionActive && !dismissed) { sessionActive = true; open(); }
      if (!sessionActive) { event = snapshot.notebookEvent; return; }
      page.dataset.phase = view.state;
      text('.drawer-phase', { wake: 'Wake detected', capturing: 'Capturing speech', processing: 'Processing', responding: 'Responding', retry: 'Please try again', idle: 'Listening enabled · idle' }[view.state] || view.state);
      const heard = typeof snapshot.lastHeard === 'string' ? snapshot.lastHeard : '';
      const kind = snapshot.transcriptFinal === false ? 'Tentative' : snapshot.transcriptFinal === true ? 'Final' : 'Recognized';
      text('.drawer-transcript', heard || 'Waiting for recognized speech…'); text('.drawer-transcript-kind', heard ? kind : '');
      text('.drawer-working', character === 'liam' && view.state === 'wake' ? 'You called my name.' : view.working); text('.drawer-result', view.result || 'No result yet.');
      page.dataset.success = String(Boolean(view.result) && ['checkmark', 'new-page', 'scribble'].includes(snapshot.notebookAnimation));
      if (character === 'liam' && snapshot.transcriptFinal === true && heard !== lastVoiceCalculation) {
        lastVoiceCalculation = heard;
        const expression = expressionFromSpeech(heard);
        if (expression !== null) { input.value = expression; runCalculator(); }
      }
      const changed = snapshot.notebookEvent !== event; event = snapshot.notebookEvent;
      if (changed && page.open) await loadList(snapshot);
    },
  };
}
