export const WAKE_STATES = Object.freeze([
  'disabled', 'waiting-for-wake', 'listening-to-command', 'processing', 'speaking', 'muted', 'unavailable',
]);

// Proposed pre-wake RAM buffer ceiling for review, not a measured device result
// or an approved runtime setting.
export const MAX_PREWAKE_BUFFER_MS = 2_000;

export function createWakeSnapshot() {
  return Object.freeze({
    state: 'disabled', generation: 0, recentWakeEventIds: Object.freeze([]), localListeningOptIn: false,
    microphonePermission: false, securityLocked: false, unavailableReason: null,
    requestedFields: Object.freeze([]), destination: null, contentForwarded: false,
  });
}

const ignored = snapshot => Object.freeze({ snapshot, effects: Object.freeze([]), accepted: false });
function changed(snapshot, effects = []) {
  return Object.freeze({ snapshot: Object.freeze(snapshot), effects: Object.freeze(effects.map(effect => Object.freeze(effect))), accepted: true });
}
const stopEffects = snapshot => [
  { type: 'STOP_MICROPHONE' },
  { type: 'CLEAR_TRANSIENT_AUDIO' },
  ...(snapshot.state === 'processing' && snapshot.contentForwarded
    ? [{ type: 'CANCEL_REMOTE_WORK' }, { type: 'EXPLAIN_CONTENT_MAY_ALREADY_BE_SENT' }] : []),
];
const canWait = snapshot => snapshot.localListeningOptIn && snapshot.microphonePermission &&
  !snapshot.securityLocked && snapshot.unavailableReason !== 'host';
function returnToWaiting(snapshot, extra = []) {
  const generation = snapshot.generation + 1;
  if (canWait(snapshot)) return changed({ ...snapshot, state: 'waiting-for-wake', generation,
    unavailableReason: null, requestedFields: Object.freeze([]), destination: null, contentForwarded: false }, [
    { type: 'STOP_MICROPHONE' }, { type: 'CLEAR_TRANSIENT_AUDIO' }, ...extra,
    { type: 'START_LOCAL_DETECTOR', maxBufferMs: MAX_PREWAKE_BUFFER_MS },
  ]);
  const state = snapshot.unavailableReason === 'host' || (snapshot.localListeningOptIn && !snapshot.microphonePermission)
    ? 'unavailable' : snapshot.localListeningOptIn ? 'muted' : 'disabled';
  return changed({ ...snapshot, state, generation,
    requestedFields: Object.freeze([]), destination: null, contentForwarded: false }, [
    ...stopEffects(snapshot), ...extra,
  ]);
}

export function wakeDataPathPolicy(snapshot) {
  const microphone = snapshot.state === 'waiting-for-wake' ? 'local-wake-detection'
    : snapshot.state === 'listening-to-command' ? 'local-command-capture' : 'off';
  return Object.freeze({
    microphone,
    network: snapshot.contentForwarded ? 'approved-selected-fields-only' : 'none',
    destination: snapshot.contentForwarded ? snapshot.destination : null,
    preWakeBufferMaxMs: snapshot.state === 'waiting-for-wake' ? MAX_PREWAKE_BUFFER_MS : 0,
    persistentAudio: false,
    telemetry: false,
  });
}

