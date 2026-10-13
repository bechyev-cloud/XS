// Новости (для клиента) и общая группа-чат пользователей XCAR.
// Админская часть — в routes/admin.js (/api/admin/news, /api/admin/chat...).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../lib/auth');
const { readUsers } = require('../lib/store');
const c = require('../lib/community');

const dm = require('../lib/control/messages');

const router = express.Router();
// ссылки на вложения открываются в <img>/новой вкладке — токен можно передать в ?t=
router.use((req, res, next) => { if (!req.headers.authorization && req.query.t) req.headers.authorization = 'Bearer ' + String(req.query.t); next(); });
router.use(authMiddleware);

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Слишком часто. Подождите немного перед следующим сообщением.' },
});

// ---- Новости ----
router.get('/news', async (req, res) => {
  const users = await readUsers(); const u = users.users.find((x) => x.id === req.userId);
  res.json({ news: await c.listNewsForUser(req.userId, u && u.createdAt) });
});
router.post('/news/:id/seen', async (req, res) => {
  const n = await c.markNewsSeen(req.params.id, req.userId);
  if (!n) return res.status(404).json({ error: 'Новость не найдена' });
  res.json({ news: n });
});
router.post('/news/:id/rate', async (req, res) => {
  const stars = Math.round(Number((req.body || {}).stars));
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Оценка — от 1 до 5 звёзд' });
  const n = await c.rateNews(req.params.id, req.userId, stars);
  if (!n) return res.status(404).json({ error: 'Новость не найдена' });
  res.json({ news: n });
});

// ---- Общая группа ----
// Модераторы (назначает администратор в XCAR CONTROL) могут писать в закрытую группу,
// удалять сообщения участников и запрещать им писать.
function userName(u) { return u ? ((u.companyName || u.fullName || 'Пользователь') + (u.companyName && u.fullName ? ' · ' + u.fullName : '')) : 'Пользователь'; }
function chatView(chat, userId, after) {
  const mods = chat.mods || []; const bans = chat.bans || []; const isMod = mods.includes(userId);
  let messages = chat.messages;
  if (after) { const i = messages.findIndex((m) => m.id === after); if (i >= 0) messages = messages.slice(i + 1); else messages = messages.slice(-150); }
  else messages = messages.slice(-150);
  return {
    closed: !!chat.closed, banned: bans.includes(userId), isMod, delRev: chat.delRev || 0,
    messages: messages.map((m) => Object.assign({ id: m.id, name: m.name, text: m.text, createdAt: m.createdAt, fromAdmin: !!m.fromAdmin,
      mod: !!m.userId && mods.includes(m.userId), mine: m.userId === userId, uid: m.userId || null },
      isMod && m.userId ? { authorBanned: bans.includes(m.userId) } : {})),
    lastId: chat.messages.length ? chat.messages[chat.messages.length - 1].id : null,
  };
}
router.get('/chat', async (req, res) => {
  const chat = await c.readChat();
  res.json(chatView(chat, req.userId, req.query.after));
});
router.post('/chat', chatLimiter, async (req, res) => {
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Введите сообщение' });
  const chat = await c.readChat();
  const isMod = (chat.mods || []).includes(req.userId);
  if (chat.closed && !isMod) return res.status(403).json({ error: 'Администратор закрыл группу — писать могут только администратор и модераторы' });
  if ((chat.bans || []).includes(req.userId)) return res.status(403).json({ error: 'Вам запрещено писать в группу' });
  const users = await readUsers();
  const u = users.users.find((x) => x.id === req.userId);
  const m = await c.postMessage({ userId: req.userId, name: userName(u), text, fromMod: isMod });
  res.json({ ok: true, id: m.id });
});
async function needMod(req, res) {
  const chat = await c.readChat();
  if (!(chat.mods || []).includes(req.userId)) { res.status(403).json({ error: 'Только модератор группы может это сделать' }); return null; }
  return chat;
}
router.delete('/chat/messages/:id', async (req, res) => {
  const chat = await needMod(req, res); if (!chat) return;
  const m = chat.messages.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Сообщение уже удалено' });
  if (m.fromAdmin) return res.status(403).json({ error: 'Сообщение администратора удалить нельзя' });
  if (m.userId !== req.userId && (chat.mods || []).includes(m.userId)) return res.status(403).json({ error: 'Сообщение другого модератора удалить нельзя' });
  await c.deleteMessage(m.id); res.json({ ok: true });
});
router.post('/chat/ban', async (req, res) => {
  const chat = await needMod(req, res); if (!chat) return;
  const { userId, banned } = req.body || {};
  if (!userId || userId === req.userId) return res.status(400).json({ error: 'Неверный пользователь' });
  if ((chat.mods || []).includes(userId)) return res.status(403).json({ error: 'Модератора может ограничить только администратор' });
  await c.setChatBan(userId, !!banned); res.json({ ok: true });
});

