// pm-loose-origin-check: indexOf is bypassable (e.g. origin="evil-trusted.com")
window.addEventListener('message', function(e) {
  if (e.origin.indexOf('trusted.com') !== -1) {
    document.getElementById('output').innerHTML = e.data;
  }
});
