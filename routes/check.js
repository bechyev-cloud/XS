// «Проверка клиента» в приложении: поиск по общей базе пользователей XCAR
// и по базе, загруженной администратором (TXT/HTML, в т.ч. экспорт Telegram).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../lib/auth');
const { readUsers } = require('../lib/store');
const share = require('../lib/checkshare');
const blacklist = require('../lib/control/blacklist');

const router = express.Router();
router.use(authMiddleware);
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком много запросов. Подождите минуту.' } });

router.get('/stats', async (req, res) => {
  const bi = await blacklist.info();
  res.json({ xcar: share.stats(req.userId), telegram: { files: bi.files.length, total: bi.total, updatedAt: bi.updatedAt }, share: share.status(req.userId) });
});
router.get('/search', limiter, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  const hashes = String(req.query.h || '').split(',').filter(Boolean).slice(0, 4);
  const src = String(req.query.src || 'all');
  if (q.length < 2 && !hashes.length) return res.json({ xcar: [], telegram: [] });
  const out = { xcar: [], telegram: [] };
  // базы других пользователей доступны только тем, кто сам делится базой онлайн
  out.xcarLocked = !share.status(req.userId).enabled;
  if (!out.xcarLocked && (src === 'all' || src === 'xcar')) out.xcar = share.search(q, hashes, req.userId);
  if ((src === 'all' || src === 'telegram') && q.length >= 2) {
    const bi = await blacklist.info(); const names = {}; bi.files.forEach((f) => { names[f.id] = f.name; });
    out.telegram = (await blacklist.search(q, [])).slice(0, 100).map((e) => ({ id: e.id, title: e.title, text: e.text, file: names[String(e.id).split(':')[0]] || 'База', addedAt: e.addedAt }));
  }
  res.json(out);
});
router.get('/share', (req, res) => { res.json(share.status(req.userId)); });
router.put('/share', express.json({ limit: '15mb' }), async (req, res) => {
  const users = await readUsers(); const u = users.users.find((x) => x.id === req.userId) || {};
  const o = share.setShare(req.userId, (req.body || {}).company || u.companyName || u.fullName || 'Компания', req.body || {});
  res.json({ ok: true, count: o.clients.length, updatedAt: o.updatedAt });
});
router.delete('/share', (req, res) => { share.removeShare(req.userId); res.json({ ok: true }); });
module.exports = router;
