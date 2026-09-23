// Заявки на выбор/продление тарифа — то, что видит администратор в /admin
// как "уведомление от пользователя" и подтверждает после получения оплаты.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const REQUESTS_FILE = path.join(DATA_DIR, 'payment-requests.json');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Ошибка чтения заявок', filePath, e);
    return fallback;
  }
}
function writeJsonAtomic(filePath, data) {
  ensureDirs();
  const tmp = filePath + '.tmp' + process.pid + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

let queue = Promise.resolve();
function withLock(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function readAll() {
  return withLock(() => readJsonSafe(REQUESTS_FILE, { requests: [] }));
}
async function writeAll(data) {
  return withLock(() => { writeJsonAtomic(REQUESTS_FILE, data); return data; });
}

async function createRequest(userId, planId, months, contactPhone) {
  const data = await readAll();
  const req = {
    id: crypto.randomUUID(),
    userId,
    planId,
    months: Number.isFinite(months) && months > 0 ? months : 1, // на сколько месяцев клиент оплатил (сам выбрал в приложении)
    contactPhone: (contactPhone || '').trim(), // номер, который клиент вписал сам — не обязательно телефон аккаунта, чтобы админ знал, кому звонить/писать
    status: 'pending', // pending | approved | rejected
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    monthsGranted: null
  };
  data.requests.push(req);
  await writeAll(data);
  return req;
}
async function listRequests() {
  const data = await readAll();
  return data.requests.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
async function resolveRequest(id, status, monthsGranted) {
  const data = await readAll();
  const req = data.requests.find(r => r.id === id);
  if (!req) return null;
  req.status = status;
  req.resolvedAt = new Date().toISOString();
  if (monthsGranted !== undefined) req.monthsGranted = monthsGranted;
  await writeAll(data);
  return req;
}

module.exports = { createRequest, listRequests, resolveRequest };
