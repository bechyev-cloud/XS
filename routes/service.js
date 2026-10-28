// Сервисные контакты между пользователями XCAR (см. lib/servicedb.js)
const express = require('express');
const { authMiddleware } = require('../lib/auth');
const svc = require('../lib/servicedb');
const router = express.Router();
router.use(authMiddleware);
router.get('/status', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(Object.assign({ ok: true }, svc.status(req.userId))); });
router.post('/share', (req, res) => {
  const b = req.body || {};
  if (b.enabled === false) return res.json(svc.removeShare(req.userId));
  res.json(svc.setShare(req.userId, b.company, b.items));
});
// видят контакты других только те, кто сам делится своими
router.get('/list', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!svc.status(req.userId).enabled) return res.json({ ok: true, locked: true, items: [] });
  res.json({ ok: true, items: svc.list(req.userId) });
});
module.exports = router;
