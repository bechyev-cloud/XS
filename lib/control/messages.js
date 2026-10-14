// Личные сообщения «администратор ⇄ пользователь XCAR», вложения, массовые
// рассылки (сразу или по расписанию) и присутствие (онлайн) пользователей.
//   data/control-messages.json — { threads: { [userId]: { messages:[...], pinned:[ids], adminReadAt, userReadAt, userFetchedAt } } }
//   data/attachments/<id>      — файлы вложений (+ <id>.json с метаданными)
//   data/control-broadcasts.json — { broadcasts:[...] }
const fs = require('fs');
const crypto = require('crypto');
const { jsonFile, dataPath, ensureDir } = require('./jsonfile');

const db = jsonFile('control-messages.json', () => ({ threads: {} }));
const bdb = jsonFile('control-broadcasts.json', () => ({ broadcasts: [] }));
const ATT_DIR = dataPath('attachments');
const MAX_ATT = 10 * 1024 * 1024;
const presence = new Map(); // userId -> lastSeen ms (в памяти процесса)

function touchPresence(userId) { if (userId) presence.set(userId, Date.now()); }
function isOnline(userId) { return Date.now() - (presence.get(userId) || 0) < 3 * 60 * 1000; }
function lastSeen(userId) { const t = presence.get(userId); return t ? new Date(t).toISOString() : null; }

