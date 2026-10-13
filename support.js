// Обращения в техподдержку — клиент описывает проблему в Настройках
// приложения, супер-админ видит список обращений в /admin (раздел 20).
// Файловое хранилище по той же схеме, что и lib/requests.js (заявки на тариф).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SUPPORT_FILE = path.join(DATA_DIR, 'support-tickets.json');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Ошибка чтения обращений в поддержку', filePath, e);
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
  return withLock(() => readJsonSafe(SUPPORT_FILE, { tickets: [] }));
}
async function writeAll(data) {
  return withLock(() => { writeJsonAtomic(SUPPORT_FILE, data); return data; });
}

async function createTicket(userId, message, contactPhone) {
  const data = await readAll();
  const ticket = {
    id: crypto.randomUUID(),
    userId,
    message: String(message || '').trim().slice(0, 4000),
    contactPhone: (contactPhone || '').trim(),
    status: 'open', // open | closed
    createdAt: new Date().toISOString(),
    closedAt: null
  };
  data.tickets.push(ticket);
  await writeAll(data);
  return ticket;
}
async function listTickets() {
  const data = await readAll();
  return data.tickets.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
async function closeTicket(id) {
  const data = await readAll();
  const ticket = data.tickets.find(t => t.id === id);
  if (!ticket) return null;
  ticket.status = 'closed';
  ticket.closedAt = new Date().toISOString();
  await writeAll(data);
  return ticket;
}

module.exports = { createTicket, listTickets, closeTicket };
