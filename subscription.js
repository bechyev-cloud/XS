// Логика подписки/тарифов. Статус (trial/active/expired) всегда вычисляется
// на лету из expiresAt — не храним отдельное поле "статус", чтобы не нужен
// был фоновый job для просрочки: как только время вышло, следующий же запрос
// пересчитает статус как 'expired'.
const { getPlanById } = require('./config');

// Подписка нового аккаунта сразу после регистрации: бесплатный пробный период
// без ограничений (лимит машин — как на старшем тарифе, чтобы не мешать оценить сервис).
function trialSubscription(cfg) {
  const days = Number(cfg.trialDays) || 0;
  const maxLimit = (cfg.plans || []).reduce((m, p) => Math.max(m, p.carLimit || 0), 0);
  const expiresAt = days > 0
    ? new Date(Date.now() + days * 86400000).toISOString()
    : new Date(0).toISOString(); // trialDays=0 — считается сразу истёкшим
  return { planId: null, expiresAt, carLimit: maxLimit || 3 };
}

function computeStatus(sub) {
  if (!sub || !sub.expiresAt) return { status: 'expired', daysLeft: 0 };
  const msLeft = new Date(sub.expiresAt).getTime() - Date.now();
  const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
  const status = msLeft > 0 ? (sub.planId ? 'active' : 'trial') : 'expired';
  return { status, daysLeft };
}

// Представление подписки для отдачи клиенту (и в billing/status, и в admin/users)
function publicSubscription(sub, cfg) {
  const safe = sub || trialSubscription(cfg);
  const { status, daysLeft } = computeStatus(safe);
  const plan = safe.planId ? getPlanById(cfg, safe.planId) : null;
  return {
    planId: safe.planId || null,
    planName: plan ? plan.name : (status !== 'expired' ? 'Пробный период' : null),
    status,               // 'trial' | 'active' | 'expired'
    daysLeft,
    expiresAt: safe.expiresAt || null,
    carLimit: safe.carLimit || 0,
    // Что заблокировано при истёкшей подписке — отдаём явно, чтобы клиент
    // не дублировал эту логику и не расходился с сервером.
    restricted: status === 'expired'
      ? ['addExpense', 'addIncome', 'newContract']
      : []
  };
}

// Продлить/назначить подписку (вызывается администратором при подтверждении оплаты).
// Продлевает от большего из (сейчас, текущая дата окончания) на N месяцев.
function extendSubscription(sub, planId, months, cfg) {
  const plan = getPlanById(cfg, planId);
  if (!plan) throw new Error('Неизвестный тариф: ' + planId);
  const base = sub && sub.expiresAt && new Date(sub.expiresAt).getTime() > Date.now()
    ? new Date(sub.expiresAt)
    : new Date();
  const next = new Date(base);
  next.setMonth(next.getMonth() + (Number(months) || 1));
  return { planId: plan.id, expiresAt: next.toISOString(), carLimit: plan.carLimit };
}

// Для аккаунтов, созданных до появления тарифов (в этой базе таких быть не должно,
// но на всякий случай — если в файле пользователя нет subscription, выдаём пробный
// период при первом же обращении, а не пересчитываем его каждый раз заново).
function ensureSubscription(user, cfg) {
  if (!user.subscription) {
    user.subscription = trialSubscription(cfg);
    return true; // нужно сохранить users.json
  }
  return false;
}

module.exports = { trialSubscription, computeStatus, publicSubscription, extendSubscription, ensureSubscription };