/* ---------- вложения ---------- */
function saveAttachment({ name, type, dataUrl }, maxBytes) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('Неверный формат файла');
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  const lim = maxBytes === undefined ? MAX_ATT : maxBytes; // 0 — без ограничения
  if (lim && buf.length > lim) throw new Error('Файл «' + String(name || 'файл').slice(0, 60) + '» больше ' + Math.round(lim / 1048576) + ' МБ');
  const id = crypto.randomUUID();
  ensureDir(ATT_DIR);
  const meta = { id, name: String(name || 'file').slice(0, 120), type: String(type || m[1] || 'application/octet-stream').slice(0, 100), size: buf.length, createdAt: new Date().toISOString() };
  fs.writeFileSync(dataPath('attachments', id), buf);
  fs.writeFileSync(dataPath('attachments', id + '.json'), JSON.stringify(meta));
  return meta;
}
function readAttachment(id) {
  if (!/^[0-9a-f-]{36}$/.test(String(id))) return null;
  const f = dataPath('attachments', id); const mf = f + '.json';
  if (!fs.existsSync(f) || !fs.existsSync(mf)) return null;
  return { meta: JSON.parse(fs.readFileSync(mf, 'utf8')), file: f };
}
function kindOf(type) { return /^image\//.test(type) ? 'image' : 'file'; }

/* ---------- сообщения ---------- */
function thread(d, userId) { if (!d.threads[userId]) d.threads[userId] = { messages: [], pinned: [], adminReadAt: null, userReadAt: null, userFetchedAt: null }; return d.threads[userId]; }
function msgStatus(t, m) {
  if (m.from !== 'admin') return null;
  if (t.userReadAt && t.userReadAt >= m.createdAt) return 'read';
  if (t.userFetchedAt && t.userFetchedAt >= m.createdAt) return 'delivered';
  return 'sent';
}
async function post(userId, { from, text, attachments, adminName, priority, broadcastId, maxBytes }) {
  const atts = [];
  for (const a of (attachments || []).slice(0, 5)) { const meta = saveAttachment(a, maxBytes); atts.push({ id: meta.id, name: meta.name, type: meta.type, size: meta.size, kind: kindOf(meta.type) }); }
  const clean = String(text || '').trim().slice(0, 20000);
  if (!clean && !atts.length) throw new Error('Пустое сообщение');
  return db.update((d) => {
    const t = thread(d, userId);
    const m = { id: crypto.randomUUID(), from, text: clean, attachments: atts, createdAt: new Date().toISOString(),
      adminName: from === 'admin' ? (adminName || 'Администратор') : undefined, priority: priority || 'normal', broadcastId: broadcastId || undefined };
    t.messages.push(m);
    if (t.messages.length > 3000) t.messages = t.messages.slice(-3000);
    if (from === 'admin') t.adminReadAt = m.createdAt; else t.userReadAt = m.createdAt; // отправитель прочитал всё до своего сообщения
    return m;
  });
}
async function threadsSummary(usersById) {
  const d = await db.read();
  return Object.entries(d.threads).map(([userId, t]) => {
    const last = t.messages[t.messages.length - 1];
    const unread = t.messages.filter((m) => m.from === 'user' && (!t.adminReadAt || m.createdAt > t.adminReadAt)).length;
    const u = usersById.get(userId);
    return { userId, name: u ? (u.companyName || u.fullName) : 'Аккаунт удалён', fullName: u ? u.fullName : '', phone: u ? u.phone : '',
      last: last ? { text: last.text || (last.attachments.length ? '📎 ' + last.attachments[0].name : ''), at: last.createdAt, from: last.from } : null,
      unread, online: isOnline(userId), lastSeen: lastSeen(userId), count: t.messages.length };
  }).filter((x) => x.last).sort((a, b) => (a.last.at < b.last.at ? 1 : -1));
}
async function getThreadForAdmin(userId, markRead) {
  const fn = (d) => {
    const t = thread(d, userId);
    if (markRead) t.adminReadAt = new Date().toISOString();
    return { messages: t.messages.map((m) => Object.assign({}, m, { status: msgStatus(t, m), pinned: t.pinned.includes(m.id) })),
      pinned: t.pinned, online: isOnline(userId), lastSeen: lastSeen(userId) };
  };
  return markRead ? db.update(fn) : db.read().then(fn);
}
async function getThreadForUser(userId, { markRead } = {}) {
  return db.update((d) => {
    const t = thread(d, userId); const now = new Date().toISOString();
    t.userFetchedAt = now; if (markRead) t.userReadAt = now;
    const unread = t.messages.filter((m) => m.from === 'admin' && (!t.userReadAt || m.createdAt > t.userReadAt)).length;
    return { messages: t.messages.slice(-300).map((m) => ({ id: m.id, from: m.from, text: m.text, attachments: m.attachments, createdAt: m.createdAt,
      adminName: m.adminName, priority: m.priority, pinned: t.pinned.includes(m.id), read: m.from === 'user' ? !!(t.adminReadAt && t.adminReadAt >= m.createdAt) : undefined })), unread };
  });
}
async function unreadForUser(userId) {
  const d = await db.read(); const t = d.threads[userId]; if (!t) return { unread: 0, important: [] };
  const list = t.messages.filter((m) => m.from === 'admin' && (!t.userReadAt || m.createdAt > t.userReadAt));
  return { unread: list.length, important: list.filter((m) => m.priority === 'high' || m.priority === 'critical').slice(-3).map((m) => ({ id: m.id, text: m.text, priority: m.priority, createdAt: m.createdAt, adminName: m.adminName })) };
}
async function togglePin(userId, msgId) {
  return db.update((d) => { const t = thread(d, userId); if (t.pinned.includes(msgId)) t.pinned = t.pinned.filter((x) => x !== msgId); else t.pinned.push(msgId); return t.pinned; });
}
async function deleteMessage(userId, msgId) {
  return db.update((d) => { const t = thread(d, userId); const n = t.messages.length; t.messages = t.messages.filter((m) => m.id !== msgId); t.pinned = t.pinned.filter((x) => x !== msgId); return n !== t.messages.length; });
}
async function searchMessages(q, usersById) {
  const s = String(q || '').toLowerCase().trim(); if (!s) return [];
  const d = await db.read(); const out = [];
  Object.entries(d.threads).forEach(([userId, t]) => t.messages.forEach((m) => {
    if ((m.text || '').toLowerCase().includes(s) || (m.attachments || []).some((a) => a.name.toLowerCase().includes(s))) {
      const u = usersById.get(userId); out.push({ userId, name: u ? (u.companyName || u.fullName) : 'Аккаунт удалён', id: m.id, text: m.text, from: m.from, at: m.createdAt });
    }
  }));
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 100);
}
async function totalUnreadForAdmin() {
  const d = await db.read(); let n = 0;
  Object.values(d.threads).forEach((t) => { n += t.messages.filter((m) => m.from === 'user' && (!t.adminReadAt || m.createdAt > t.adminReadAt)).length; });
  return n;
}

