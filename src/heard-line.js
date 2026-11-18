// What the companion heard belongs to the exchange it came from: it stays while they are working
// or speaking, and clears a little after they are back to waiting, much as captions do.
export function createHeardLine({ lingerMs = 10000 } = {}) {
  let exchange = '', idleSince;
  return (snapshot, phase, now = Date.now()) => {
    const heard = snapshot.status === 'ready' && phase !== 'off' && snapshot.lastHeard ? snapshot.lastHeard : '';
    const current = `${snapshot.wakeEvent}:${heard}`;
    if (current !== exchange) { exchange = current; idleSince = undefined; }
    if (phase !== 'waiting' || snapshot.replyPlaying === true) idleSince = undefined;
    else if (idleSince === undefined) idleSince = now;
    return heard && !(idleSince !== undefined && now - idleSince >= lingerMs) ? `Heard: “${heard}”` : '';
  };
}
