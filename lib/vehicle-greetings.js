// Generic personality only. No calendar, route, telemetry or inferred facts.
export const vehicleGreetings = Object.freeze({
  warm: [
    'Good {period}, gorgeous. {name} here. Lovely to have you along.',
    'Hello, darling. {name} here. A little luxury, a little company.',
    "Good {period}. It's {name}. Let's make the ordinary a little more fabulous.",
    "Welcome back, gorgeous. {name} here. You bring the company; I'll bring the charm.",
  ],
  witty: [
    'Good {period}. {name} here. Excellent company. Impeccable taste.',
    'Hello, gorgeous. {name} here. Your entrance was almost as good as mine.',
    'Good {period}, darling. {name} here. You bring the playlist; I bring the personality.',
    'You, me, impeccable taste. Good {period} from {name}.',
  ],
  dramatic: [
    'Good {period}. {name} here. The entrance has been made. Naturally.',
    'Hello, darling. {name} here. A grand entrance deserves a proper hello.',
    'Good {period}, gorgeous. {name} here. Luxury has entered the conversation.',
    'Good {period}. {name} here. Your chariot has opinions. Mostly excellent ones.',
  ],
});
export const vehicleVariants = 4;
export function vehicleGreeting(period, style = 'witty', variant = 0) {
  return vehicleGreetings[style][variant % vehicleVariants].replace('{period}', period);
}
