// Sentry-wrapped listener — hook must unwind the wrapper to see the real handler.
// The real handler has no origin check (pm-no-origin-check).
var realHandler = function(e) {
  // __DEMO_REAL_HANDLER__
  document.getElementById('output').innerHTML = e.data;
};

var wrapped = function sentryWrapped(e) {
  try { return realHandler.apply(this, arguments); }
  catch (err) { Sentry.captureException(err); }
};
wrapped.__sentry_original__ = realHandler;

window.addEventListener('message', wrapped);
