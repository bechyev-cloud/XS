// Новости (для клиента) и общая группа-чат пользователей XCAR.
// Админская часть — в routes/admin.js (/api/admin/news, /api/admin/chat...).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../lib/auth');
const { readUsers } = require('../lib/store');
const c = require('../lib/community');

const router = express.Router();
router.use(authMiddleware);

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Слишком часто. Подождите немного перед следующим сообщением.' },
});

// ---- Новости ----
router.get('/news', async (req, res) => {
  res.json({ news: await c.listNewsForUser(req.userId) });
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
function chatView(chat, userId, after) {
  let messages = chat.messages;
  if (after) { const i = messages.findIndex((m) => m.id === after); if (i >= 0) messages = messages.slice(i + 1); else messages = messages.slice(-150); }
  else messages = messages.slice(-150);
  return {
    closed: !!chat.closed,
    banned: (chat.bans || []).includes(userId),
    messages: messages.map((m) => ({ id: m.id, name: m.name, text: m.text, createdAt: m.createdAt, fromAdmin: !!m.fromAdmin, mine: m.userId === userId })),
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
  if (chat.closed) return res.status(403).json({ error: 'Администратор закрыл группу — писать может только он' });
  if ((chat.bans || []).includes(req.userId)) return res.status(403).json({ error: 'Администратор запретил вам писать в группу' });
  const users = await readUsers();
  const u = users.users.find((x) => x.id === req.userId) || {};
  const name = (u.companyName || u.fullName || 'Пользователь') + (u.companyName && u.fullName ? ' · ' + u.fullName : '');
  const m = await c.postMessage({ userId: req.userId, name, text });
  res.json({ ok: true, id: m.id });
});

module.exports = router;
