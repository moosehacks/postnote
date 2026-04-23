// pm-targetorigin-wildcard: broadcasts a token to any listening origin
window.addEventListener('load', function() {
  window.postMessage({ token: 'demo-secret-token', user: 'admin' }, '*');
});