// ---- Личные сообщения между пользователями ----
const pm = require('../lib/pm');
const { isOnline } = require('../lib/control/messages');
const pmLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком часто. Подождите немного.' } });
function pubUser(u) { return { userId: u.id, name: u.companyName || u.fullName || 'Пользователь', sub: u.companyName && u.fullName ? u.fullName : '', online: isOnline(u.id) }; }
router.get('/pm', async (req, res) => {
  const [d, users] = await Promise.all([pm.snapshot(), readUsers()]);
  const byId = {}; users.users.forEach((u) => { byId[u.id] = u; });
  const list = pm.dialogs(d, req.userId).filter((x) => byId[x.userId]).map((x) => Object.assign(pubUser(byId[x.userId]), x))
    .sort((a, b) => ((b.last && b.last.createdAt) || '').localeCompare((a.last && a.last.createdAt) || '') || a.name.localeCompare(b.name));
  res.json({ dialogs: list, banned: (d.banned || []).includes(req.userId) });
});
router.get('/pm/unread', async (req, res) => { res.json({ unread: await pm.unread(req.userId) }); });
router.get('/pm/search', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const digits = q.replace(/\D/g, '');
  const [d, users] = await Promise.all([pm.snapshot(), readUsers()]);
  const mine = new Set(d.contacts[req.userId] || []);
  const found = users.users.filter((u) => u.id !== req.userId && !u.blocked && !u.deletedAt && (
    ((u.companyName || '') + ' ' + (u.fullName || '')).toLowerCase().includes(q) ||
    (digits.length >= 5 && String(u.phone || '').replace(/\D/g, '').endsWith(digits))))
    .slice(0, 30).map((u) => Object.assign(pubUser(u), { contact: mine.has(u.id) }));
  res.json({ users: found });
});
async function existingUser(id) { const users = await readUsers(); return users.users.find((u) => u.id === id); }
router.post('/pm/contacts', async (req, res) => {
  const { userId, on } = req.body || {};
  if (!userId || userId === req.userId || !(await existingUser(userId))) return res.status(400).json({ error: 'Пользователь не найден' });
  await pm.setContact(req.userId, userId, on !== false); res.json({ ok: true });
});
router.post('/pm/block', async (req, res) => {
  const { userId, on } = req.body || {};
  if (!userId || userId === req.userId) return res.status(400).json({ error: 'Пользователь не найден' });
  await pm.setBlock(req.userId, userId, on !== false); res.json({ ok: true });
});
router.get('/pm/t/:uid', async (req, res) => {
  const u = await existingUser(req.params.uid); if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(Object.assign({ user: pubUser(u) }, await pm.thread(req.userId, u.id, req.query.read === '1')));
});
router.post('/pm/t/:uid', pmLimiter, async (req, res) => {
  const u = await existingUser(req.params.uid); if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  try { const m = await pm.send(req.userId, u.id, (req.body || {}).text); res.json({ ok: true, id: m.id }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Личные сообщения с администрацией XCAR (XCAR CONTROL → Сообщения) ----
const dmLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком часто. Подождите немного.' } });
router.get('/dm', async (req, res) => { res.json(await dm.getThreadForUser(req.userId, { markRead: req.query.read === '1' })); });
router.get('/dm/unread', async (req, res) => { res.json(await dm.unreadForUser(req.userId)); });
router.post('/dm', dmLimiter, async (req, res) => {
  const b = req.body || {};
  try { const m = await dm.post(req.userId, { from: 'user', text: b.text, attachments: b.attachments }); res.json({ ok: true, id: m.id }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/attachments/:id', async (req, res) => {
  const a = dm.readAttachment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Файл не найден' });
  const t = await dm.getThreadForUser(req.userId, {});
  if (!t.messages.some((m) => (m.attachments || []).some((x) => x.id === req.params.id))) return res.status(404).json({ error: 'Файл не найден' });
  res.setHeader('Content-Type', a.meta.type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.meta.name)}`);
  res.sendFile(a.file);
});

module.exports = router;
