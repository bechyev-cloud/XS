// Личные сообщения между пользователями XCAR (Сообщения → Личные).
//   data/pm.json — {
//     contacts: { uid: [uid,...] },          — кого пользователь добавил в контакты
//     blocks:   { uid: [uid,...] },          — кого пользователь заблокировал (тот не может ему писать)
//     banned:   [uid],                       — администратор запретил личные сообщения
//     threads:  { "a|b": { messages:[{ id, from, text, createdAt }], read:{ uid: iso } } }
//   }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'pm.json');
const MAX_PER_THREAD = 1000;
const fallback = () => ({ contacts: {}, blocks: {}, banned: [], threads: {}, reqs: {} });

function read() {
  try { if (!fs.existsSync(FILE)) return fallback(); const d = JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}'); return Object.assign(fallback(), d); }
  catch (e) { console.error('pm.json', e); return fallback(); }
}
function write(d) {
  const dir = path.dirname(FILE); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = FILE + '.tmp' + process.pid; fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, FILE);
}
let q = Promise.resolve();
function lock(fn) { const n = q.then(fn, fn); q = n.catch(() => {}); return n; }
function mutate(fn) { return lock(() => { const d = read(); const r = fn(d); write(d); return r; }); }
function key(a, b) { return [a, b].sort().join('|'); }
const has = (map, a, b) => ((map || {})[a] || []).includes(b);

async function snapshot() { return lock(() => read()); }
async function setContact(uid, other, on) {
  return mutate((d) => { const l = (d.contacts[uid] || []).filter((x) => x !== other); if (on) l.push(other); d.contacts[uid] = l; return l; });
}
async function setBlock(uid, other, on) {
  return mutate((d) => { const l = (d.blocks[uid] || []).filter((x) => x !== other); if (on) l.push(other); d.blocks[uid] = l; return l; });
}
async function setBanned(uid, on) {
  return mutate((d) => { d.banned = (d.banned || []).filter((x) => x !== uid); if (on) d.banned.push(uid); return d.banned; });
}
async function send(from, to, text, attachments) {
  text = String(text || '').trim().slice(0, 20000);
  const atts = Array.isArray(attachments) ? attachments : [];
  if (!text && !atts.length) throw new Error('Введите сообщение');
  if (from === to) throw new Error('Нельзя написать самому себе');
  return mutate((d) => {
    if ((d.banned || []).includes(from)) throw new Error('Администратор запретил вам отправлять личные сообщения');
    if (has(d.blocks, to, from)) throw new Error('Пользователь ограничил вам отправку сообщений');
    if (has(d.blocks, from, to)) throw new Error('Вы заблокировали этого пользователя — разблокируйте, чтобы написать');
    const k = key(from, to); const t = d.threads[k] || (d.threads[k] = { messages: [], read: {} });
    const m = { id: crypto.randomUUID(), from, text, attachments: atts.length ? atts : undefined, createdAt: new Date().toISOString() };
    t.messages.push(m); if (t.messages.length > MAX_PER_THREAD) t.messages = t.messages.slice(-MAX_PER_THREAD);
    t.read[from] = m.createdAt;
    return m;
  });
}
async function thread(uid, other, markRead) {
  const fn = (d) => {
    const t = d.threads[key(uid, other)] || { messages: [], read: {} };
    if (markRead && t.messages.length) { t.read[uid] = new Date().toISOString(); d.threads[key(uid, other)] = t; }
    const otherRead = t.read[other] || '';
    return {
      messages: t.messages.slice(-300).map((m) => ({ id: m.id, text: m.text, attachments: m.attachments || [], createdAt: m.createdAt, mine: m.from === uid, deleted: !!m.deleted, delMod: !!m.delMod, read: m.from === uid ? otherRead >= m.createdAt : true })),
      blockedByMe: has(d.blocks, uid, other), blockedMe: has(d.blocks, other, uid), banned: (d.banned || []).includes(uid),
      contact: has(d.contacts, uid, other),
    };
  };
  return markRead ? mutate(fn) : lock(() => fn(read()));
}
// список диалогов: контакты + все, кто писал пользователю
function dialogs(d, uid) {
  const ids = new Set(d.contacts[uid] || []);
  const out = {};
  Object.entries(d.threads).forEach(([k, t]) => {
    const [a, b] = k.split('|'); if (a !== uid && b !== uid) return;
    const other = a === uid ? b : a; ids.add(other);
    const last = t.messages[t.messages.length - 1];
    const myRead = t.read[uid] || '';
    out[other] = { last: last ? { text: last.deleted ? '🚫 Сообщение удалено' : last.text || ((last.attachments||[]).some((a) => a.voice) ? '🎤 Голосовое сообщение' : (last.attachments||[]).length ? '📎 Файл' : ''), createdAt: last.createdAt, mine: last.from === uid } : null,
      unread: t.messages.filter((m) => m.from !== uid && m.createdAt > myRead).length };
  });
  return [...ids].map((id) => Object.assign({ userId: id, contact: has(d.contacts, uid, id), blocked: has(d.blocks, uid, id), last: null, unread: 0 }, out[id] || {}));
}
// ---- контакты по запросу: A просит → B подтверждает → оба в контактах друг у друга ----
//   reqs: { toUid: [{ from, at }] }
function addPair(d, a, b) { [[a, b], [b, a]].forEach(([x, y]) => { const l = d.contacts[x] || (d.contacts[x] = []); if (!l.includes(y)) l.push(y); }); }
function dropReq(d, from, to) { if (d.reqs && d.reqs[to]) { d.reqs[to] = d.reqs[to].filter((r) => r.from !== from); if (!d.reqs[to].length) delete d.reqs[to]; } }
async function requestContact(uid, other) {
  return mutate((d) => {
    d.reqs = d.reqs || {};
    if (has(d.contacts, uid, other) && has(d.contacts, other, uid)) return { status: 'added' };
    // встречный запрос уже есть — сразу дружим
    if ((d.reqs[uid] || []).some((r) => r.from === other)) { dropReq(d, other, uid); addPair(d, uid, other); return { status: 'added' }; }
    // старые односторонние контакты (до запросов): тот уже добавил меня — подтверждение не нужно
    if (has(d.contacts, other, uid)) { addPair(d, uid, other); return { status: 'added' }; }
    if (has(d.blocks, other, uid)) throw new Error('Пользователь ограничил вам запросы');
    const l = d.reqs[other] || (d.reqs[other] = []);
    if (!l.some((r) => r.from === uid)) l.push({ from: uid, at: new Date().toISOString() });
    return { status: 'requested' };
  });
}
async function answerRequest(uid, from, accept) {
  return mutate((d) => {
    d.reqs = d.reqs || {};
    const had = (d.reqs[uid] || []).some((r) => r.from === from); dropReq(d, from, uid);
    if (accept && had) addPair(d, uid, from);
    return { ok: true, added: !!(accept && had) };
  });
}
async function removeContact(uid, other) {
  return mutate((d) => { d.reqs = d.reqs || {}; dropReq(d, uid, other); d.contacts[uid] = (d.contacts[uid] || []).filter((x) => x !== other); d.contacts[other] = (d.contacts[other] || []).filter((x) => x !== uid); return true; });
}
function requestsOf(d, uid) { return { incoming: ((d.reqs || {})[uid] || []).slice(), outgoing: Object.entries(d.reqs || {}).filter(([to, l]) => l.some((r) => r.from === uid)).map(([to]) => to) }; }
async function unread(uid) { const d = await snapshot(); return dialogs(d, uid).reduce((s, x) => s + (x.blocked ? 0 : x.unread), 0); }