// Pure transition policy for synthetic fixtures. Effects describe what a
// future authorized adapter may do; this module opens no device or connection.
export function reduceWakeState(snapshot, event) {
  if (!snapshot || !WAKE_STATES.includes(snapshot.state) || !event || typeof event.type !== 'string') return ignored(snapshot);

  switch (event.type) {
    case 'MICROPHONE_PERMISSION_GRANTED':
      if (snapshot.microphonePermission) return ignored(snapshot);
      return changed({ ...snapshot, microphonePermission: true,
        state: snapshot.state === 'unavailable' && snapshot.unavailableReason === 'microphone-permission' ? 'muted' : snapshot.state,
        unavailableReason: snapshot.unavailableReason === 'microphone-permission' ? null : snapshot.unavailableReason });

    case 'LOCAL_LISTEN_CONSENT_GRANTED':
      if (snapshot.localListeningOptIn) return ignored(snapshot);
      {
        const available = snapshot.microphonePermission && !snapshot.securityLocked && snapshot.unavailableReason !== 'host';
        const reason = snapshot.unavailableReason === 'host' ? 'host' : snapshot.microphonePermission ? null : 'microphone-permission';
        return changed({ ...snapshot, localListeningOptIn: true,
          state: available ? 'waiting-for-wake' : snapshot.securityLocked && snapshot.microphonePermission ? 'muted' : 'unavailable',
          unavailableReason: reason }, available
          ? [{ type: 'START_LOCAL_DETECTOR', maxBufferMs: MAX_PREWAKE_BUFFER_MS }]
          : reason === 'host' ? [{ type: 'SHOW_HOST_UNAVAILABLE' }]
            : reason === 'microphone-permission' ? [{ type: 'SHOW_MICROPHONE_UNAVAILABLE' }] : []);
      }

    case 'START_LOCAL_WAITING':
      if (!canWait(snapshot) || !['muted', 'unavailable', 'disabled'].includes(snapshot.state)) return ignored(snapshot);
      return changed({ ...snapshot, state: 'waiting-for-wake',
        unavailableReason: null, requestedFields: Object.freeze([]), destination: null, contentForwarded: false }, [
        { type: 'START_LOCAL_DETECTOR', maxBufferMs: MAX_PREWAKE_BUFFER_MS },
      ]);

    case 'LOCAL_LISTEN_CONSENT_REVOKED':
      if (!snapshot.localListeningOptIn && snapshot.state === 'disabled') return ignored(snapshot);
      return changed({ ...snapshot, state: 'disabled', localListeningOptIn: false, generation: snapshot.generation + 1,
        unavailableReason: null, requestedFields: Object.freeze([]), destination: null, contentForwarded: false }, stopEffects(snapshot));

    case 'MICROPHONE_PERMISSION_REVOKED':
      return changed({ ...snapshot, state: 'unavailable', microphonePermission: false, unavailableReason: 'microphone-permission', generation: snapshot.generation + 1,
        requestedFields: Object.freeze([]), destination: null, contentForwarded: false }, [
        ...stopEffects(snapshot), { type: 'SHOW_MICROPHONE_UNAVAILABLE' },
      ]);

    case 'WAKE_DETECTED':
      if (snapshot.state !== 'waiting-for-wake' || !canWait(snapshot) || typeof event.eventId !== 'string' ||
        !/^[a-zA-Z0-9._:-]{1,100}$/.test(event.eventId) || snapshot.recentWakeEventIds.includes(event.eventId)) return ignored(snapshot);
      return changed({ ...snapshot, state: 'listening-to-command', generation: snapshot.generation + 1,
        recentWakeEventIds: Object.freeze([...snapshot.recentWakeEventIds, event.eventId].slice(-64)),
        requestedFields: Object.freeze([]), destination: null, contentForwarded: false }, [
        { type: 'STOP_LOCAL_DETECTOR' }, { type: 'START_COMMAND_CAPTURE', generation: snapshot.generation + 1 },
      ]);

    case 'COMMAND_CAPTURED': {
      if (snapshot.state !== 'listening-to-command' || event.generation !== snapshot.generation ||
        !Array.isArray(event.fields) || event.fields.length < 1 || event.fields.length > 16 ||
        event.fields.some(field => typeof field !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(field)) ||
        new Set(event.fields).size !== event.fields.length) return ignored(snapshot);
      const fields = Object.freeze([...event.fields]);
      return changed({ ...snapshot, state: 'processing', requestedFields: fields,
        destination: null, contentForwarded: false }, [
        { type: 'STOP_MICROPHONE' }, { type: 'CLEAR_TRANSIENT_AUDIO' },
        { type: 'PROMPT_FOR_POST_WAKE_DISCLOSURE', fields },
      ]);
    }

    case 'POST_WAKE_DISCLOSURE_APPROVED':
      if (snapshot.state !== 'processing' || snapshot.contentForwarded || typeof event.destination !== 'string' ||
        !/^[a-zA-Z0-9._:-]{1,100}$/.test(event.destination) || !Array.isArray(event.fields) ||
        event.fields.length !== snapshot.requestedFields.length ||
        event.fields.some(field => !snapshot.requestedFields.includes(field)) ||
        new Set(event.fields).size !== event.fields.length) return ignored(snapshot);
      return changed({ ...snapshot, destination: event.destination, contentForwarded: true }, [
        { type: 'FORWARD_SELECTED_CONTENT', destination: event.destination,
          purpose: 'respond-to-this-command', fields: Object.freeze([...event.fields]), generation: snapshot.generation },
      ]);

    case 'RESPONSE_READY':
      if (snapshot.state !== 'processing' || !snapshot.contentForwarded || event.generation !== snapshot.generation) return ignored(snapshot);
      return changed({ ...snapshot, state: 'speaking' }, [{ type: 'PRESENT_RESPONSE' }]);

    case 'SILENCE_TIMEOUT':
      if (snapshot.state !== 'listening-to-command' || event.generation !== snapshot.generation) return ignored(snapshot);
      return returnToWaiting(snapshot);

    case 'SPEAKING_FINISHED':
      if (snapshot.state !== 'speaking' || event.generation !== snapshot.generation) return ignored(snapshot);
      return returnToWaiting(snapshot);

    case 'CANCEL':
      if (snapshot.state === 'disabled' || snapshot.state === 'muted' || snapshot.state === 'unavailable') return ignored(snapshot);
      return returnToWaiting(snapshot, snapshot.state === 'processing' && snapshot.contentForwarded
        ? [{ type: 'CANCEL_REMOTE_WORK' }, { type: 'EXPLAIN_CONTENT_MAY_ALREADY_BE_SENT' }] : []);

    case 'MUTE':
      if (snapshot.state === 'muted' || snapshot.state === 'disabled') return ignored(snapshot);
      return changed({ ...snapshot, state: 'muted', generation: snapshot.generation + 1,
        requestedFields: Object.freeze([]), destination: null, contentForwarded: false }, stopEffects(snapshot));

    case 'SECURITY_LOCK':
      return changed({ ...snapshot, state: 'muted', securityLocked: true, generation: snapshot.generation + 1,
        requestedFields: Object.freeze([]), destination: null, contentForwarded: false }, [
        ...stopEffects(snapshot), { type: 'SHOW_MUTED_FOR_SECURITY_LOCK' },
      ]);

    case 'SECURITY_UNLOCK':
      if (!snapshot.securityLocked) return ignored(snapshot);
      return changed({ ...snapshot, state: 'muted', securityLocked: false });

    case 'UNMUTE':
      if (snapshot.state !== 'muted' || !canWait(snapshot)) return ignored(snapshot);
      return changed({ ...snapshot, state: 'waiting-for-wake',
        unavailableReason: null, requestedFields: Object.freeze([]), destination: null, contentForwarded: false }, [
        { type: 'START_LOCAL_DETECTOR', maxBufferMs: MAX_PREWAKE_BUFFER_MS },
      ]);

    case 'POST_WAKE_DISCLOSURE_REVOKED':
      if (!snapshot.contentForwarded && snapshot.state !== 'processing') return ignored(snapshot);
      return returnToWaiting(snapshot, snapshot.contentForwarded
        ? [{ type: 'CANCEL_REMOTE_WORK' }, { type: 'EXPLAIN_CONTENT_MAY_ALREADY_BE_SENT' }] : []);

    case 'HOST_UNAVAILABLE':
      return changed({ ...snapshot, state: 'unavailable', unavailableReason: 'host', generation: snapshot.generation + 1,
        requestedFields: Object.freeze([]), destination: null, contentForwarded: false }, [
        ...stopEffects(snapshot), { type: 'SHOW_HOST_UNAVAILABLE' },
      ]);

    case 'HOST_AVAILABLE':
      if (snapshot.unavailableReason !== 'host') return ignored(snapshot);
      return changed({ ...snapshot, state: snapshot.localListeningOptIn ? 'muted' : 'disabled', unavailableReason: null });

    default:
      return ignored(snapshot);
  }
}
