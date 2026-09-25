const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { readUsers, writeUsers } = require('../lib/store');
const { hashPassword, comparePassword, signToken, authMiddleware } = require('../lib/auth');
const { readConfig } = require('../lib/config');
const { trialSubscription, publicSubscription, ensureSubscription } = require('../lib/subscription');
const { sendResetEmail } = require('../lib/mailer');
const { sendResetSms } = require('../lib/sms');

const router = express.Router();

// Ограничиваем перебор пароля / спам-регистрации.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Попробуйте позже.' }
});

// Восстановление пароля — отдельный лимит (каждый запрос кода шлёт настоящее
// письмо/SMS, перебор кода тоже не должен быть дешёвым). При этом обычный
// сценарий "запросить код → пару раз ошибиться → запросить код заново →
// ввести верно" — это уже 4-6 запросов на /forgot+/reset, поэтому лимит
// выше, чем может показаться нужным на первый взгляд, — с запасом под общий
// IP в офисе/за NAT, где восстанавливать пароль может не один человек.
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Попробуйте позже.' }
});
const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const RESET_RESEND_COOLDOWN_MS = 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;

function normalizePhone(p) {
  if (!p) return '';
  return String(p).replace(/[^\d+]/g, '');
}
function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}
function publicUser(u, cfg) {
  return {
    id: u.id,
    fullName: u.fullName,
    companyName: u.companyName,
    phone: u.phone,
    email: u.email,
    createdAt: u.createdAt,
    subscription: cfg ? publicSubscription(u.subscription, cfg) : undefined
  };
}

