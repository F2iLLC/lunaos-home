import { z } from 'zod';

export const vehicleEventSchema = z.object({
  endpoint: z.literal('fergalicious'), trip: z.string().uuid(),
  sequence: z.number().int().positive().max(1_000_000),
  event: z.enum(['connected', 'disconnected']),
  period: z.enum(['morning', 'afternoon', 'evening']),
}).strict();
export const vehicleStyleSchema = z.object({ style: z.enum(['warm', 'witty', 'dramatic']) }).strict();
export const vehicleSelectionSchema = vehicleStyleSchema.extend({ variant: z.number().int().min(0).max(1) });

// No calendar, location, telemetry, arbitrary model text, or vault access. The
// existing assistant selects a personality expression, never a separate agent.
export function vehicleGreeting(period, style = 'witty', variant = 0) {
  const lines = {
    warm: ['Lovely to have you along.', 'A little company for the road.'],
    witty: ['Excellent company. Impeccable taste.', 'Your entrance was almost as good as mine.'],
    dramatic: ['The entrance has been made. Naturally.', 'A Cadillac entrance deserves a proper hello.'],
  };
  return `Good ${period}. Fergie here. ${lines[style][variant % 2]}`;
}

export function createVehicleSessions({ now = () => performance.now(), graceMs = 120_000, leaseMs = 180_000 } = {}) {
  const approvals = new Set(), sessions = new Map();
  let style = 'witty', variant = 0, selector;
  const deny = () => { throw new Error('Vehicle endpoint not approved.'); };
  function expire() {
    const tick = now();
    for (const [peer, session] of sessions) {
      if (tick >= session.deadline) sessions.delete(peer);
    }
  }
  return Object.freeze({
    // Only the local owner configuration can enroll a vehicle endpoint. Pairing
    // alone and assistant tool calls cannot grant this scope.
    approve(peer) { if (approvals.size >= 32 && !approvals.has(peer)) deny(); approvals.add(peer); },
    revoke(peer) { approvals.delete(peer); sessions.delete(peer); },
    setStyle(input) { style = vehicleStyleSchema.parse(input).style; return { style }; },
    setGreetingSelector(select) { selector = select; },
    inspect() { expire(); return { endpoint: 'fergalicious', capabilities: ['greeting'], activeSessions: sessions.size, style }; },
    receive(peer, raw) {
      if (!approvals.has(peer)) deny();
      const event = vehicleEventSchema.parse(raw);
      expire();
      let session = sessions.get(peer);
      if (session && session.trip !== event.trip) deny();
      if (!session) {
        if (event.event !== 'connected') return { state: 'ended' };
        session = { trip: event.trip, sequence: 0, greeting: vehicleGreeting(event.period, style, variant++), deadline: 0 };
        sessions.set(peer, session);
        if (selector) {
          const selectedSession = session;
          // One bounded request per session. No phone identity, trip ID, vehicle
          // address, history or vault context is disclosed to the assistant.
          let timer;
          const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Unavailable')), 1500); });
          selectedSession.pending = Promise.race([Promise.resolve().then(() => selector({ period: event.period, style })), timeout])
            .then(value => {
              const selection = vehicleSelectionSchema.parse(value);
              if (sessions.get(peer) === selectedSession && approvals.has(peer))
                selectedSession.greeting = vehicleGreeting(event.period, selection.style, selection.variant);
            }).catch(() => {}).finally(() => { clearTimeout(timer); });
        }
      }
      // Lost responses can be retried without new generation or lease extension.
      if (event.sequence > session.sequence) {
        session.sequence = event.sequence;
        session.state = event.event === 'connected' ? 'connected' : 'reconnecting';
        session.deadline = now() + (event.event === 'connected' ? leaseMs : graceMs);
      }
      const reply = () => {
        if (!approvals.has(peer) || sessions.get(peer) !== session || now() >= session.deadline) deny();
        return { state: session.state, greeting: session.greeting };
      };
      return session.pending ? session.pending.then(reply) : reply();
    },
    close() { approvals.clear(); sessions.clear(); },
  });
}
