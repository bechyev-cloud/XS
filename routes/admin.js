const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const {
  readUsers, writeUsers, readStore, writeStore, writeStoreKey,
  deleteStore, storeCounts, EMPTY_STORE
} = require('../lib/store');
const { hashPassword, signAdminToken, adminAuthMiddleware } = require('../lib/auth');
const { readConfig, writeConfig, computeTariffAmount } = require('../lib/config');
const { listRequests, resolveRequest } = require('../lib/requests');
const { listTickets, closeTicket } = require('../lib/support');
const push = require('../lib/push');
const { extendSubscription, publicSubscription, ensureSubscription, trialSubscription } = require('../lib/subscription');

const router = express.Router();
const ALLOWED_KEYS = Object.keys(EMPTY_STORE);

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуйте позже.' }
});

function normalizePhone(p) { return p ? String(p).replace(/[^\d+]/g, '') : ''; }
function normalizeEmail(e) { return String(e || '').trim().toLowerCase(); }
function publicUser(u, cfg) {
  return {
    id: u.id,
    fullName: u.fullName,
    companyName: u.companyName,
    phone: u.phone,
    email: u.email,
    createdAt: u.createdAt,
    createdByAdmin: !!u.createdByAdmin,
    blocked: !!u.blocked,
    blockedAt: u.blockedAt || null,
    subscription: cfg ? publicSubscription(u.subscription, cfg) : undefined
  };
}

// POST /api/admin/login  { password }
// Единственный админ-аккаунт задаётся паролем в переменной окружения ADMIN_PASSWORD —
// это вы, владелец сервиса, а не один из обычных пользователей приложения.
router.post('/login', adminLoginLimiter, (req, res) => {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured || !configured.trim()) {
    return res.status(500).json({
      error: 'Пароль администратора не настроен на сервере (переменная окружения ADMIN_PASSWORD)'
    });
  }
  const { password } = req.body || {};
  if (!password || password !== configured) {
    return res.status(401).json({ error: 'Неверный пароль администратора' });
  }
  res.json({ token: signAdminToken() });
});

// Всё, что ниже, требует действующего admin-токена.
router.use(adminAuthMiddleware);

// GET /api/admin/stats — общая сводка по сервису
router.get('/stats', async (req, res) => {
  const usersData = await readUsers();
  let cars = 0, clients = 0, contracts = 0;
  usersData.users.forEach(u => {
    const c = storeCounts(u.id);
    cars += c.cars; clients += c.clients; contracts += c.contracts;
  });
  res.json({
    usersCount: usersData.users.length,
    cars, clients, contracts
  });
});

// GET /api/admin/users — список всех зарегистрированных аккаунтов + счётчики данных
router.get('/users', async (req, res) => {
  const usersData = await readUsers();
  const cfg = await readConfig();
  let changed = false;
  usersData.users.forEach(u => { if (ensureSubscription(u, cfg)) changed = true; });
  if (changed) await writeUsers(usersData);
  const list = usersData.users
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(u => Object.assign({}, publicUser(u, cfg), { counts: storeCounts(u.id) }));
  res.json({ users: list });
});

// GET /api/admin/users/:id — карточка аккаунта + вся его база данных
router.get('/users/:id', async (req, res) => {
  const usersData = await readUsers();
  const user = usersData.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Аккаунт не найден' });
  const cfg = await readConfig();
  if (ensureSubscription(user, cfg)) await writeUsers(usersData);
  const store = await readStore(user.id);
  res.json({ user: publicUser(user, cfg), store });
});

