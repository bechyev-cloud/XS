const express = require('express');
const { authMiddleware } = require('../lib/auth');
const push = require('../lib/push');

const router = express.Router();

// GET /api/push/vapid-public-key — публичный ключ, нужен клиенту ДО входа в
// подписку (PushManager.subscribe), поэтому без авторизации.
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: push.getPublicKey() });
});

// POST /api/push/subscribe  { subscription }
router.post('/subscribe', authMiddleware, async (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Некорректная подписка' });
  }
  push.addSubscription(req.userId, subscription);
  res.json({ ok: true });
  // Тестовое уведомление сразу после подписки — подтверждает пользователю,
  // что всё настроено и работает, не дожидаясь реального события. Не
  // блокирует ответ клиенту.
  push.sendToUser(req.userId, {
    title: 'XCAR — уведомления включены',
    body: 'Готово! Сюда будут приходить напоминания о просроченных арендах, ТО и новых платежах.',
    tag: 'push-welcome',
  }).catch(() => {});
});

// POST /api/push/unsubscribe  { endpoint }
router.post('/unsubscribe', authMiddleware, async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) push.removeSubscription(req.userId, endpoint);
  res.json({ ok: true });
});

module.exports = router;