/* ---------- рассылки ---------- */
async function createBroadcast({ audience, userIds, text, attachment, priority, sendAt, adminName }) {
  if (!['all', 'active', 'nosub', 'blocked', 'selected'].includes(audience)) throw new Error('Выберите получателей');
  if (audience === 'selected' && !(Array.isArray(userIds) && userIds.length)) throw new Error('Выберите пользователей');
  if (!String(text || '').trim() && !attachment) throw new Error('Введите текст рассылки');
  let att = null; if (attachment && attachment.dataUrl) att = saveAttachment(attachment);
  const b = { id: crypto.randomUUID(), audience, userIds: audience === 'selected' ? userIds.slice(0, 5000) : [], text: String(text || '').trim().slice(0, 5000),
    attachment: att ? { id: att.id, name: att.name, type: att.type, size: att.size, kind: kindOf(att.type) } : null,
    priority: ['normal', 'high', 'critical'].includes(priority) ? priority : 'normal',
    sendAt: sendAt && !isNaN(new Date(sendAt)) ? new Date(sendAt).toISOString() : new Date().toISOString(),
    status: 'scheduled', createdAt: new Date().toISOString(), adminName: adminName || 'Администратор', sentCount: 0 };
  await bdb.update((d) => { d.broadcasts.push(b); });
  return b;
}
async function listBroadcasts() { const d = await bdb.read(); return d.broadcasts.slice().reverse(); }
async function cancelBroadcast(id) { return bdb.update((d) => { const b = d.broadcasts.find((x) => x.id === id && x.status === 'scheduled'); if (!b) return false; b.status = 'cancelled'; return true; }); }
function audienceFilter(b, users, subOf) {
  return users.filter((u) => {
    if (b.audience === 'all') return true;
    if (b.audience === 'selected') return b.userIds.includes(u.id);
    if (b.audience === 'blocked') return !!u.blocked;
    const st = subOf(u).status;
    if (b.audience === 'active') return st !== 'expired' && !u.blocked;
    if (b.audience === 'nosub') return st === 'expired';
    return false;
  });
}
// Вызывается планировщиком: отправляет рассылки, время которых пришло
async function deliverDue(getUsers, subOf, pushSend) {
  const d = await bdb.read();
  const due = d.broadcasts.filter((b) => b.status === 'scheduled' && new Date(b.sendAt).getTime() <= Date.now());
  for (const b of due) {
    await bdb.update((x) => { const y = x.broadcasts.find((z) => z.id === b.id); if (y) y.status = 'sending'; });
    const users = audienceFilter(b, await getUsers(), subOf);
    let n = 0;
    for (const u of users) {
      await db.update((dd) => {
        const t = thread(dd, u.id);
        t.messages.push({ id: crypto.randomUUID(), from: 'admin', text: b.text, attachments: b.attachment ? [b.attachment] : [], createdAt: new Date().toISOString(),
          adminName: b.adminName, priority: b.priority, broadcastId: b.id });
      });
      n++;
      if (b.priority !== 'normal' && pushSend) pushSend(u.id, { title: b.priority === 'critical' ? '❗ Важное сообщение XCAR' : '📢 Сообщение от XCAR', body: (b.text || 'Вложение').slice(0, 200), tag: 'bc-' + b.id }).catch(() => {});
    }
    await bdb.update((x) => { const y = x.broadcasts.find((z) => z.id === b.id); if (y) { y.status = 'sent'; y.sentAt = new Date().toISOString(); y.sentCount = n; } });
  }
  return due.length;
}

// автоудаление: сообщения старше days дней; clearAll — очистить все переписки техподдержки
async function prune(days) {
  if (!days) return 0; const edge = new Date(Date.now() - days * 86400000).toISOString(); let n = 0;
  await db.update((d) => { Object.keys(d.threads).forEach((k) => { const t = d.threads[k]; const b = t.messages.length; t.messages = t.messages.filter((m) => m.createdAt >= edge); n += b - t.messages.length; }); return n; });
  return n;
}
async function clearAll() { return db.update((d) => { let n = 0; Object.values(d.threads).forEach((t) => { n += t.messages.length; t.messages = []; t.pinned = []; }); return n; }); }
async function clearThread(userId) { return db.update((d) => { const t = d.threads[userId]; if (!t) return 0; const n = t.messages.length; t.messages = []; t.pinned = []; return n; }); }
module.exports = { prune, clearAll, clearThread, touchPresence, isOnline, lastSeen, saveAttachment, readAttachment, post, threadsSummary, getThreadForAdmin, getThreadForUser, unreadForUser,
  togglePin, deleteMessage, searchMessages, totalUnreadForAdmin, createBroadcast, listBroadcasts, cancelBroadcast, deliverDue, audienceFilter };
