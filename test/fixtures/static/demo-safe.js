// Safe: strict-eq origin check — classifies as strict-eq, no rule fires.
window.addEventListener('message', function(e) {
  if (e.origin === 'https://trusted.example.com') {
    document.getElementById('output').textContent = e.data;
  }
});
