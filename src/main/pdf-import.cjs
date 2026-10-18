// Load PDF.js with Node's native ESM loader, outside the bundled CJS runtime.
module.exports = (url) => import(url);
module.exports.resolve = (specifier) => require.resolve(specifier);
