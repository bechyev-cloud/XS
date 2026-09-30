// Общий помощник для JSON-файлов XCAR CONTROL: атомарная запись + очередь
// блокировок на каждый файл (та же схема, что в lib/store.js).
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const queues = new Map();

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function dataPath(...parts) { return path.join(DATA_DIR, ...parts); }
function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return typeof fallback === 'function' ? fallback() : fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : (typeof fallback === 'function' ? fallback() : fallback);
  } catch (e) {
    console.error('XCAR CONTROL: ошибка чтения', filePath, e.message);
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}
function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.tmp' + process.pid + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, filePath);
}
function withLock(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(key, next.catch(() => {}));
  return next;
}
function jsonFile(name, fallback) {
  const file = dataPath(name);
  return {
    file,
    read: () => withLock(file, () => readJsonSafe(file, fallback)),
    write: (data) => withLock(file, () => { writeJsonAtomic(file, data); return data; }),
    // read-modify-write под одной блокировкой
    update: (fn) => withLock(file, () => {
      const data = readJsonSafe(file, fallback);
      const r = fn(data);
      writeJsonAtomic(file, data);
      return r;
    }),
  };
}
module.exports = { DATA_DIR, dataPath, ensureDir, readJsonSafe, writeJsonAtomic, withLock, jsonFile };
