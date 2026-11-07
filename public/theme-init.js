// Apply the saved theme before first paint so the page never flashes the other one.
// (A separate file rather than inline, so the Content-Security-Policy can forbid inline scripts.)
try {
  const t = JSON.parse(localStorage.getItem('techo.theme'));
  if (['dark', 'light', 'red', 'green', 'blue'].includes(t)) document.documentElement.dataset.theme = t;
  const f = JSON.parse(localStorage.getItem('techo.font'));
  if (f === 'meiryo' || f === 'browser') document.documentElement.dataset.font = f;
  if (f === 'wikipedia') document.documentElement.dataset.font = 'browser'; // its name in v0.20.0
} catch { /* storage blocked */ }
