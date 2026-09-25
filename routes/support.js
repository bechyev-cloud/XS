const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../lib/auth');
const { createTicket } = require('../lib/support');

const router = express.Router();

const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много обращений. Попробуйте позже.' }
});

// POST /api/support — клиент сообщает о своей проблеме супер-админу
// (Настройки → Тех. поддержка). Список обращений и их закрытие — на стороне
// администратора, см. GET/POST /api/admin/support[...] в routes/admin.js.
router.post('/', authMiddleware, supportLimiter, async (req, res) => {
  const { message, contactPhone } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Опишите проблему' });
  }
  const ticket = await createTicket(req.userId, message, contactPhone);
  res.json({ ok: true, ticket: { id: ticket.id, createdAt: ticket.createdAt } });
});

module.exports = router;
