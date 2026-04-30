/**
 * file-lock.js — safe append fallback (no external deps).
 * Uses a .lock sentinel file with spin-wait.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

async function appendWithLock(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = filePath + '.lock';
  const start = Date.now();
  // Spin-wait for lock
  while (true) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      break;
    } catch {
      if (Date.now() - start > 5000) throw new Error(`Lock timeout on ${filePath}`);
      await new Promise(r => setTimeout(r, 50));
    }
  }
  try {
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '');
    fs.appendFileSync(filePath, content);
  } finally {
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

module.exports = { appendWithLock };
