// Footer provenance: which build of the dataset this page is reading.
//
// The fingerprint is a hash of the committed event files, computed by the derive
// CLI. It is deterministic, so two pages that show the same fingerprint are
// showing the same numbers.

const meta = await fetch('data/meta.json')
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);

const fingerprint = meta?.dataset?.fingerprint;
if (fingerprint) {
  for (const wrap of document.querySelectorAll('footer.site .wrap')) {
    const line = document.createElement('p');
    line.className = 'small mono';
    line.textContent = `Dataset ${fingerprint.slice(0, 12)} · ${meta.dataset.events.toLocaleString('en-US')} events · ${meta.dataset.rows.toLocaleString('en-US')} result rows · deterministic build`;
    wrap.append(line);
  }
}