// POST /api/admin/users — создать новый аккаунт вручную из панели
router.post('/users', async (req, res) => {
  try {
    const { fullName, companyName, phone, email, password } = req.body || {};
    if (!fullName || !companyName || !phone || !password) {
      return res.status(400).json({ error: 'Заполните имя, компанию, телефон и пароль' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
    }
    const phoneN = normalizePhone(phone);
    const emailN = normalizeEmail(email);

    const usersData = await readUsers();
    const exists = usersData.users.find(u => (phoneN && u.phone === phoneN) || (emailN && u.email === emailN));
    if (exists) return res.status(409).json({ error: 'Аккаунт с таким телефоном или e-mail уже существует' });

    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const cfg = await readConfig();
    const user = {
      id: crypto.randomUUID(),
      fullName: String(fullName).trim(),
      companyName: String(companyName).trim(),
      phone: phoneN,
      email: emailN || null,
      passwordHash,
      createdAt: now,
      createdByAdmin: true,
      consents: {
        // аккаунт создан администратором вручную, а не через форму регистрации —
        // фиксируем это отдельно, а не подделываем "согласие" от имени пользователя
        personalData: { accepted: false, grantedByAdmin: true, acceptedAt: now },
        offer: { accepted: false, grantedByAdmin: true, acceptedAt: now }
      },
      subscription: trialSubscription(cfg)
    };
    usersData.users.push(user);
    await writeUsers(usersData);
    res.json({ user: publicUser(user, cfg) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// PUT /api/admin/users/:id — исправить основные данные аккаунта
router.put('/users/:id', async (req, res) => {
  const usersData = await readUsers();
  const user = usersData.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Аккаунт не найден' });

  const { fullName, companyName, phone, email } = req.body || {};
  if (fullName !== undefined) user.fullName = String(fullName).trim();
  if (companyName !== undefined) user.companyName = String(companyName).trim();
  if (phone !== undefined) user.phone = normalizePhone(phone);
  if (email !== undefined) user.email = normalizeEmail(email) || null;

  await writeUsers(usersData);
  const cfg = await readConfig();
  res.json({ user: publicUser(user, cfg) });
});

// PUT /api/admin/users/:id/password — сбросить/задать пароль аккаунта
router.put('/users/:id/password', async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
  }
  const usersData = await readUsers();
  const user = usersData.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Аккаунт не найден' });

  user.passwordHash = await hashPassword(password);
  await writeUsers(usersData);
  res.json({ ok: true });
});

// PUT /api/admin/users/:id/block { blocked: true|false } — заблокировать/разблокировать
// нежелательного клиента: блокировка запрещает и вход (см. routes/auth.js), и
// использование уже выданного токена (см. authMiddleware в lib/auth.js) — то есть
// и "заблокировать клиента на сервере", и "заблокировать приложение клиента"
// из одного и того же запроса пользователя (раздел 20) реализованы одним флагом.
router.put('/users/:id/block', async (req, res) => {
  const usersData = await readUsers();
  const user = usersData.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Аккаунт не найден' });

  const { blocked } = req.body || {};
  user.blocked = !!blocked;
  user.blockedAt = user.blocked ? new Date().toISOString() : null;
  await writeUsers(usersData);
  const cfg = await readConfig();
  res.json({ user: publicUser(user, cfg) });
});

// DELETE /api/admin/users/:id — удалить аккаунт целиком (профиль + все его данные)
router.delete('/users/:id', async (req, res) => {
  const usersData = await readUsers();
  const idx = usersData.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Аккаунт не найден' });

  usersData.users.splice(idx, 1);
  await writeUsers(usersData);
  await deleteStore(req.params.id);
  res.json({ ok: true });
});

// PUT /api/admin/users/:id/data/:key — исправить/добавить данные конкретного аккаунта
// (машины, клиенты, договоры и т.д. — тот же формат, что хранит сам клиент)
router.put('/users/:id/data/:key', async (req, res) => {
  const usersData = await readUsers();
  const user = usersData.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Аккаунт не найден' });

  const key = req.params.key;
  if (!ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Неизвестный раздел данных: ' + key });

  const { value } = req.body || {};
  await writeStoreKey(user.id, key, value === undefined ? null : value);
  res.json({ ok: true, updatedAt: new Date().toISOString() });
});

// PUT /api/admin/users/:id/subscription — вручную продлить/изменить тариф аккаунта
// (без заявки — например, если оплата пришла напрямую и клиент ничего не нажимал)
router.put('/users/:id/subscription', async (req, res) => {
  const usersData = await readUsers();
  const user = usersData.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Аккаунт не найден' });

  const { planId, months } = req.body || {};
  const cfg = await readConfig();
  const m = Number(months);
  if (!planId || !Number.isFinite(m) || m <= 0) {
    return res.status(400).json({ error: 'Укажите тариф и количество месяцев (> 0)' });
  }
  let sub;
  try {
    sub = extendSubscription(user.subscription, planId, m, cfg);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  user.subscription = sub;
  await writeUsers(usersData);
  res.json({ user: publicUser(user, cfg) });
});

// ---- Заявки на выбор/продление тарифа ("уведомления от пользователя") ----

// GET /api/admin/payment-requests — список заявок (новые сверху), с данными
// пользователя и тарифа, чтобы в панели не делать отдельных запросов.
router.get('/payment-requests', async (req, res) => {
  const usersData = await readUsers();
  const cfg = await readConfig();
  const requests = await listRequests();
  const enriched = requests.map(r => {
    const user = usersData.users.find(u => u.id === r.userId);
    const plan = cfg.plans.find(p => p.id === r.planId);
    const months = r.months || 1;
    return Object.assign({}, r, {
      months,
      amount: plan ? computeTariffAmount(plan.price, months) : null, // сумма к переводу (тариф × срок, со скидкой за срок — см. TARIFF_DISCOUNTS в lib/config.js)
      user: user ? { id: user.id, fullName: user.fullName, companyName: user.companyName, phone: user.phone } : null,
      plan: plan || null
    });
  });
  const pendingCount = enriched.filter(r => r.status === 'pending').length;
  res.json({ requests: enriched, pendingCount });
});

// POST /api/admin/payment-requests/:id/approve  { months }
// Подтверждаем, что оплата от клиента получена, и продлеваем подписку на
// оплаченный срок (сколько месяцев решает администратор — оплата идёт вручную,
// переводом, см. /api/billing/request).
router.post('/payment-requests/:id/approve', async (req, res) => {
  const requests = await listRequests();
  const request = requests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'Заявка не найдена' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });

  const months = Number(req.body && req.body.months);
  if (!Number.isFinite(months) || months <= 0) {
    return res.status(400).json({ error: 'Укажите количество оплаченных месяцев (> 0)' });
  }

  const usersData = await readUsers();
  const user = usersData.users.find(u => u.id === request.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь по заявке не найден' });

  const cfg = await readConfig();
  let sub;
  try {
    sub = extendSubscription(user.subscription, request.planId, months, cfg);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  user.subscription = sub;
  await writeUsers(usersData);

  const resolved = await resolveRequest(request.id, 'approved', months);
  res.json({ ok: true, request: resolved, user: publicUser(user, cfg) });
});

// POST /api/admin/payment-requests/:id/reject — отклонить заявку (оплата не пришла и т.п.)
router.post('/payment-requests/:id/reject', async (req, res) => {
  const requests = await listRequests();
  const request = requests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'Заявка не найдена' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });
  const resolved = await resolveRequest(request.id, 'rejected');
  res.json({ ok: true, request: resolved });
});

// ---- Настройки: тарифы, пробный период, реквизиты для перевода ----

// GET /api/admin/settings
router.get('/settings', async (req, res) => {
  const cfg = await readConfig();
  res.json({ config: cfg });
});

// PUT /api/admin/settings  { plans, trialDays, payment, notify }
router.put('/settings', async (req, res) => {
  const { plans, trialDays, payment, notify } = req.body || {};
  if (!Array.isArray(plans) || !plans.length) {
    return res.status(400).json({ error: 'Список тарифов не может быть пустым' });
  }
  for (const p of plans) {
    if (!p.id || !p.name || !Number.isFinite(Number(p.carLimit)) || !Number.isFinite(Number(p.price))) {
      return res.status(400).json({ error: 'У каждого тарифа должны быть id, название, лимит машин и цена' });
    }
  }
  const td = Number(trialDays);
  if (!Number.isFinite(td) || td < 0) {
    return res.status(400).json({ error: 'Пробный период должен быть числом дней (≥ 0)' });
  }
  const next = {
    plans: plans.map(p => ({
      id: String(p.id),
      name: String(p.name).trim(),
      carLimit: Math.max(0, Math.round(Number(p.carLimit))),
      price: Math.max(0, Math.round(Number(p.price)))
    })),
    trialDays: Math.round(td),
    payment: {
      holder: String((payment && payment.holder) || '').trim(),
      bank: String((payment && payment.bank) || '').trim(),
      cardNumber: String((payment && payment.cardNumber) || '').trim(),
      phone: String((payment && payment.phone) || '').trim(),
      comment: String((payment && payment.comment) || '').trim(),
      qrCodeImage: String((payment && payment.qrCodeImage) || '')
    },
    notify: {
      smtp: {
        host: String((notify && notify.smtp && notify.smtp.host) || '').trim(),
        port: Math.max(1, Math.round(Number((notify && notify.smtp && notify.smtp.port)) || 587)),
        secure: !!(notify && notify.smtp && notify.smtp.secure),
        user: String((notify && notify.smtp && notify.smtp.user) || '').trim(),
        pass: String((notify && notify.smtp && notify.smtp.pass) || ''),
        from: String((notify && notify.smtp && notify.smtp.from) || '').trim()
      },
      sms: {
        login: String((notify && notify.sms && notify.sms.login) || '').trim(),
        password: String((notify && notify.sms && notify.sms.password) || ''),
        sender: String((notify && notify.sms && notify.sms.sender) || '').trim()
      }
    }
  };
  const saved = await writeConfig(next);
  res.json({ config: saved });
});

// ---- Тех. поддержка: обращения клиентов (раздел 20) ----

// GET /api/admin/support — список обращений (новые сверху), с данными
// клиента, чтобы в панели не делать отдельных запросов (тот же паттерн, что
// и у /payment-requests выше).
router.get('/support', async (req, res) => {
  const usersData = await readUsers();
  const tickets = await listTickets();
  const enriched = tickets.map(t => {
    const user = usersData.users.find(u => u.id === t.userId);
    return Object.assign({}, t, {
      user: user ? { id: user.id, fullName: user.fullName, companyName: user.companyName, phone: user.phone } : null
    });
  });
  const openCount = enriched.filter(t => t.status === 'open').length;
  res.json({ tickets: enriched, openCount });
});

// POST /api/admin/support/:id/close — отметить обращение решённым
router.post('/support/:id/close', async (req, res) => {
  const ticket = await closeTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });
  res.json({ ok: true, ticket });
});

// ---- Новости всем клиентам приложения (раздел 20) ----

// POST /api/admin/broadcast { title, body } — рассылает push-уведомление
// сразу всем клиентам, у кого включены и активны push-уведомления (те же
// подписки, что уже используются для напоминаний о просрочке/ТО/платежах,
// см. lib/push.js и раздел 16.2) — отдельного экрана "центра уведомлений"
// внутри приложения не заводилось, новость приходит как обычный push в
// системный центр уведомлений телефона.
router.post('/broadcast', async (req, res) => {
  const { title, body } = req.body || {};
  const text = String(body || '').trim();
  if (!text) return res.status(400).json({ error: 'Введите текст новости' });
  const userIds = push.allUserIdsWithSubs();
  let sent = 0;
  for (const userId of userIds) {
    try {
      const r = await push.sendToUser(userId, {
        title: String(title || '').trim() || 'XCAR — новость',
        body: text,
        tag: 'admin-broadcast'
      });
      sent += r.sent || 0;
    } catch (e) {
      console.error('broadcast: не удалось отправить пользователю', userId, e && e.message);
    }
  }
  res.json({ ok: true, usersNotified: userIds.length, sent });
});

module.exports = router;
