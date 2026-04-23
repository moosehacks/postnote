// pm-regex-without-anchors: /trusted\.com/ matches "evil-trusted.com" or "trusted.com.evil"
window.addEventListener('message', function(e) {
  if (/trusted\.com/.test(e.origin)) {
    document.getElementById('output').innerHTML = e.data;
  }
});
