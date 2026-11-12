/** Map only authoritative native snapshot fields to the Home presentation. */
export function homeAvatarState(snapshot) {
  if (!snapshot) return 'error';
  if (snapshot.capturePhase === 'response' && snapshot.replyPlaying === true) return 'talking';
  if ((snapshot.activeTimers || []).some(timer => Number(timer.remainingSeconds) === 0)) return 'working';
  if (['preparing', 'review', 'response', 'retry'].includes(snapshot.capturePhase)) return 'thinking';
  if (snapshot.capturePhase === 'awake') return 'listening';
  if (snapshot.status !== 'ready') return 'error';
  const availability = snapshot.listeningStatus;
  if (availability && availability !== 'enabled' && availability !== 'disabled') return 'error';
  if (availability === 'disabled') return 'sleeping';
  if (!snapshot.listeningEnabled) return 'error';
  return 'idle';
}

/** True only during the native post-wake command window. */
export function homeCommandReady(snapshot) {
  return snapshot?.status === 'ready'
    && snapshot.listeningStatus === 'enabled'
    && snapshot.capturePhase === 'awake'
    && !(snapshot.activeTimers || []).some(timer => Number(timer.remainingSeconds) === 0);
}

/** Notebook outcomes are confirmed by the service before they reach this map. */
export function notebookAvatarState(outcome) {
  if (outcome?.success === true) return 'happy';
  if (outcome && outcome.success === false) return 'error';
  return 'idle';
}