// удалить своё сообщение у всех — в течение 3 часов после отправки
async function deleteOwn(uid, other, id, limitMs) {
  return mutate((d) => {
    const t = d.threads[key(uid, other)]; const m = t && t.messages.find((x) => x.id === id);
    if (!m || m.from !== uid) throw new Error('Сообщение не найдено');
    if (m.deleted) return m;
    if (Date.now() - new Date(m.createdAt).getTime() > limitMs) throw new Error('Удалить у всех можно только в течение 3 часов после отправки');
    m.deleted = true; m.deletedAt = new Date().toISOString(); m.text = ''; m.attachments = [];
    return m;
  });
}
// разработчик/админ приложения: удалить у всех любое сообщение в своей переписке, без ограничения по времени
async function modDelete(uid, other, id, canOther) {
  return mutate((d) => {
    const t = d.threads[key(uid, other)]; const m = t && t.messages.find((x) => x.id === id);
    if (!m) throw new Error('Сообщение не найдено'); if (m.deleted) return m;
    if (m.from !== uid && canOther === false) throw new Error('Сообщение разработчика может удалить только разработчик');
    m.deleted = true; m.delMod = m.from !== uid; m.deletedAt = new Date().toISOString(); m.text = ''; m.attachments = [];
    return m;
  });
}
// ---- администратор: просмотр, удаление, очистка, автоудаление ----
async function adminThreads() {
  return lock(() => { const d = read(); return Object.keys(d.threads).map((k) => { const t = d.threads[k]; const last = t.messages[t.messages.length - 1];
    return { key: k, users: k.split('|'), count: t.messages.length, last: last ? { text: last.text || ((last.attachments || []).length ? '📎 Файл' : ''), createdAt: last.createdAt, from: last.from } : null }; })
    .filter((x) => x.count).sort((a, b) => String((b.last || {}).createdAt).localeCompare(String((a.last || {}).createdAt))); });
}
async function adminThread(k) { return lock(() => { const t = read().threads[k]; return t ? t.messages.slice(-500) : []; }); }
async function adminDelete(k, id) { return mutate((d) => { const t = d.threads[k]; if (!t) return false; const b = t.messages.length; t.messages = t.messages.filter((m) => m.id !== id); return b !== t.messages.length; }); }
async function adminClear(k) { return mutate((d) => { if (k) { const t = d.threads[k]; const n = t ? t.messages.length : 0; if (t) t.messages = []; return n; } let n = 0; Object.values(d.threads).forEach((t) => { n += t.messages.length; t.messages = []; }); return n; }); }
async function prune(days) {
  if (!days) return 0; const edge = new Date(Date.now() - days * 86400000).toISOString();
  return mutate((d) => { let n = 0; Object.values(d.threads).forEach((t) => { const b = t.messages.length; t.messages = t.messages.filter((m) => m.createdAt >= edge); n += b - t.messages.length; }); return n; });
}
module.exports = { modDelete, requestContact, answerRequest, removeContact, requestsOf, deleteOwn, adminThreads, adminThread, adminDelete, adminClear, prune, snapshot, setContact, setBlock, setBanned, send, thread, dialogs, unread };
