// Новости от администратора (с оценкой 1–5 звёзд) и общая группа-чат всех
// пользователей XCAR. Файловое хранилище по той же схеме, что lib/support.js.
//   data/news.json — { news: [{ id, title, body, createdAt, active, seenBy:{uid:iso}, ratings:{uid:1..5} }] }
//   data/chat.json — { closed:false, bans:[uid], messages:[{ id, userId, name, text, createdAt, fromAdmin }] }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');
const MAX_MESSAGES = 2000;

function ensureDirs() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { console.error('Ошибка чтения', filePath, e); return fallback; }
}
function writeJsonAtomic(filePath, data) {
  ensureDirs();
  const tmp = filePath + '.tmp' + process.pid + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}
let queue = Promise.resolve();
function withLock(fn) { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; }
// read-modify-write под одной блокировкой
function mutate(file, fallback, fn) {
  return withLock(() => { const data = readJsonSafe(file, fallback); const r = fn(data); writeJsonAtomic(file, data); return r; });
}
const newsFallback = () => ({ news: [] });
const chatFallback = () => ({ closed: false, bans: [], messages: [] });

/* ---------------- Новости ---------------- */
function ratingStats(n) {
  const vals = Object.values(n.ratings || {}).map(Number).filter((v) => v >= 1 && v <= 5);
  const dist = [0, 0, 0, 0, 0];
  vals.forEach((v) => { dist[v - 1]++; });
  const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  return { count: vals.length, avg: Math.round(avg * 10) / 10, dist };
}
function newsForUser(n, userId) {
  return {
    id: n.id, title: n.title, body: n.body, createdAt: n.createdAt,
    seen: !!(n.seenBy && n.seenBy[userId]),
    myRating: (n.ratings && n.ratings[userId]) || 0,
    rating: ratingStats(n),
  };
}
async function listNewsForUser(userId) {
  const data = await withLock(() => readJsonSafe(NEWS_FILE, newsFallback()));
  return data.news.filter((n) => n.active !== false)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50).map((n) => newsForUser(n, userId));
}
async function markNewsSeen(id, userId) {
  return mutate(NEWS_FILE, newsFallback(), (d) => {
    const n = d.news.find((x) => x.id === id); if (!n) return null;
    n.seenBy = n.seenBy || {}; if (!n.seenBy[userId]) n.seenBy[userId] = new Date().toISOString();
    return newsForUser(n, userId);
  });
}
async function rateNews(id, userId, stars) {
  return mutate(NEWS_FILE, newsFallback(), (d) => {
    const n = d.news.find((x) => x.id === id); if (!n) return null;
    n.ratings = n.ratings || {}; n.ratings[userId] = stars;
    n.seenBy = n.seenBy || {}; if (!n.seenBy[userId]) n.seenBy[userId] = new Date().toISOString();
    return newsForUser(n, userId);
  });
}
async function listNewsAdmin() {
  const data = await withLock(() => readJsonSafe(NEWS_FILE, newsFallback()));
  return data.news.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((n) => ({
    id: n.id, title: n.title, body: n.body, createdAt: n.createdAt, active: n.active !== false,
    seenCount: Object.keys(n.seenBy || {}).length, rating: ratingStats(n), ratings: n.ratings || {},
  }));
}
async function createNews(title, body) {
  return mutate(NEWS_FILE, newsFallback(), (d) => {
    const n = { id: crypto.randomUUID(), title: String(title || '').trim().slice(0, 140) || 'Новость',
      body: String(body || '').trim().slice(0, 5000), createdAt: new Date().toISOString(), active: true, seenBy: {}, ratings: {} };
    d.news.push(n); return n;
  });
}
async function updateNews(id, patch) {
  return mutate(NEWS_FILE, newsFallback(), (d) => {
    const n = d.news.find((x) => x.id === id); if (!n) return null;
    if (patch.title != null) n.title = String(patch.title).trim().slice(0, 140) || n.title;
    if (patch.body != null) n.body = String(patch.body).trim().slice(0, 5000) || n.body;
    if (patch.active != null) n.active = !!patch.active;
    return n;
  });
}
async function deleteNews(id) {
  return mutate(NEWS_FILE, newsFallback(), (d) => { const before = d.news.length; d.news = d.news.filter((x) => x.id !== id); return d.news.length !== before; });
}

/* ---------------- Общая группа (чат) ---------------- */
async function readChat() { return withLock(() => readJsonSafe(CHAT_FILE, chatFallback())); }
async function postMessage({ userId, name, text, fromAdmin }) {
  return mutate(CHAT_FILE, chatFallback(), (d) => {
    const m = { id: crypto.randomUUID(), userId: userId || null, name: String(name || '').slice(0, 80),
      text: String(text || '').trim().slice(0, 2000), createdAt: new Date().toISOString(), fromAdmin: !!fromAdmin };
    d.messages.push(m);
    if (d.messages.length > MAX_MESSAGES) d.messages = d.messages.slice(-MAX_MESSAGES);
    return m;
  });
}
async function deleteMessage(id) {
  return mutate(CHAT_FILE, chatFallback(), (d) => { const b = d.messages.length; d.messages = d.messages.filter((m) => m.id !== id); return b !== d.messages.length; });
}
async function setChatClosed(closed) { return mutate(CHAT_FILE, chatFallback(), (d) => { d.closed = !!closed; return d.closed; }); }
async function setChatBan(userId, banned) {
  return mutate(CHAT_FILE, chatFallback(), (d) => {
    d.bans = (d.bans || []).filter((x) => x !== userId);
    if (banned) d.bans.push(userId);
    return d.bans;
  });
}
async function clearChat() { return mutate(CHAT_FILE, chatFallback(), (d) => { d.messages = []; return true; }); }

module.exports = {
  listNewsForUser, markNewsSeen, rateNews, listNewsAdmin, createNews, updateNews, deleteNews,
  readChat, postMessage, deleteMessage, setChatClosed, setChatBan, clearChat,
};
