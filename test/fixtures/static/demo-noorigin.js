// pm-no-origin-check: no e.origin validation whatsoever
window.addEventListener('message', function(e) {
  document.getElementById('output').innerHTML = e.data;
});
