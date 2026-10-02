// Apply the saved theme before first paint so the page never flashes the other one.
// (A separate file rather than inline, so the Content-Security-Policy can forbid inline scripts.)
try {
  const t = JSON.parse(localStorage.getItem('techo.theme'));
  if (['dark', 'light', 'red', 'green', 'blue'].includes(t)) document.documentElement.dataset.theme = t;
} catch { /* storage blocked */ }
