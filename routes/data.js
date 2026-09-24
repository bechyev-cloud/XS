const express = require('express');
const { authMiddleware } = require('../lib/auth');
const { readStore, writeStore, writeStoreKey, readUsers, EMPTY_STORE } = require('../lib/store');
const { readConfig } = require('../lib/config');
const { computeStatus, trialSubscription } = require('../lib/subscription');
const push = require('../lib/push');

const router = express.Router();
const ALLOWED_KEYS = Object.keys(EMPTY_STORE);

// Лимит машин по тарифу — единственное ограничение, которое проверяется прямо
// на сервере (а не только в интерфейсе), т.к. это простое численное правило
// на одном эндпоинте. Остальные ограничения (расход/доход/новый договор при
// истёкшей подписке) — на стороне клиента, см. server/README.md.
async function checkCarLimit(userId, newCars) {
  if (!Array.isArray(newCars)) return null;
  const usersData = await readUsers();
  const user = usersData.users.find(u => u.id === userId);
  if (!user) return null;
  const cfg = await readConfig();
  const sub = user.subscription || trialSubscription(cfg);
  const limit = sub.carLimit || 0;
  if (newCars.length > limit) {
    return `Превышен лимит машин по вашему тарифу (${limit}). Выберите тариф с большим лимитом в приложении → Настройки → Тариф.`;
  }
  return null;
}

// GET /api/data — вся база текущего пользователя одним объектом
// (cars, clients, contracts, clientLedger, oilChanges, sharedClients,
//  sharedClientSources, settings) — те же ключи, что клиент хранит в localStorage.
router.get('/', authMiddleware, async (req, res) => {
  const store = await readStore(req.userId);
  res.json(store);
});

// PUT /api/data — заменить всю базу целиком (используется редко,
// например при полном восстановлении из бэкапа)
router.put('/', authMiddleware, async (req, res) => {
  const body = req.body || {};
  if (body.cars !== undefined) {
    const err = await checkCarLimit(req.userId, body.cars);
    if (err) return res.status(403).json({ error: err });
  }
  const next = Object.assign({}, EMPTY_STORE);
  ALLOWED_KEYS.forEach(k => {
    if (body[k] !== undefined) next[k] = body[k];
  });
  await writeStore(req.userId, next);
  res.json({ ok: true, updatedAt: new Date().toISOString() });
});

// PUT /api/data/:key — сохранить один раздел данных (основной путь синхронизации:
// приложение шлёт сюда изменения по мере работы, как раньше писало в localStorage)
router.put('/:key', authMiddleware, async (req, res) => {
  const key = req.params.key;
  if (!ALLOWED_KEYS.includes(key)) {
    return res.status(400).json({ error: 'Неизвестный ключ данных: ' + key });
  }
  const { value } = req.body || {};
  if (key === 'cars') {
    const err = await checkCarLimit(req.userId, value);
    if (err) return res.status(403).json({ error: err });
  }
  // Push-уведомление о новом платеже — сравниваем присланный clientLedger со
  // старой версией на диске и находим записи типа 'payment', которых раньше
  // не было (по id). Само определение "что нового" возможно только здесь:
  // клиент шлёт сюда весь массив целиком (обычный путь синхронизации), без
  // отдельного эндпоинта "добавить платёж".
  let newPayments = [];
  if (key === 'clientLedger' && Array.isArray(value)) {
    try {
      const prev = await readStore(req.userId);
      const prevIds = new Set((prev.clientLedger || []).map(l => l && l.id));
      newPayments = value.filter(l => l && l.type === 'payment' && !prevIds.has(l.id));
    } catch (e) { /* уведомление не критично — не мешаем сохранению данных */ }
  }
  await writeStoreKey(req.userId, key, value === undefined ? null : value);
  res.json({ ok: true, updatedAt: new Date().toISOString() });
  if (newPayments.length) {
    newPayments.forEach(p => {
      push.sendToUser(req.userId, {
        title: '💳 Новый платёж',
        body: `Поступил платёж ${p.amount || 0} ₽` + (p.note ? ` — ${p.note}` : ''),
        tag: 'payment-' + p.id,
      }).catch(() => {});
    });
  }
});

module.exports = router;
