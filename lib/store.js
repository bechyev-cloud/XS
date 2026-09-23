// Простое файловое хранилище (JSON-файлы на диске).
// Осознанный выбор для этого проекта: у автопроката один-два сотрудника
// и не миллионы записей, поэтому полноценная СУБД избыточна, а файловая
// база не требует ни установки, ни настройки на любом хостинге — просто
// npm install && node server.js.
//
// Если объём данных вырастет — этот модуль можно заменить на настоящую
// БД (Postgres/SQLite), не трогая routes/*, т.к. наружу отдаются только
// функции readUsers/writeUsers/readStore/writeStore/writeStoreKey.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const STORES_DIR = path.join(DATA_DIR, 'stores');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORES_DIR)) fs.mkdirSync(STORES_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
  }
}
ensureDirs();

// Сериализуем запись в каждый файл отдельной очередью промисов,
// чтобы параллельные запросы не затирали друг друга (race condition).
const queues = new Map();
function withFileLock(filePath, fn) {
  const prev = queues.get(filePath) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(filePath, next.catch(() => {}));
  return next;
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Ошибка чтения файла', filePath, e);
    return fallback;
  }
}
function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp' + process.pid + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

async function readUsers() {
  return withFileLock(USERS_FILE, () => readJsonSafe(USERS_FILE, { users: [] }));
}
async function writeUsers(dataObj) {
  return withFileLock(USERS_FILE, () => writeJsonAtomic(USERS_FILE, dataObj));
}

function storeFile(userId) {
  // userId всегда UUID (см. crypto.randomUUID в routes/auth.js), поэтому
  // безопасно использовать его как имя файла без дополнительной валидации.
  return path.join(STORES_DIR, userId + '.json');
}

const EMPTY_STORE = {
  cars: [],
  clients: [],
  contracts: [],
  clientLedger: [],
  oilChanges: [],
  sharedClients: [],
  sharedClientSources: [],
  settings: {}
};

async function readStore(userId) {
  const f = storeFile(userId);
  return withFileLock(f, () => readJsonSafe(f, Object.assign({}, EMPTY_STORE)));
}
async function writeStore(userId, dataObj) {
  const f = storeFile(userId);
  return withFileLock(f, () => writeJsonAtomic(f, dataObj));
}
async function writeStoreKey(userId, key, value) {
  const f = storeFile(userId);
  return withFileLock(f, () => {
    const cur = readJsonSafe(f, Object.assign({}, EMPTY_STORE));
    cur[key] = value;
    writeJsonAtomic(f, cur);
    return cur;
  });
}
async function deleteStore(userId) {
  const f = storeFile(userId);
  return withFileLock(f, () => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { console.error('Ошибка удаления файла', f, e); }
  });
}
// Быстрая сводка по объёму данных пользователя — для списка в админке
// (сколько машин/клиентов/договоров у каждого аккаунта), без отдачи всего объекта.
function storeCounts(userId) {
  const f = storeFile(userId);
  const store = readJsonSafe(f, Object.assign({}, EMPTY_STORE));
  return {
    cars: Array.isArray(store.cars) ? store.cars.length : 0,
    clients: Array.isArray(store.clients) ? store.clients.length : 0,
    contracts: Array.isArray(store.contracts) ? store.contracts.length : 0
  };
}

module.exports = {
  readUsers, writeUsers, readStore, writeStore, writeStoreKey, deleteStore, storeCounts, EMPTY_STORE
};
