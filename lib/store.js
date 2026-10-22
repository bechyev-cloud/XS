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
function writeJsonAtomic(filePath, data, compact) {
  const tmp = filePath + '.tmp' + process.pid + Math.random().toString(36).slice(2);
  // базы аккаунтов пишутся без отступов: при тысячах договоров файл в ~1,5 раза меньше и быстрее
  fs.writeFileSync(tmp, compact ? JSON.stringify(data) : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
  if (compact) revCache.set(filePath, { rev: Object.assign({}, data && data._rev), mtime: safeMtime(filePath) });
}
// Кэш ревизий разделов: приложение спрашивает /api/data/rev раз в ~30 сек —
// раньше на каждый такой запрос читался и разбирался весь файл базы.
const revCache = new Map();
function safeMtime(f) { try { return fs.statSync(f).mtimeMs; } catch (e) { return 0; } }

async function readUsers() {
  return withFileLock(USERS_FILE, () => readJsonSafe(USERS_FILE, { users: [] }));
}
async function writeUsers(dataObj) {
  return withFileLock(USERS_FILE, () => { writeJsonAtomic(USERS_FILE, dataObj); usersLite = null; });
}
// Быстрая проверка аккаунта для каждого запроса (authMiddleware): кэш «id → заблокирован»,
// пересобирается только когда меняется users.json — без разбора всего файла на каждый запрос.
let usersLite = null;
async function getUserLite(uid) {
  const m = safeMtime(USERS_FILE);
  if (!usersLite || usersLite.mtime !== m) {
    const data = await readUsers(); const map = new Map();
    (data.users || []).forEach((u) => { if (u && u.id) map.set(u.id, { id: u.id, blocked: !!u.blocked, subscription: u.subscription || null }); });
    usersLite = { mtime: m, map };
  }
  return usersLite.map.get(uid) || null;
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
// ---- Ревизии разделов (_rev) ----
// Каждый раздел (cars, clients, …) имеет номер ревизии, который растёт при
// любом изменении — из приложения, с другого устройства, из XCAR CONTROL или
// старой панели /admin. По нему приложение узнаёт, что данные изменились «не
// им», и подтягивает их, а сервер при одновременной правке делает слияние,
// а не затирает чужие изменения (см. routes/data.js).
function bumpChanged(cur, next) {
  const rev = Object.assign({}, cur._rev || {});
  Object.keys(EMPTY_STORE).forEach((k) => {
    if (next[k] === undefined) return;
    if (JSON.stringify(cur[k]) !== JSON.stringify(next[k])) rev[k] = (rev[k] || 0) + 1;
  });
  return rev;
}
async function writeStore(userId, dataObj) {
  const f = storeFile(userId);
  return withFileLock(f, () => {
    const cur = readJsonSafe(f, Object.assign({}, EMPTY_STORE));
    const next = Object.assign({}, dataObj);
    next._rev = bumpChanged(cur, next);
    writeJsonAtomic(f, next, true);
    return next;
  });
}
async function writeStoreKey(userId, key, value) {
  const f = storeFile(userId);
  return withFileLock(f, () => {
    const cur = readJsonSafe(f, Object.assign({}, EMPTY_STORE));
    const rev = Object.assign({}, cur._rev || {});
    if (JSON.stringify(cur[key]) !== JSON.stringify(value)) rev[key] = (rev[key] || 0) + 1;
    cur[key] = value; cur._rev = rev;
    writeJsonAtomic(f, cur, true);
    return cur;
  });
}
// Атомарное изменение данных аккаунта (чтение-правка-запись под одной
// блокировкой файла) — для XCAR CONTROL: правка администратора не может
// затереть то, что приложение успело сохранить за это время.
async function updateStore(userId, fn) {
  const f = storeFile(userId);
  return withFileLock(f, () => {
    const cur = readJsonSafe(f, Object.assign({}, EMPTY_STORE));
    const before = JSON.parse(JSON.stringify(cur));
    const r = fn(cur);
    cur._rev = bumpChanged(before, cur);
    writeJsonAtomic(f, cur, true);
    return r;
  });
}
// Слияние при одновременной правке одного раздела с разных мест.
// knownIds / changedIds (для массивов) и changedKeys / knownKeys (для settings)
// присылает приложение: что было у него при последней синхронизации и что
// изменилось с тех пор у него самого.
function mergeKey(serverVal, clientVal, info) {
  info = info || {};
  if (Array.isArray(clientVal) && Array.isArray(serverVal)) {
    const idOf = (x) => (x && typeof x === 'object' ? x.id : undefined);
    if (!clientVal.every((x) => idOf(x) !== undefined)) return clientVal;
    const known = new Set(info.knownIds || []);
    const changed = new Set(info.changedIds || []);
    const clientIds = new Set(clientVal.map(idOf));
    const serverById = new Map(serverVal.filter((x) => idOf(x) !== undefined).map((x) => [idOf(x), x]));
    const out = clientVal.map((x) => {
      const id = idOf(x);
      // не менялось у клиента, но есть на сервере — берём серверную (свежую) версию
      if (!changed.has(id) && known.has(id) && serverById.has(id)) return serverById.get(id);
      // клиент не менял, а на сервере запись удалили — удаляем
      if (!changed.has(id) && known.has(id) && !serverById.has(id)) return undefined;
      return x;
    }).filter((x) => x !== undefined);
    // добавлено на сервере (панелью / другим устройством) и клиент это не удалял
    serverVal.forEach((x) => { const id = idOf(x); if (id !== undefined && !clientIds.has(id) && !known.has(id)) out.push(x); });
    return out;
  }
  if (clientVal && serverVal && typeof clientVal === 'object' && typeof serverVal === 'object' && !Array.isArray(clientVal)) {
    const out = Object.assign({}, serverVal);
    const changed = new Set(info.changedKeys || Object.keys(clientVal));
    const known = new Set(info.knownKeys || []);
    Object.keys(clientVal).forEach((k) => { if (changed.has(k) || !(k in serverVal)) out[k] = clientVal[k]; });
    known.forEach((k) => { if (!(k in clientVal) && changed.has(k)) delete out[k]; });
    return out;
  }
  return clientVal;
}
async function syncStoreKey(userId, key, value, baseRev, info) {
  const f = storeFile(userId);
  return withFileLock(f, () => {
    const cur = readJsonSafe(f, Object.assign({}, EMPTY_STORE));
    const rev = Object.assign({}, cur._rev || {});
    const serverRev = rev[key] || 0;
    let next = value; let merged = false;
    if (baseRev != null && Number(baseRev) < serverRev) { next = mergeKey(cur[key], value, info); merged = true; }
    if (JSON.stringify(cur[key]) !== JSON.stringify(next)) rev[key] = serverRev + 1;
    cur[key] = next; cur._rev = rev;
    writeJsonAtomic(f, cur, true);
    return { value: next, rev: rev[key] || 0, merged };
  });
}
async function readRevs(userId) {
  const f = storeFile(userId);
  return withFileLock(f, () => {
    const m = safeMtime(f); const c = revCache.get(f);
    if (c && c.mtime === m && m) return Object.assign({}, c.rev);
    const rev = readJsonSafe(f, {})._rev || {}; revCache.set(f, { rev: Object.assign({}, rev), mtime: m }); return rev;
  });
}
async function deleteStore(userId) {
  const f = storeFile(userId);
  return withFileLock(f, () => {
    revCache.delete(f);
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
  getUserLite, storeMtime: (uid) => safeMtime(storeFile(uid)),
  readUsers, writeUsers, readStore, writeStore, writeStoreKey, updateStore, syncStoreKey, readRevs, mergeKey, deleteStore, storeCounts, EMPTY_STORE
};
