// Run the synthetic event lifecycle. An ambiguous mutation must be reconciled
// by a human before this probe makes another change to that event.
export async function verifyEventLifecycle({ write, calendar, event, id, check, expectCode }) {
  const editedSummary = 'Fictional Home probe event (edited)';
  let created = false;
  let deleted = false;
  let unresolved = false;
  const mutation = async run => {
    try { return await run(); }
    catch (error) {
      if (error.mutationOutcome === 'unknown') unresolved = true;
      throw error;
    }
  };

  try {
    await check('create (no attendees, sendUpdates=none)', () => mutation(async () => {
      const result = await write.createEvent(calendar, event, id);
      created = true;
      return result.eventId;
    }));
    await check('read back created event', async () => {
      const found = await write.findEvent(calendar, id);
      if (found?.summary !== event.summary) throw new Error('Created event was not observed');
      return found.summary;
    });
    await check('retry with same id creates no duplicate', () => expectCode('HTTP_409', 'duplicate', () => mutation(() => write.createEvent(calendar, event, id))));
    await check('update', async () => {
      const updated = await mutation(() => write.updateEvent(calendar, id, { summary: editedSummary }));
      if (updated?.summary !== editedSummary) throw new Error('Update response did not contain the edited summary');
      const found = await write.findEvent(calendar, id);
      if (found?.summary !== editedSummary) throw new Error('Updated event was not observed');
      return found.summary;
    });
    await check('unapproved calendar rejects write', () => expectCode('CALENDAR_NOT_APPROVED', null, () => write.createEvent('primary-not-approved', event)));
    await check('attendees refused', () => expectCode('ATTENDEES_NOT_ALLOWED', null, () => write.createEvent(calendar, { ...event, attendees: [{ email: 'x@example.test' }] })));
    await check('delete', () => mutation(async () => {
      const result = await write.deleteEvent(calendar, id);
      deleted = true;
      return result;
    }));
    await check('deleted event is gone or cancelled', async () => {
      const found = await write.findEvent(calendar, id);
      if (found && found.status !== 'cancelled') throw new Error(`still ${found.status}`);
      return found ? 'cancelled' : 'absent';
    });
  } catch (error) {
    if (created && !deleted && !unresolved) {
      try {
        await write.deleteEvent(calendar, id);
        const remaining = await write.findEvent(calendar, id);
        if (remaining && remaining.status !== 'cancelled') throw new Error('Synthetic event remained after cleanup');
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Synthetic event cleanup was not confirmed');
      }
    }
    throw error;
  }
}
