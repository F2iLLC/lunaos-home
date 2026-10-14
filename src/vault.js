import { requestDraft, canRequestAssistantReview } from './draft-client.js';

let draft = null;
let personId;
let fieldId;
let busy = false;
const $ = selector => document.querySelector(selector);
const labels = { proposed: 'Please check', 'needs-review': 'Needs review', confirmed: 'Looks right', skipped: 'Skipped', accepted: 'Yes, later', declined: 'Not now' };
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, action, className = 'quiet-button') {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
async function request(path, input) {
  if (busy) return;
  const hadEditorFocus = $('#draft-content').contains(document.activeElement);
  busy = true;
  const controls = [...$('#vault').querySelectorAll('button, input')].map(node => ({ node, disabled: node.disabled }));
  for (const { node } of controls) node.disabled = true;
  $('#vault-error').textContent = '';
  $('#vault').setAttribute('aria-busy', 'true');
  try {
    const data = await requestDraft(path, input);
    const changed = data.draft?.id !== draft?.id || data.draft?.revision !== draft?.revision;
    draft = data.draft;
    if (changed || !draft) {
      render();
      if (hadEditorFocus && draft) $('#field-title').focus();
    }
    const checked = draft?.people.flatMap(person => person.fields).filter(field => field.status === 'confirmed').length;
    $('#draft-status').textContent = draft ? `${checked} ${checked === 1 ? 'detail' : 'details'} checked · Draft only` : 'Ready for a fictional draft';
  } catch (error) {
    $('#vault-error').textContent = ['TypeError', 'TimeoutError'].includes(error.name)
      ? 'The local preview is unavailable. A change may not have arrived. Reconnect and check for updates before trying again.' : error.message;
    $('#draft-status').textContent = 'Update not confirmed';
  } finally {
    busy = false;
    for (const { node, disabled } of controls) if (node.isConnected) node.disabled = disabled;
    $('#vault').removeAttribute('aria-busy');
  }
}
export const refreshDraft = () => request('/api/draft');
function review(person, item, action, revision, value) {
  return request('/api/review', { draftId: draft.id, personId: person.id, itemId: item.id, revision, action, ...(value === undefined ? {} : { value }) });
}
function render() {
  $('#draft-empty').hidden = Boolean(draft);
  $('#draft-content').hidden = !draft;
  $('#discard-confirmation').hidden = true;
  if (!draft) return;
  const person = draft.people.find(item => item.id === personId) || draft.people[0];
  personId = person.id;
  const field = person.fields.find(item => item.id === fieldId) || person.fields[0];
  fieldId = field.id;
  const revision = draft.revision;
  $('#family-members').replaceChildren(...draft.people.map(member => {
    const node = button(member.name, () => { personId = member.id; fieldId = null; render(); $('#person-heading').focus(); }, 'member-button');
    node.setAttribute('aria-pressed', String(member.id === personId));
    return node;
  }));
  $('#person-heading').textContent = person.name;
  $('#person-heading').tabIndex = -1;
  $('#draft-fields').replaceChildren(...person.fields.map(item => {
    const node = button('', () => { fieldId = item.id; render(); $('#field-title').focus(); }, 'field-choice');
    node.setAttribute('aria-pressed', String(item.id === fieldId));
    node.append(element('span', item.label, 'field-label'), element('strong', item.value), element('span', labels[item.status], `status-tag ${item.status}`));
    return node;
  }));
  const editor = $('#field-editor');
  editor.replaceChildren();
  const heading = element('h2', field.label); heading.id = 'field-title'; heading.tabIndex = -1;
  editor.append(heading, element('p', field.value, 'field-value'), element('p', field.source, 'section-help'), element('p', labels[field.status], 'status-tag'));
  const actions = element('div', undefined, 'review-actions');
  const confirm = button('Looks right', () => review(person, field, 'confirm', revision));
  confirm.disabled = field.status === 'needs-review';
  actions.append(confirm, button('Needs review', () => review(person, field, 'flag', revision)), button('Skip this detail', () => review(person, field, 'skip', revision)));
  editor.append(actions);
  if (field.status === 'needs-review' && !canRequestAssistantReview()) {
    editor.append(element('p', 'An assistant is not connected to this app preview. You can change this detail yourself below.', 'section-help'));
  }
  if (field.status === 'needs-review' && canRequestAssistantReview()) {
    editor.append(element('p', field.question, 'review-question'));
    const reply = element('form');
    const label = element('label', 'Tell your assistant what needs changing'); label.htmlFor = 'review-reply';
    const input = element('input'); input.id = 'review-reply'; input.type = 'text'; input.maxLength = 240; input.required = true; input.autocomplete = 'off'; input.value = field.reply;
    const submit = element('button', 'Leave reply for assistant', 'quiet-button'); submit.type = 'submit';
    reply.append(label, input, submit);
    reply.addEventListener('submit', event => { event.preventDefault(); review(person, field, 'reply', revision, input.value); });
    editor.append(reply, element('p', field.reply ? 'Reply ready. Your connected assistant can check it and propose a correction.' : 'Your assistant can pick up this reply when it checks the draft. You can also edit the detail yourself.', 'section-help'));
  }
  const edit = element('form', undefined, 'manual-edit');
  const editLabel = element('label', 'Or change it yourself'); editLabel.htmlFor = 'field-value';
  const input = element('input'); input.id = 'field-value'; input.type = 'text'; input.required = true; input.maxLength = 240; input.autocomplete = 'off'; input.value = field.value;
  const submit = element('button', 'Update draft', 'quiet-button'); submit.type = 'submit';
  edit.append(editLabel, input, submit);
  edit.addEventListener('submit', event => { event.preventDefault(); review(person, field, 'edit', revision, input.value); });
  editor.append(edit);
  $('#draft-suggestions').replaceChildren(...person.suggestions.map(item => {
    const card = element('div', undefined, 'suggestion');
    const controls = element('div', undefined, 'review-actions');
    controls.append(button('Yes, later', () => review(person, item, 'accept', revision)), button('Not now', () => review(person, item, 'decline', revision)));
    card.append(element('h3', item.title), element('p', item.reason), element('p', labels[item.status], 'status-tag'), controls);
    return card;
  }));
  if (!person.suggestions.length) $('#draft-suggestions').append(element('p', 'No suggestions for this person yet.', 'section-help'));
}
$('#refresh-draft').addEventListener('click', refreshDraft);
$('#example-draft').addEventListener('click', () => request('/api/example', {}));
$('#discard-draft').addEventListener('click', () => { $('#discard-confirmation').hidden = false; $('#confirm-discard').focus(); });
$('#cancel-discard').addEventListener('click', () => { $('#discard-confirmation').hidden = true; $('#discard-draft').focus(); });
$('#confirm-discard').addEventListener('click', async () => {
  if (!draft) return;
  await request('/api/discard', { draftId: draft.id, revision: draft.revision });
  if (!draft) $('#example-draft').focus();
});
// Explicit refresh and returning to this tab pick up assistant changes without polling
// over the user's in-progress typing or resetting keyboard focus.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('#vault').hidden && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) refreshDraft();
});
