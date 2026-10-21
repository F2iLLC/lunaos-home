import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyEventLifecycle } from '../lib/google-calendar-probe-run.js';

const event = { summary: 'Fictional Home probe event' };
const edited = 'Fictional Home probe event (edited)';

function setup(overrides = {}) {
  const actions = [];
  let current = event.summary;
  const write = {
    async createEvent(_calendar, _event, id) {
      actions.push(`create:${id}`);
      return { eventId: id };
    },
    async findEvent() {
      actions.push('find');
      return current === null ? null : { summary: current };
    },
    async updateEvent(_calendar, _id, patch) {
      actions.push('update');
      current = patch.summary;
      return { summary: current };
    },
    async deleteEvent() {
      actions.push('delete');
      current = null;
    },
    ...overrides,
  };
  const check = async (_name, run) => run();
  const expectCode = async (_code, _reason, run) => {
    try { await run(); } catch (error) {
      if (error.code === 'HTTP_409') return 'duplicate';
      throw error;
    }
    throw new Error('Expected duplicate rejection');
  };
  return { actions, write, check, expectCode, run: () => verifyEventLifecycle({ write, calendar: 'test-calendar', event, id: 'abc12', check, expectCode }) };
}

test('complete lifecycle confirms update and removes the synthetic event', async () => {
  const fixture = setup();
  let creates = 0;
  fixture.write.createEvent = async (_calendar, _event, id) => {
    fixture.actions.push(`create:${id}`);
    if (++creates > 1) throw Object.assign(new Error('duplicate'), { code: 'HTTP_409' });
    return { eventId: id };
  };
  await fixture.run();
  assert.equal(fixture.actions.filter(action => action === 'delete').length, 1);
  assert.equal(fixture.actions.filter(action => action === 'find').length, 3);
});

test('confirmed create is cleaned up when a later read fails', async () => {
  let reads = 0;
  const fixture = setup({
    async findEvent() {
      fixture.actions.push('find');
      if (++reads === 1) throw new Error('read failed');
      return null;
    },
  });
  await assert.rejects(fixture.run(), /read failed/);
  assert.deepEqual(fixture.actions, ['create:abc12', 'find', 'delete', 'find']);
});

test('update response and provider read must both show the edited summary', async () => {
  for (const mismatch of ['response', 'readback']) {
    let reads = 0;
    const fixture = setup({
      async createEvent(_calendar, _event, id) { fixture.actions.push(`create:${id}`); return { eventId: id }; },
      async findEvent() {
        fixture.actions.push('find');
        reads += 1;
        return reads === 1 ? { summary: event.summary } : reads === 2 && mismatch === 'readback' ? { summary: event.summary } : null;
      },
      async updateEvent() {
        fixture.actions.push('update');
        return { summary: mismatch === 'response' ? event.summary : edited };
      },
      async deleteEvent() { fixture.actions.push('delete'); },
    });
    fixture.write.createEvent = async (_calendar, _event, id) => {
      fixture.actions.push(`create:${id}`);
      if (fixture.actions.filter(action => action.startsWith('create:')).length > 1) throw Object.assign(new Error('duplicate'), { code: 'HTTP_409' });
      return { eventId: id };
    };
    await assert.rejects(fixture.run(), /edited summary|not observed/);
    assert.equal(fixture.actions.filter(action => action === 'delete').length, 1);
  }
});

test('unknown update outcome stops before cleanup or further mutation', async () => {
  const fixture = setup({
    async updateEvent() {
      fixture.actions.push('update');
      throw Object.assign(new Error('unknown'), { code: 'UNKNOWN_OUTCOME', mutationOutcome: 'unknown' });
    },
  });
  let creates = 0;
  fixture.write.createEvent = async (_calendar, _event, id) => {
    fixture.actions.push(`create:${id}`);
    if (++creates > 1) throw Object.assign(new Error('duplicate'), { code: 'HTTP_409' });
    return { eventId: id };
  };
  await assert.rejects(fixture.run(), { code: 'UNKNOWN_OUTCOME' });
  assert.equal(fixture.actions.includes('delete'), false);
});

test('unknown duplicate-check outcome retains the event for reconciliation', async () => {
  const fixture = setup();
  let creates = 0;
  fixture.write.createEvent = async (_calendar, _event, id) => {
    fixture.actions.push(`create:${id}`);
    if (++creates > 1) throw Object.assign(new Error('unknown'), { code: 'UNKNOWN_OUTCOME', mutationOutcome: 'unknown' });
    return { eventId: id };
  };
  await assert.rejects(fixture.run(), { code: 'UNKNOWN_OUTCOME' });
  assert.equal(fixture.actions.includes('delete'), false);
});

test('failed cleanup reports both the original failure and unresolved event', async () => {
  const fixture = setup({
    async findEvent() { throw new Error('read failed'); },
    async deleteEvent() { throw new Error('cleanup failed'); },
  });
  await assert.rejects(fixture.run(), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /cleanup was not confirmed/);
    assert.deepEqual(error.errors.map(cause => cause.message), ['read failed', 'cleanup failed']);
    return true;
  });
});
