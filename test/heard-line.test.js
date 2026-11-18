import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeardLine } from '../src/heard-line.js';

const ready = extra => ({ status: 'ready', wakeEvent: 1, lastHeard: 'Start a shopping list.', replyPlaying: false, ...extra });

test('what was heard stays through the exchange and clears ten seconds after Luna is waiting again', () => {
  const line = createHeardLine();
  const shown = 'Heard: “Start a shopping list.”';
  assert.equal(line(ready(), 'review', 1000), shown);
  assert.equal(line(ready({ replyPlaying: true }), 'response', 5000), shown);
  assert.equal(line(ready({ replyPlaying: true }), 'waiting', 60000), shown, 'never cleared while she is still speaking');
  assert.equal(line(ready(), 'waiting', 61000), shown);
  assert.equal(line(ready(), 'waiting', 70999), shown);
  assert.equal(line(ready(), 'waiting', 71000), '');
  assert.equal(line(ready(), 'waiting', 500000), '', 'and stays cleared');
});

test('a new exchange shows again, even with the same words', () => {
  const line = createHeardLine();
  line(ready(), 'waiting', 0);
  assert.equal(line(ready(), 'waiting', 20000), '');
  assert.equal(line(ready({ wakeEvent: 2 }), 'waiting', 21000), 'Heard: “Start a shopping list.”');
  assert.equal(line(ready({ wakeEvent: 2, lastHeard: 'Add milk' }), 'awake', 90000), 'Heard: “Add milk”');
});

test('nothing is shown when listening is off, Home is not ready or nothing was heard', () => {
  const line = createHeardLine();
  assert.equal(line(ready(), 'off', 0), '');
  assert.equal(line(ready({ status: 'unavailable' }), 'waiting', 0), '');
  assert.equal(line(ready({ lastHeard: '' }), 'waiting', 0), '');
});
