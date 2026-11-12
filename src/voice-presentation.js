// Presentation derived from the existing native snapshot; no microphone ownership.
export function voicePresentation(s) {
  if (s.status !== 'ready') return { state: 'unavailable', working: 'Voice service unavailable.', result: '' };
  if (s.listeningStatus === 'disabled') return { state: 'disabled', working: 'Listening is disabled.', result: '' };
  if (s.listeningStatus && s.listeningStatus !== 'enabled') return { state: 'unavailable', working: 'Listening is paused. Check voice settings.', result: '' };
  const state = s.capturePhase === 'awake' ? (s.commandSpeechActive ? 'capturing' : 'wake')
    : s.capturePhase === 'review' ? 'processing'
    : s.capturePhase === 'response' ? (s.replyPlaying ? 'responding' : 'processing')
    : s.capturePhase === 'retry' ? 'retry' : 'idle';
  const working = { wake: 'Wake phrase detected. Ready for your words.', capturing: 'Listening to your command…', processing: 'Working out your request…', responding: 'Sharing the response.', retry: 'No complete response. Please try again.', idle: 'Ready for a wake phrase.' }[state];
  return { state, working, result: s.commandError || s.replyCaption || (state === 'retry' ? (s.commandError || 'No command was confirmed. Please try again.') : '') };
}
