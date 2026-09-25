const express = require('express');
const rateLimit = require('express-rate-limit');
const { readUsers, writeUsers } = require('../lib/store');
const { readConfig, getPlanById, computeTariffAmount } = require('../lib/config');
const { publicSubscription, ensureSubscription, extendSubscription } = require('../lib/subscription');
const { createRequest } = require('../lib/requests');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();
router.use(authMiddleware);

const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много заявок подряд. Попробуйте позже.' }
});

async function getSelfUser(req) {
  const usersData = await readUsers();
  const user = usersData.users.find(u => u.id === req.userId);
  return { usersData, user };
}

// GET /api/billing/plans — список тарифов
router.get('/plans', async (req, res) => {
  const cfg = await readConfig();
  res.json({ plans: cfg.plans, trialDays: cfg.trialDays });
});

// GET /api/billing/status — актуальный статус подписки текущего аккаунта
router.get('/status', async (req, res) => {
  const { usersData, user } = await getSelfUser(req);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const cfg = await readConfig();
  if (ensureSubscription(user, cfg)) await writeUsers(usersData);
  res.json({ subscription: publicSubscription(user.subscription, cfg) });
});

const ALLOWED_MONTHS = [1, 3, 6, 12];

// POST /api/billing/request  { planId, months, contactPhone, clientName, paymentBank }
// Пользователь выбрал/решил продлить тариф на определённый срок (1/3/6/12 мес) —
// фиксируем заявку (администратор увидит её в /admin как уведомление, со счётчиком
// новых заявок) и сразу отдаём реквизиты для перевода (в т.ч. QR-код, если админ его
// загрузил) вместе с посчитанной на сервере суммой (цена тарифа × количество месяцев —
// не доверяем сумме, присланной клиентом).
router.post('/request', requestLimiter, async (req, res) => {
  const { planId, months, contactPhone, clientName, paymentBank } = req.body || {};
  const cfg = await readConfig();
  const plan = getPlanById(cfg, planId);
  if (!plan) return res.status(400).json({ error: 'Неизвестный тариф' });

  const m = Number(months) || 1;
  if (!ALLOWED_MONTHS.includes(m)) {
    return res.status(400).json({ error: 'Срок подписки должен быть 1, 3, 6 или 12 месяцев' });
  }

  const { user } = await getSelfUser(req);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const amount = computeTariffAmount(plan.price, m);
  const request = await createRequest(user.id, plan.id, m, contactPhone, clientName, paymentBank);
  res.json({ ok: true, request, plan, months: m, amount, payment: cfg.payment });
});

// POST /api/billing/activate-free  { planId }
// Активация бесплатного тарифа (0 ₽) — в отличие от /request, не создаёт
// заявку и не ждёт подтверждения администратора: подписка продлевается
// сразу же, на много лет вперёд (фактически бессрочно). Доступно только для
// тарифов с price === 0 — эта проверка на сервере обязательна: без неё
// подделанный клиентом запрос с planId платного тарифа мог бы получить его
// бесплатно, в обход обычного сценария оплаты и подтверждения заявки.
router.post('/activate-free', requestLimiter, async (req, res) => {
  const { planId } = req.body || {};
  const cfg = await readConfig();
  const plan = getPlanById(cfg, planId);
  if (!plan) return res.status(400).json({ error: 'Неизвестный тариф' });
  if (plan.price !== 0) return res.status(400).json({ error: 'Этот тариф не бесплатный' });

  const { usersData, user } = await getSelfUser(req);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  user.subscription = extendSubscription(user.subscription, plan.id, 1200, cfg);
  await writeUsers(usersData);
  res.json({ ok: true, subscription: publicSubscription(user.subscription, cfg) });
});

module.exports = router;
