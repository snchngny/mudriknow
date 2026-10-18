const path = require('node:path');
const fs = require('node:fs');
const { createIntakeServer, SubmissionStore } = require('../dist/manual-intake.cjs');
const root = path.resolve(__dirname, '..');
const directory = process.env.MUDRIK_INTAKE_DATA || path.join(root, '.local/manual-intake');
const [operation = 'serve', id] = process.argv.slice(2);
if (operation === 'serve') {
  const { server } = createIntakeServer(directory);
  server.listen(Number(process.env.MUDRIK_INTAKE_PORT || 43127), '127.0.0.1', () => console.log('Manual intake ready (loopback only)'));
} else {
  const store = new SubmissionStore(directory);
  if (operation === 'list') console.log(JSON.stringify(store.entries(), null, 2));
  else if (operation === 'approve' || operation === 'reject') {
    store.review(id, operation === 'approve' ? 'approved' : 'rejected');
    // This static JSON is the future GitHub/Pages publication artifact.
    fs.writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify(store.catalog(), null, 2));
    console.log('Review saved; catalog.json updated');
  } else throw new Error('Use serve, list, approve <id>, or reject <id>');
}