// POST /api/auth/register
// Регистрация нового аккаунта. Обязательно требует два согласия —
// на обработку персональных данных (152-ФЗ) и на условия использования —
// без них аккаунт не создаётся (см. проверку ниже).
router.post('/register', authLimiter, async (req, res) => {
  try {
    const {
      fullName, companyName, phone, email, password,
      consentPersonalData, consentOffer
    } = req.body || {};

    if (!fullName || !companyName || !phone || !password) {
      return res.status(400).json({ error: 'Заполните обязательные поля: имя, компания, телефон, пароль' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
    }
    if (!consentPersonalData || !consentOffer) {
      return res.status(400).json({
        error: 'Необходимо согласие на обработку персональных данных и принятие условий использования'
      });
    }

    const phoneN = normalizePhone(phone);
    const emailN = normalizeEmail(email);

    const usersData = await readUsers();
    const exists = usersData.users.find(
      u => (phoneN && u.phone === phoneN) || (emailN && u.email === emailN)
    );
    if (exists) {
      return res.status(409).json({ error: 'Пользователь с таким телефоном или e-mail уже зарегистрирован' });
    }

    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const ip = req.ip;
    const cfg = await readConfig();

    const user = {
      id: crypto.randomUUID(),
      fullName: String(fullName).trim(),
      companyName: String(companyName).trim(),
      phone: phoneN,
      email: emailN || null,
      passwordHash,
      createdAt: now,
      // Фиксируем факт и время согласия — это то, что реально требует 152-ФЗ
      // от оператора персональных данных (доказуемость согласия).
      consents: {
        personalData: { accepted: true, acceptedAt: now, ip, version: '1.0' },
        offer: { accepted: true, acceptedAt: now, ip, version: '1.0' }
      },
      // Бесплатный пробный период сразу после регистрации — см. lib/subscription.js
      subscription: trialSubscription(cfg)
    };

    usersData.users.push(user);
    await writeUsers(usersData);

    const token = signToken(user);
    res.json({ token, user: publicUser(user, cfg) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/auth/login  { login: телефон или e-mail, password }
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { login, password } = req.body || {};
    if (!login || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }

    const loginPhone = normalizePhone(login);
    const loginEmail = normalizeEmail(login);

    const usersData = await readUsers();
    const user = usersData.users.find(
      u => (u.phone && u.phone === loginPhone) || (u.email && u.email === loginEmail)
    );
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });

    if (user.blocked) {
      return res.status(403).json({ error: 'Ваш аккаунт заблокирован администратором', blocked: true });
    }

    const cfg = await readConfig();
    const token = signToken(user);
    res.json({ token, user: publicUser(user, cfg) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// GET /api/auth/me — данные текущего пользователя по токену
router.get('/me', authMiddleware, async (req, res) => {
  const usersData = await readUsers();
  const user = usersData.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const cfg = await readConfig();
  if (ensureSubscription(user, cfg)) await writeUsers(usersData);
  res.json({ user: publicUser(user, cfg) });
});

// ---- Восстановление пароля (по e-mail или по телефону) ----
//
// Общая идея: пользователь указывает телефон/e-mail → сервер генерирует
// 6-значный код, хэширует его (как пароль) и сохраняет в записи
// пользователя вместе со сроком действия (15 минут), затем отправляет код
// письмом (SMTP, lib/mailer.js) или SMS (smsc.ru, lib/sms.js) — в
// зависимости от того, что настроено в /admin → Настройки. Ответ на
// POST /forgot всегда одинаковый (ok:true), независимо от того, найден ли
// такой пользователь и настроен ли канал отправки — иначе можно было бы
// перебором узнавать, какие телефоны/e-mail зарегистрированы в системе.

function findUserByMethod(usersData, method, value) {
  if (method === 'email') {
    const emailN = normalizeEmail(value);
    if (!emailN) return null;
    return usersData.users.find(u => u.email && u.email === emailN) || null;
  }
  if (method === 'phone') {
    const phoneN = normalizePhone(value);
    if (!phoneN) return null;
    return usersData.users.find(u => u.phone && u.phone === phoneN) || null;
  }
  return null;
}

// POST /api/auth/forgot  { method: 'email'|'phone', value }
router.post('/forgot', forgotLimiter, async (req, res) => {
  try {
    const { method, value } = req.body || {};
    if (method !== 'email' && method !== 'phone') {
      return res.status(400).json({ error: 'Некорректный способ восстановления' });
    }
    if (!value || !String(value).trim()) {
      return res.status(400).json({ error: method === 'email' ? 'Введите e-mail' : 'Введите телефон' });
    }

    const usersData = await readUsers();
    const user = findUserByMethod(usersData, method, value);

    // Пользователь не найден или у него нет e-mail при method==='email' —
    // отвечаем так же, как при успехе, ничего не отправляя.
    if (user) {
      const now = Date.now();
      if (!user.resetRequestedAt || now - new Date(user.resetRequestedAt).getTime() > RESET_RESEND_COOLDOWN_MS) {
        const code = String(crypto.randomInt(100000, 1000000));
        user.resetCodeHash = await hashPassword(code);
        user.resetCodeExpires = new Date(now + RESET_CODE_TTL_MS).toISOString();
        user.resetCodeMethod = method;
        user.resetAttempts = 0;
        user.resetRequestedAt = new Date(now).toISOString();
        await writeUsers(usersData);

        const cfg = await readConfig();
        if (method === 'email') {
          await sendResetEmail(cfg, user.email, code);
        } else {
          await sendResetSms(cfg, user.phone, code);
        }
      }
      // если запрос повторили раньше, чем истёк кулдаун — просто молчим,
      // код уже был отправлен и всё ещё действителен
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// POST /api/auth/reset  { method, value, code, newPassword }
router.post('/reset', forgotLimiter, async (req, res) => {
  try {
    const { method, value, code, newPassword } = req.body || {};
    const genericError = 'Неверный код или срок его действия истёк';

    if (method !== 'email' && method !== 'phone') {
      return res.status(400).json({ error: 'Некорректный способ восстановления' });
    }
    if (!value || !code) {
      return res.status(400).json({ error: 'Введите код из письма/SMS' });
    }
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
    }

    const usersData = await readUsers();
    const user = findUserByMethod(usersData, method, value);
    if (!user || !user.resetCodeHash || !user.resetCodeExpires) {
      return res.status(400).json({ error: genericError });
    }
    if (Date.now() > new Date(user.resetCodeExpires).getTime()) {
      delete user.resetCodeHash; delete user.resetCodeExpires; delete user.resetAttempts;
      await writeUsers(usersData);
      return res.status(400).json({ error: genericError });
    }
    if ((user.resetAttempts || 0) >= RESET_MAX_ATTEMPTS) {
      delete user.resetCodeHash; delete user.resetCodeExpires; delete user.resetAttempts;
      await writeUsers(usersData);
      return res.status(400).json({ error: 'Слишком много попыток — запросите код заново' });
    }

    const ok = await comparePassword(String(code).trim(), user.resetCodeHash);
    if (!ok) {
      user.resetAttempts = (user.resetAttempts || 0) + 1;
      await writeUsers(usersData);
      return res.status(400).json({ error: genericError });
    }

    user.passwordHash = await hashPassword(newPassword);
    delete user.resetCodeHash; delete user.resetCodeExpires; delete user.resetAttempts;
    delete user.resetCodeMethod; delete user.resetRequestedAt;
    await writeUsers(usersData);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
