const fs = require('node:fs');
const path = require('node:path');
module.exports = async () => {
  const file = path.resolve(__dirname, '../../../.acceptance/fixture.json');
  if (!fs.existsSync(file)) return;
  const fixture = JSON.parse(fs.readFileSync(file));
  try {
    await fetch('http://127.0.0.1:4173/__acceptance/shutdown', {
      method: 'POST',
      headers: { 'x-acceptance-key': fixture.shutdownKey },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* The server may have already stopped after a startup failure. */
  }
};
