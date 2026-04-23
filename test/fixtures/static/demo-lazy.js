// Lazy listener: only registers after the user clicks "Load feature".
// interact.ts must click the button for this finding to appear.
document.getElementById('load-btn').addEventListener('click', function() {
  window.addEventListener('message', function(e) {
    // __DEMO_LAZY_HANDLER__
    document.getElementById('output').innerHTML = e.data;
  });
});
