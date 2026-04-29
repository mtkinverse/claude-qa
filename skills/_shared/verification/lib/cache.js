'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashOf(parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' ? p : JSON.stringify(p));
  return h.digest('hex').slice(0, 16);
}

function readCached(cacheDir, key) {
  const f = path.join(cacheDir, `${key}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; }
}

function writeCached(cacheDir, key, value) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, `${key}.json`), JSON.stringify(value, null, 2));
}

module.exports = { hashOf, readCached, writeCached };
