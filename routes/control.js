// XCAR CONTROL — API панели управления следующего поколения (/api/control/*).
// Все действия проверяют права роли администратора на сервере (RBAC) и
// записываются в журнал действий (Audit Log). Старый API /api/admin и
// приложение XCAR продолжают работать без изменений контракта.
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { readUsers, writeUsers, readStore, writeStore, updateStore, deleteStore, storeCounts } = require('../lib/store');
const { readConfig, writeConfig, computeTariffAmount } = require('../lib/config');
const { hashPassword } = require('../lib/auth');
const { publicSubscription, extendSubscription, ensureSubscription, trialSubscription } = require('../lib/subscription');
const { listRequests, resolveRequest, pendingCount } = require('../lib/requests');
const push = require('../lib/push');
const community = require('../lib/community');
const rbac = require('../lib/control/rbac');
const audit = require('../lib/control/audit');
const agg = require('../lib/control/aggregate');
const msgs = require('../lib/control/messages');
const blacklist = require('../lib/control/blacklist');
const tgAccess = require('../lib/control/tgaccess');
const releases = require('../lib/control/releases');
const carPresets = require('../lib/control/carpresets');
const monitor = require('../lib/control/monitor');
const backup = require('../lib/control/backup');
const ctlSettings = require('../lib/control/settings');
const chatmod = require('../lib/control/chatmod');
const tgbot = require('../lib/control/tgbot');
const checkshare = require('../lib/checkshare');
const { jsonFile } = require('../lib/control/jsonfile');

const router = express.Router();
const stateDb = jsonFile('control-state.json', () => ({ read: {} }));

/* ================= helpers ================= */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  const status = e.status || (e.userError ? 400 : 500);
  if (status >= 500) console.error('XCAR CONTROL:', e);
  res.status(status).json({ error: e.userError || status < 500 ? e.message : 'Внутренняя ошибка сервера' });
});
function bad(msg, status) { const e = new Error(msg); e.userError = msg; e.status = status || 400; return e; }
function tokenFrom(req) { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : (req.query.t ? String(req.query.t) : null); }
async function auth(req, res, next) {
  const t = tokenFrom(req);
  const a = t ? await rbac.authenticate(t) : null;
  if (!a) return res.status(401).json({ error: 'Сессия истекла — войдите снова' });
  req.admin = a; next();
}
const can = (req, p) => req.admin && req.admin.perms.includes(p);
const perm = (...ps) => (req, res, next) => (ps.some((p) => can(req, p)) ? next() : res.status(403).json({ error: 'Недостаточно прав для этого действия', perm: ps[0] }));
function normalizePhone(p) { return p ? String(p).replace(/[^\d+]/g, '') : ''; }
function normalizeEmail(e) { return String(e || '').trim().toLowerCase(); }
async function tz() { return (await ctlSettings.get()).general.timezone || 'Europe/Moscow'; }
function publicUser(u, cfg, extra) {
  return Object.assign({ id: u.id, fullName: u.fullName, companyName: u.companyName, phone: u.phone, email: u.email || null,
    createdAt: u.createdAt, createdByAdmin: !!u.createdByAdmin, blocked: !!u.blocked, blockedAt: u.blockedAt || null,
    lastLoginAt: u.lastLoginAt || null, online: msgs.isOnline(u.id), lastSeen: msgs.lastSeen(u.id),
    subscription: publicSubscription(u.subscription, cfg) }, extra || {});
}
async function mutateAccountStore(accountId, fn) {
  const usersData = await readUsers();
  if (!usersData.users.some((u) => u.id === accountId)) throw bad('Аккаунт не найден', 404);
  // атомарно, под блокировкой файла — правка не затрёт то, что приложение сохранило только что
  const r = await updateStore(accountId, fn);
  agg.invalidate();
  return r;
}
async function mutateUser(userId, fn) {
  const usersData = await readUsers();
  const u = usersData.users.find((x) => x.id === userId);
  if (!u) throw bad('Аккаунт не найден', 404);
  const r = fn(u, usersData);
  await writeUsers(usersData);
  agg.invalidate();
  return { user: u, result: r };
}

/* ================= публичное ================= */
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' } });
router.get('/public-info', wrap(async (req, res) => {
  const s = await ctlSettings.get();
  res.json({ name: s.general.name, logo: s.general.logo || '', version: monitor.VERSION });
}));
router.post('/login', loginLimiter, wrap(async (req, res) => {
  const { login, password, code } = req.body || {};
  const r = await rbac.login({ login, password, code, ip: audit.clientIp(req), ua: req.headers['user-agent'] });
  if (r.error) {
    await audit.log({ admin: { name: String(login || 'owner') }, headers: req.headers, ip: req.ip, socket: req.socket }, 'Неудачный вход', { type: 'auth' }, 'error', r.error);
    return res.status(r.status || 401).json({ error: r.error, need2fa: !!r.need2fa });
  }
  req.admin = { name: r.admin.name, id: r.admin.id, role: r.admin.role };
  await audit.log(req, 'Вход в XCAR CONTROL', { type: 'auth' }, 'ok');
  res.json(r);
}));

router.use(auth);

/* ================= профиль администратора ================= */
router.get('/me', wrap(async (req, res) => {
  const rec = await rbac.getAdmin(req.admin.id);
  res.json({ admin: Object.assign(rbac.publicAdmin(rec), { perms: req.admin.perms, sid: req.admin.sid }), roles: rbac.ROLES, permissions: rbac.PERMISSIONS,
    unreadMessages: can(req, 'messages.view') ? await msgs.totalUnreadForAdmin() : 0, pendingPayments: can(req, 'payments.view') ? await pendingCount() : 0 });
}));
router.post('/logout', wrap(async (req, res) => { await rbac.revokeSession(req.admin.sid); await audit.log(req, 'Выход из XCAR CONTROL', { type: 'auth' }); res.json({ ok: true }); }));
router.get('/me/sessions', wrap(async (req, res) => {
  const list = await rbac.listSessions(req.admin.id);
  res.json({ sessions: list.map((s) => Object.assign({}, s, { current: s.id === req.admin.sid })) });
}));
router.delete('/me/sessions/:id', wrap(async (req, res) => {
  await rbac.revokeSession(req.params.id, req.admin.id); await audit.log(req, 'Завершил сессию', { type: 'session', id: req.params.id }); res.json({ ok: true });
}));
router.post('/me/sessions/revoke-others', wrap(async (req, res) => {
  await rbac.revokeAllForAdmin(req.admin.id, req.admin.sid); await audit.log(req, 'Завершил все другие сессии', { type: 'session' }); res.json({ ok: true });
}));
router.put('/me/password', wrap(async (req, res) => {
  if (req.admin.id === 'owner') throw bad('Пароль владельца задаётся переменной окружения ADMIN_PASSWORD на сервере');
  await rbac.updateAdmin(req.admin.id, { password: (req.body || {}).password });
  await audit.log(req, 'Сменил свой пароль', { type: 'admin', id: req.admin.id }); res.json({ ok: true });
}));
router.post('/me/2fa/setup', wrap(async (req, res) => { res.json(await rbac.startTotp(req.admin.id)); }));
router.post('/me/2fa/enable', wrap(async (req, res) => {
  try { await rbac.enableTotp(req.admin.id, (req.body || {}).code); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Включил 2FA', { type: 'admin', id: req.admin.id }); res.json({ ok: true });
}));
router.post('/me/2fa/disable', wrap(async (req, res) => {
  try { await rbac.disableTotp(req.admin.id, (req.body || {}).code); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Отключил 2FA', { type: 'admin', id: req.admin.id }); res.json({ ok: true });
}));

/* ================= Dashboard / аналитика / поиск ================= */
router.get('/overview', perm('dashboard.view'), wrap(async (req, res) => {
  const all = await agg.loadAll();
  const o = agg.overview(all, await tz(), req.query.g);
  if (!can(req, 'payments.view') && !can(req, 'analytics.view')) { o.kpi.incomeToday = o.kpi.incomeWeek = o.kpi.incomeMonth = null; o.charts.income = []; }
  res.json(o);
}));
router.get('/analytics', perm('analytics.view'), wrap(async (req, res) => { res.json(agg.analytics(await agg.loadAll(), await tz())); }));
router.get('/search', perm('dashboard.view'), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim(); const s = q.toLowerCase();
  if (s.length < 2) return res.json({ q, groups: [] });
  const all = await agg.loadAll(); const now = agg.localNow(await tz());
  const has = (...xs) => xs.some((x) => String(x || '').toLowerCase().replace(/ё/g, 'е').includes(s.replace(/ё/g, 'е')));
  const digits = q.replace(/\D/g, ''); const hasPhone = (p) => digits.length >= 4 && String(p || '').replace(/\D/g, '').includes(digits);
  const groups = [];
  const push_ = (key, title, items) => { if (items.length) groups.push({ key, title, items: items.slice(0, 8), total: items.length }); };
  if (can(req, 'users.view')) push_('users', 'Пользователи', all.accounts.filter((a) => has(a.user.companyName, a.user.fullName, a.user.email) || hasPhone(a.user.phone))
    .map((a) => ({ id: a.user.id, title: a.user.companyName || a.user.fullName, sub: `${a.user.fullName || ''} · ${a.user.phone || ''}`, route: `users/${a.user.id}` })));
  if (can(req, 'clients.view')) push_('clients', 'Клиенты', agg.buildClients(all, now).filter((c) => has(c.name, c.doc, c.licenseNum) || hasPhone(c.phone))
    .map((c) => ({ id: c.uid, title: c.name, sub: `${c.phone || ''} · ${c.account}`, route: `clients/${c.accountId}/${c.id}`, badge: c.blacklisted ? 'ЧС' : null })));
  let fleet = null;
  if (can(req, 'fleet.view')) { fleet = agg.buildFleet(all, now); push_('cars', 'Автомобили', fleet.filter((c) => has(c.make + ' ' + c.model, c.plate, c.vin))
    .map((c) => ({ id: c.uid, title: `${c.make} ${c.model}`, sub: `${c.plate} · ${c.statusLabel} · ${c.account}`, route: `fleet/${c.accountId}/${c.id}` }))); }
  if (can(req, 'rentals.view')) {
    const r = agg.buildRentals(all, now).filter((x) => has(x.car, x.plate, x.client) || hasPhone(x.clientPhone));
    push_('rentals', 'Аренды', r.filter((x) => !['booked', 'pending'].includes(x.status)).map((x) => ({ id: x.uid, title: `${x.car} · ${x.client}`, sub: `${x.start.replace('T', ' ')} → ${x.end.replace('T', ' ')} · ${x.statusLabel}`, route: `rentals?open=${encodeURIComponent(x.uid)}` })));
    push_('reservations', 'Брони', r.filter((x) => ['booked', 'pending'].includes(x.status)).map((x) => ({ id: x.uid, title: `${x.car} · ${x.client}`, sub: `${x.start.replace('T', ' ')} → ${x.end.replace('T', ' ')}`, route: `reservations?open=${encodeURIComponent(x.uid)}` })));
  }
  if (can(req, 'payments.view')) push_('payments', 'Платежи', agg.buildPayments(all, await listRequests(), all.cfg).filter((p) => has(p.client, p.account, p.comment) || (digits && String(p.amount).includes(digits)))
    .map((p) => ({ id: p.uid, title: `${p.amount.toLocaleString('ru-RU')} ₽ · ${p.client || p.account}`, sub: `${p.date.replace('T', ' ')} · ${p.method}`, route: `payments?q=${encodeURIComponent(q)}` })));
  if (can(req, 'messages.view')) { const byId = new Map(all.accounts.map((a) => [a.user.id, a.user])); push_('messages', 'Сообщения', (await msgs.searchMessages(q, byId)).map((m) => ({ id: m.id, title: m.name, sub: (m.text || '').slice(0, 90), route: `messages/${m.userId}` }))); }
  if (can(req, 'blacklist.view')) push_('blacklist', 'Проверка клиента', (await blacklist.search(q, agg.buildClients(all, now).filter((c) => c.blacklisted))).map((b) => ({ id: b.id, title: b.title, sub: b.text.split('\n').slice(0, 2).join(' · ').slice(0, 100), route: `blacklist?q=${encodeURIComponent(q)}` })));
  res.json({ q, groups });
}));

/* ================= уведомления ================= */
async function computeNotifications(req) {
  const all = await agg.loadAll(); const zone = await tz(); const now = agg.localNow(zone);
  const out = []; const add = (n) => out.push(n);
  const nowMs = Date.now(); const s = await ctlSettings.get();
  if (can(req, 'servers.view')) for (const sv of s.servers) { const r = monitor.last(sv.id); if (r && r.online === false && sv.url) add({ key: `server:${sv.id}:${(r.checkedAt || '').slice(0, 13)}`, type: 'critical', title: `Сервер «${sv.name}» недоступен`, text: r.error || 'Нет ответа', at: r.checkedAt, route: 'servers' }); }
  if (can(req, 'backup.view')) { const h = await backup.health(s.backup); if (h.lastResult === 'error') add({ key: `backup:err:${h.lastAt}`, type: 'critical', title: 'Ошибка резервного копирования', text: h.lastError || '', at: h.lastAt, route: 'backups' });
    else if (h.last && nowMs - new Date(h.last.createdAt).getTime() < 48 * 3600 * 1000) add({ key: `backup:ok:${h.last.id}`, type: 'success', title: 'Резервная копия создана', text: `${h.last.usersCount || 0} польз. · ${Math.round((h.last.size || 0) / 1024)} КБ`, at: h.last.createdAt, route: 'backups' }); }
  if (can(req, 'rentals.view')) agg.buildRentals(all, now).forEach((r) => {
    if (r.status === 'overdue') add({ key: `overdue:${r.uid}`, type: 'important', title: 'Просроченная аренда', text: `${r.car} · ${r.client} · до ${r.end.replace('T', ' ')}`, at: null, sortAt: r.end, route: `rentals?open=${encodeURIComponent(r.uid)}` });
    if (r.status === 'booked' && r.start.slice(0, 10) <= agg.addDays(now.slice(0, 10), 3)) add({ key: `book:${r.uid}`, type: 'info', title: 'Бронь скоро начнётся', text: `${r.car} · ${r.client} · с ${r.start.replace('T', ' ')}`, sortAt: r.start, route: `reservations?open=${encodeURIComponent(r.uid)}` });
  });
  if (can(req, 'users.view')) all.accounts.forEach((a) => {
    if (a.user.createdAt && nowMs - new Date(a.user.createdAt).getTime() < 7 * 86400000) add({ key: `newuser:${a.user.id}`, type: 'info', title: 'Новый пользователь', text: `${a.user.companyName || a.user.fullName} · ${a.user.phone || ''}`, at: a.user.createdAt, route: `users/${a.user.id}` });
    const exp = a.sub.expiresAt ? new Date(a.sub.expiresAt).getTime() : 0;
    if (a.sub.status === 'expired' && exp && nowMs - exp < 7 * 86400000) add({ key: `subexp:${a.user.id}:${a.sub.expiresAt}`, type: 'important', title: 'Закончилась подписка', text: a.user.companyName || a.user.fullName, at: a.sub.expiresAt, route: `users/${a.user.id}` });
  });
  if (can(req, 'payments.view')) {
    (await listRequests()).filter((r) => r.status === 'pending').forEach((r) => { const u = all.accounts.find((a) => a.user.id === r.userId); add({ key: `req:${r.id}`, type: 'important', title: 'Заявка на оплату подписки', text: `${u ? (u.user.companyName || u.user.fullName) : ''} · ${r.months || 1} мес.`, at: r.createdAt, route: 'payments?kind=subscription' }); });
    agg.buildPayments(all, [], all.cfg).filter((p) => p.date && p.date.slice(0, 10) >= agg.addDays(now.slice(0, 10), -2)).slice(0, 30)
      .forEach((p) => add({ key: `pay:${p.uid}`, type: 'success', title: 'Новый платёж', text: `${p.amount.toLocaleString('ru-RU')} ₽ · ${p.client} · ${p.account}`, sortAt: p.date, route: `payments?q=${encodeURIComponent(p.client)}` }));
  }
  if (can(req, 'messages.view')) { const byId = new Map(all.accounts.map((a) => [a.user.id, a.user])); (await msgs.threadsSummary(byId)).filter((t) => t.unread).forEach((t) => add({ key: `msg:${t.userId}:${t.last.at}`, type: 'info', title: `Новое сообщение · ${t.name}`, text: t.last.text, at: t.last.at, route: `messages/${t.userId}` })); }
  const allowed = s.notifications;
  const st = await stateDb.read(); const read = (st.read && st.read[req.admin.id]) || {};
  const iso = (n) => n.at || (n.sortAt ? n.sortAt : '');
  return out.filter((n) => allowed[n.type] !== false).map((n) => Object.assign(n, { read: !!read[n.key] }))
    .sort((a, b) => { const o = { critical: 0, important: 1, info: 2, success: 3 }; if (a.read !== b.read) return a.read ? 1 : -1; if (o[a.type] !== o[b.type]) return o[a.type] - o[b.type]; return iso(a) < iso(b) ? 1 : -1; });
}
router.get('/notifications', perm('notifications.view', 'dashboard.view'), wrap(async (req, res) => {
  const list = await computeNotifications(req);
  res.json({ notifications: list, unread: list.filter((n) => !n.read).length });
}));
router.post('/notifications/read', wrap(async (req, res) => {
  const { keys, all: markAll } = req.body || {};
  let ks = Array.isArray(keys) ? keys : [];
  if (markAll) ks = (await computeNotifications(req)).map((n) => n.key);
  await stateDb.update((st) => { st.read = st.read || {}; const r = st.read[req.admin.id] = st.read[req.admin.id] || {}; const t = Date.now(); ks.forEach((k) => { r[k] = t; });
    Object.keys(r).forEach((k) => { if (t - r[k] > 60 * 86400000) delete r[k]; }); });
  res.json({ ok: true });
}));

/* ================= пользователи (аккаунты XCAR) ================= */
router.get('/users', perm('users.view'), wrap(async (req, res) => {
  const all = await agg.loadAll(); const now = agg.localNow(await tz());
  const rentals = agg.buildRentals(all, now);
  const inc = agg.incomeEvents(all.accounts);
  const list = all.accounts.map((a) => publicUser(a.user, all.cfg, {
    counts: { cars: (a.store.cars || []).length, clients: (a.store.clients || []).length, contracts: (a.store.contracts || []).length },
    rentals: rentals.filter((r) => r.accountId === a.user.id).length,
    paymentsSum: inc.filter((e) => e.accountId === a.user.id).reduce((s, e) => s + e.amount, 0),
  })).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
  res.json({ users: list });
}));
router.get('/users/:id', perm('users.view'), wrap(async (req, res) => {
  const all = await agg.loadAll(); const a = all.accounts.find((x) => x.user.id === req.params.id);
  if (!a) throw bad('Аккаунт не найден', 404);
  const now = agg.localNow(await tz());
  const subAll = { accounts: [a], cfg: all.cfg };
  const reqs = (await listRequests()).filter((r) => r.userId === a.user.id);
  const inc = agg.incomeEvents([a]);
  res.json({
    user: publicUser(a.user, all.cfg, { consents: a.user.consents || null }),
    stats: { cars: (a.store.cars || []).length, clients: (a.store.clients || []).length, contracts: (a.store.contracts || []).length,
      income: inc.reduce((s, e) => s + e.amount, 0), companyName: (a.store.settings || {}).companyName || null },
    fleet: can(req, 'fleet.view') ? agg.buildFleet(subAll, now) : [],
    rentals: can(req, 'rentals.view') ? agg.buildRentals(subAll, now).slice(0, 100) : [],
    clients: can(req, 'clients.view') ? agg.buildClients(subAll, now) : [],
    requests: can(req, 'payments.view') ? agg.buildPayments({ accounts: [] }, reqs, all.cfg) : [],
    history: can(req, 'audit.view') ? (await audit.list({ objectId: a.user.id, limit: 100 })).entries : [],
    plans: all.cfg.plans,
  });
}));
router.post('/users', perm('users.edit'), wrap(async (req, res) => {
  const { fullName, companyName, phone, email, password } = req.body || {};
  if (!fullName || !companyName || !phone || !password) throw bad('Заполните имя, компанию, телефон и пароль');
  if (String(password).length < 6) throw bad('Пароль должен быть не короче 6 символов');
  const phoneN = normalizePhone(phone); const emailN = normalizeEmail(email);
  const usersData = await readUsers();
  if (usersData.users.find((u) => (phoneN && u.phone === phoneN) || (emailN && u.email === emailN))) throw bad('Аккаунт с таким телефоном или e-mail уже существует', 409);
  const cfg = await readConfig(); const nowIso = new Date().toISOString();
  const user = { id: crypto.randomUUID(), fullName: String(fullName).trim(), companyName: String(companyName).trim(), phone: phoneN, email: emailN || null,
    passwordHash: await hashPassword(String(password)), createdAt: nowIso, createdByAdmin: true,
    consents: { personalData: { accepted: false, grantedByAdmin: true, acceptedAt: nowIso }, offer: { accepted: false, grantedByAdmin: true, acceptedAt: nowIso } },
    subscription: trialSubscription(cfg) };
  usersData.users.push(user); await writeUsers(usersData); agg.invalidate();
  await audit.log(req, 'Создал аккаунт', { type: 'user', id: user.id, name: user.companyName });
  res.json({ user: publicUser(user, cfg) });
}));
router.put('/users/:id', perm('users.edit'), wrap(async (req, res) => {
  const { fullName, companyName, phone, email } = req.body || {};
  const { user } = await mutateUser(req.params.id, (u) => {
    if (fullName !== undefined) u.fullName = String(fullName).trim();
    if (companyName !== undefined) u.companyName = String(companyName).trim();
    if (phone !== undefined) u.phone = normalizePhone(phone);
    if (email !== undefined) u.email = normalizeEmail(email) || null;
  });
  await audit.log(req, 'Изменил данные аккаунта', { type: 'user', id: user.id, name: user.companyName });
  res.json({ user: publicUser(user, await readConfig()) });
}));
router.put('/users/:id/block', perm('users.edit'), wrap(async (req, res) => {
  const blocked = !!(req.body || {}).blocked;
  const { user } = await mutateUser(req.params.id, (u) => { u.blocked = blocked; u.blockedAt = blocked ? new Date().toISOString() : null; });
  await audit.log(req, blocked ? 'Заблокировал аккаунт' : 'Разблокировал аккаунт', { type: 'user', id: user.id, name: user.companyName });
  res.json({ user: publicUser(user, await readConfig()) });
}));
router.put('/users/:id/password', perm('users.edit'), wrap(async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 6) throw bad('Пароль должен быть не короче 6 символов');
  const hash = await hashPassword(String(password));
  const { user } = await mutateUser(req.params.id, (u) => { u.passwordHash = hash; });
  await audit.log(req, 'Сбросил пароль аккаунта', { type: 'user', id: user.id, name: user.companyName });
  res.json({ ok: true });
}));
router.delete('/users/:id', perm('users.delete'), wrap(async (req, res) => {
  if ((req.body || {}).confirm !== 'УДАЛИТЬ') throw bad('Для удаления введите слово УДАЛИТЬ');
  const usersData = await readUsers(); const i = usersData.users.findIndex((u) => u.id === req.params.id);
  if (i < 0) throw bad('Аккаунт не найден', 404);
  const [u] = usersData.users.splice(i, 1); await writeUsers(usersData); await deleteStore(u.id); agg.invalidate();
  await audit.log(req, 'Удалил аккаунт', { type: 'user', id: u.id, name: u.companyName });
  res.json({ ok: true });
}));
router.put('/users/:id/subscription', perm('subscriptions.edit'), wrap(async (req, res) => {
  const cfg = await readConfig(); const b = req.body || {}; let desc = '';
  const { user } = await mutateUser(req.params.id, (u) => {
    ensureSubscription(u, cfg);
    if (b.mode === 'plan') {
      const m = Number(b.months); if (!b.planId || !(m > 0)) throw bad('Укажите тариф и количество месяцев');
      try { u.subscription = extendSubscription(u.subscription, b.planId, m, cfg); } catch (e) { throw bad(e.message); }
      desc = `Тариф ${b.planId}, +${m} мес.`;
    } else {
      const days = Math.round(Number(b.days)); if (!Number.isFinite(days) || Math.abs(days) > 3650) throw bad('Укажите количество дней (до 3650)');
      const sub = Object.assign({}, u.subscription); const nowMs = Date.now();
      if (b.mode === 'add') { const cur = sub.expiresAt ? new Date(sub.expiresAt).getTime() : nowMs; const base = days >= 0 ? Math.max(nowMs, cur) : cur; sub.expiresAt = new Date(base + days * 86400000).toISOString(); desc = (days >= 0 ? '+' : '') + days + ' дн.'; }
      else { if (days < 0) throw bad('Число дней не может быть отрицательным'); sub.expiresAt = days === 0 ? new Date(nowMs - 1000).toISOString() : new Date(nowMs + days * 86400000 - 60000).toISOString(); desc = days === 0 ? 'подписка завершена' : `ровно ${days} дн.`; }
      if (b.planId) { const plan = cfg.plans.find((p) => p.id === b.planId); if (!plan) throw bad('Неизвестный тариф'); sub.planId = plan.id; sub.carLimit = plan.carLimit; desc += `, тариф ${plan.name}`; }
      u.subscription = sub;
    }
  });
  await audit.log(req, 'Изменил подписку пользователя', { type: 'user', id: user.id, name: user.companyName }, 'ok', desc);
  res.json({ user: publicUser(user, cfg) });
}));
router.get('/users/:id/settings-versions', perm('users.edit'), wrap(async (req, res) => {
  const store = await readStore(req.params.id);
  res.json({ current: store.settings || {}, versions: backup.settingsVersions(req.params.id).map((v) => ({ id: v.id, version: v.version, source: v.source, at: v.at, settings: v.settings })) });
}));
router.post('/users/:id/settings-restore', perm('users.edit'), wrap(async (req, res) => {
  const { versionId, keys } = req.body || {};
  const v = backup.settingsVersions(req.params.id).find((x) => x.id === versionId);
  if (!v) throw bad('Версия настроек не найдена', 404);
  await mutateAccountStore(req.params.id, (store) => {
    const cur = store.settings || {};
    backup.recordSettings(req.params.id, cur); // текущие — в историю, чтобы можно было откатить обратно
    let next;
    if (Array.isArray(keys) && keys.length) { next = Object.assign({}, cur); keys.forEach((k) => { if (v.settings[k] === undefined) delete next[k]; else next[k] = v.settings[k]; }); }
    else next = Object.assign({}, v.settings);
    store.settings = next;
  });
  const u = (await readUsers()).users.find((x) => x.id === req.params.id);
  await audit.log(req, 'Восстановил настройки пользователя', { type: 'user', id: req.params.id, name: u && u.companyName }, 'ok', `Версия ${v.version} от ${v.at}` + (keys && keys.length ? `, ключи: ${keys.join(', ')}` : ''));
  res.json({ ok: true, note: 'Пользователь увидит настройки после обновления данных в приложении (кнопка «Обновить с сервером» или перезапуск).' });
}));

/* ================= автопарк ================= */
const CAR_FIELDS = ['make', 'model', 'trim', 'year', 'plate', 'vin', 'color', 'rate', 'rate6h', 'weekRate', 'monthRate', 'deposit', 'currentMileage', 'category', 'description', 'notes', 'status', 'overdueHourRate'];
function cleanCar(b) {
  const c = {};
  CAR_FIELDS.forEach((k) => { if (b[k] !== undefined) c[k] = b[k]; });
  ['year', 'rate', 'rate6h', 'weekRate', 'monthRate', 'deposit', 'currentMileage', 'overdueHourRate'].forEach((k) => { if (c[k] !== undefined) c[k] = c[k] === '' || c[k] === null ? (k === 'year' || k === 'currentMileage' ? null : 0) : Number(c[k]) || 0; });
  ['make', 'model', 'trim', 'plate', 'vin', 'color', 'category', 'description', 'notes'].forEach((k) => { if (c[k] !== undefined) c[k] = String(c[k] || '').trim().slice(0, k === 'description' || k === 'notes' ? 3000 : 80); });
  if (c.status !== undefined && !agg.CAR_STATUS[c.status]) throw bad('Неизвестный статус');
  if (Array.isArray(b.photos)) {
    const photos = b.photos.filter((p) => typeof p === 'string' && /^data:image\//.test(p)).slice(0, 12);
    if (photos.reduce((s, p) => s + p.length, 0) > 12 * 1024 * 1024) throw bad('Фотографии слишком большие (до 12 МБ вместе)');
    c.photos = photos; const mi = Math.min(Math.max(0, Number(b.mainPhoto) || 0), Math.max(0, photos.length - 1));
    c.photo = photos[mi] || null; // главное фото — его показывает приложение XCAR
  }
  return c;
}
router.get('/fleet', perm('fleet.view'), wrap(async (req, res) => {
  const all = await agg.loadAll();
  res.json({ cars: agg.buildFleet(all, agg.localNow(await tz())), accounts: all.accounts.map((a) => ({ id: a.user.id, name: agg.accName(a.user), carLimit: a.sub.carLimit, cars: (a.store.cars || []).length })) });
}));
router.get('/fleet/:acc/:car', perm('fleet.view'), wrap(async (req, res) => {
  const all = await agg.loadAll(); const a = all.accounts.find((x) => x.user.id === req.params.acc); if (!a) throw bad('Аккаунт не найден', 404);
  const car = (a.store.cars || []).find((c) => c.id === req.params.car); if (!car) throw bad('Автомобиль не найден', 404);
  const now = agg.localNow(await tz()); const sub = { accounts: [a], cfg: all.cfg };
  const summary = agg.buildFleet(sub, now).find((c) => c.id === car.id);
  const cts = (a.store.contracts || []).filter((c) => c.carId === car.id);
  const rentals = agg.buildRentals(sub, now).filter((r) => r.carId === car.id);
  const rentalIds = new Set(cts.map((c) => c.id));
  const payments = agg.buildPayments(sub, [], all.cfg).filter((p) => { const l = (a.store.clientLedger || []).find((x) => x.id === p.id); return l && (rentalIds.has(l.rentalId) || rentalIds.has(l.fineId)); });
  const expenses = cts.filter((c) => c.type === 'repair' || c.type === 'oil').map((c) => ({ id: c.id, type: c.type, date: agg.d16(c.start), amount: Number(c.total) || 0, notes: c.notes || '' }));
  const oil = (a.store.oilChanges || []).filter((o) => o.carId === car.id);
  const clientIds = [...new Set(cts.map((c) => c.clientId).filter(Boolean))];
  const clients = agg.buildClients(sub, now).filter((c) => clientIds.includes(c.id));
  const history = cts.map((c) => ({ id: c.id, type: c.type || 'rental', date: agg.d16(c.start), end: agg.d16(c.end), amount: Number(c.total) || 0, status: c.status, notes: c.notes || '' })).sort((x, y) => (x.date < y.date ? 1 : -1));
  res.json({ car: Object.assign({}, summary, { photos: Array.isArray(car.photos) && car.photos.length ? car.photos : (car.photo ? [car.photo] : []), documents: car.documents || [] }),
    rentals: rentals.filter((r) => !['booked', 'pending'].includes(r.status)), reservations: rentals.filter((r) => ['booked', 'pending'].includes(r.status)),
    payments, expenses, oil, clients, history, audit: (await audit.list({ objectId: req.params.acc + '~' + car.id, limit: 50 })).entries });
}));
router.post('/fleet', perm('fleet.edit'), wrap(async (req, res) => {
  const b = req.body || {}; const data = cleanCar(b);
  if (!data.make || !data.model) throw bad('Укажите марку и модель');
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await mutateAccountStore(b.accountId, (store) => { store.cars = store.cars || []; store.cars.push(Object.assign({ id, status: 'free', rate: 0, rate6h: 0, overdueHourRate: 0, notes: '', photo: null }, data)); });
  await audit.log(req, 'Добавил автомобиль', { type: 'car', id: b.accountId + '~' + id, name: `${data.make} ${data.model} ${data.plate || ''}`.trim(), userId: b.accountId });
  res.json({ ok: true, id });
}));
router.put('/fleet/:acc/:car', perm('fleet.edit'), wrap(async (req, res) => {
  const data = cleanCar(req.body || {}); let name = '';
  await mutateAccountStore(req.params.acc, (store) => { const c = (store.cars || []).find((x) => x.id === req.params.car); if (!c) throw bad('Автомобиль не найден', 404); Object.assign(c, data); name = `${c.make} ${c.model} ${c.plate || ''}`.trim(); });
  await audit.log(req, 'Изменил автомобиль', { type: 'car', id: req.params.acc + '~' + req.params.car, name, userId: req.params.acc }, 'ok', Object.keys(data).filter((k) => k !== 'photos' && k !== 'photo').join(', '));
  res.json({ ok: true });
}));
router.delete('/fleet/:acc/:car', perm('fleet.edit'), wrap(async (req, res) => {
  let name = '';
  await mutateAccountStore(req.params.acc, (store) => {
    const c = (store.cars || []).find((x) => x.id === req.params.car); if (!c) throw bad('Автомобиль не найден', 404);
    if ((store.contracts || []).some((x) => x.carId === c.id && x.status === 'active')) throw bad('Машина сейчас в аренде — сначала завершите аренду или переведите в «Архив»');
    name = `${c.make} ${c.model} ${c.plate || ''}`.trim(); store.cars = store.cars.filter((x) => x.id !== c.id);
  });
  await audit.log(req, 'Удалил автомобиль', { type: 'car', id: req.params.acc + '~' + req.params.car, name, userId: req.params.acc });
  res.json({ ok: true });
}));
router.post('/fleet/:acc/:car/documents', perm('fleet.edit'), wrap(async (req, res) => {
  const b = req.body || {}; let meta;
  try { meta = msgs.saveAttachment({ name: b.name, type: b.type, dataUrl: b.dataUrl }); } catch (e) { throw bad(e.message); }
  await mutateAccountStore(req.params.acc, (store) => { const c = (store.cars || []).find((x) => x.id === req.params.car); if (!c) throw bad('Автомобиль не найден', 404); c.documents = c.documents || []; c.documents.push({ id: meta.id, name: meta.name, type: meta.type, size: meta.size, uploadedAt: meta.createdAt }); });
  await audit.log(req, 'Загрузил документ автомобиля', { type: 'car', id: req.params.acc + '~' + req.params.car, userId: req.params.acc }, 'ok', meta.name);
  res.json({ ok: true, document: meta });
}));
router.delete('/fleet/:acc/:car/documents/:doc', perm('fleet.edit'), wrap(async (req, res) => {
  await mutateAccountStore(req.params.acc, (store) => { const c = (store.cars || []).find((x) => x.id === req.params.car); if (!c) throw bad('Автомобиль не найден', 404); c.documents = (c.documents || []).filter((d) => d.id !== req.params.doc); });
  await audit.log(req, 'Удалил документ автомобиля', { type: 'car', id: req.params.acc + '~' + req.params.car, userId: req.params.acc });
  res.json({ ok: true });
}));

/* ================= аренды и брони ================= */
router.get('/rentals', perm('rentals.view'), wrap(async (req, res) => {
  const all = await agg.loadAll(); const now = agg.localNow(await tz());
  res.json({ rentals: agg.buildRentals(all, now), now });
}));
router.get('/reservations', perm('rentals.view'), wrap(async (req, res) => {
  const all = await agg.loadAll(); const now = agg.localNow(await tz());
  const cars = agg.buildFleet(all, now).filter((c) => c.status !== 'archive').map((c) => ({ uid: c.uid, id: c.id, accountId: c.accountId, name: `${c.make} ${c.model}`, plate: c.plate, status: c.status, account: c.account }));
  res.json({ now, cars, items: agg.buildRentals(all, now).filter((r) => r.status !== 'cancelled') });
}));
router.put('/rentals/:acc/:id', perm('rentals.edit'), wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'booked', 'done', 'cancelled'].includes(status)) throw bad('Неизвестный статус');
  let desc = '';
  await mutateAccountStore(req.params.acc, (store) => {
    const ct = (store.contracts || []).find((c) => c.id === req.params.id); if (!ct) throw bad('Аренда не найдена', 404);
    desc = `${ct.status} → ${status}`; ct.status = status; if (status === 'done' && !ct.returnedAt) ct.returnedAt = new Date().toISOString();
    // та же синхронизация статуса машины, что в приложении (saveContract)
    const car = (store.cars || []).find((c) => c.id === ct.carId);
    if (car) { if (status === 'active') car.status = 'rented'; else if (status === 'booked') car.status = 'booked';
      else if (car.status === 'rented' || car.status === 'booked') { const other = (store.contracts || []).find((c) => c.carId === car.id && c.id !== ct.id && (c.status === 'active' || c.status === 'booked')); car.status = other ? (other.status === 'active' ? 'rented' : 'booked') : 'free'; } }
  });
  await audit.log(req, 'Изменил статус аренды', { type: 'rental', id: req.params.acc + '~' + req.params.id, userId: req.params.acc }, 'ok', desc);
  res.json({ ok: true });
}));

/* ================= клиенты ================= */
router.get('/clients', perm('clients.view'), wrap(async (req, res) => {
  const all = await agg.loadAll(); res.json({ clients: agg.buildClients(all, agg.localNow(await tz())) });
}));
router.get('/clients/:acc/:id', perm('clients.view'), wrap(async (req, res) => {
  const all = await agg.loadAll(); const a = all.accounts.find((x) => x.user.id === req.params.acc); if (!a) throw bad('Аккаунт не найден', 404);
  const now = agg.localNow(await tz()); const sub = { accounts: [a], cfg: all.cfg };
  const client = agg.buildClients(sub, now).find((c) => c.id === req.params.id); if (!client) throw bad('Клиент не найден', 404);
  const raw = (a.store.clients || []).find((c) => c.id === req.params.id);
  const rentals = agg.buildRentals(sub, now).filter((r) => r.clientId === client.id);
  const payments = agg.buildPayments(sub, [], all.cfg).filter((p) => p.clientId === client.id);
  const debts = (a.store.clientLedger || []).filter((l) => l.clientId === client.id && ['fine', 'violation', 'oldDebt', 'discount'].includes(l.type)).map((l) => ({ id: l.id, type: l.type, amount: Number(l.amount) || 0, date: agg.d16(l.date), note: l.note || '' }));
  const carsMap = new Map(); rentals.forEach((r) => { const k = r.carId; const x = carsMap.get(k) || { carId: k, name: r.car, plate: r.plate, count: 0, last: '' }; x.count++; if (r.start > x.last) x.last = r.start; carsMap.set(k, x); });
  const matches = can(req, 'blacklist.view') ? (await blacklist.search(client.name, [])).concat(client.phone ? await blacklist.search(client.phone, []) : []) : [];
  const seen = new Set();
  res.json({ client: Object.assign({}, client, { raw: { licenseNum: raw.licenseNum || '', birth: raw.birth || '', address: raw.address || '' } }), rentals, payments, debts, cars: [...carsMap.values()],
    blacklistMatches: matches.filter((m) => (seen.has(m.id) ? false : seen.add(m.id))).slice(0, 10),
    thread: can(req, 'messages.view') ? { userId: a.user.id, name: agg.accName(a.user) } : null,
    audit: (await audit.list({ objectId: req.params.acc + '~' + req.params.id, limit: 100 })).entries });
}));
router.put('/clients/:acc/:id', perm('clients.edit'), wrap(async (req, res) => {
  const b = req.body || {}; let name = ''; const changed = [];
  await mutateAccountStore(req.params.acc, (store) => {
    const c = (store.clients || []).find((x) => x.id === req.params.id); if (!c) throw bad('Клиент не найден', 404);
    ['name', 'phone', 'doc', 'licenseNum', 'notes'].forEach((k) => { if (b[k] !== undefined && b[k] !== c[k]) { c[k] = String(b[k] || '').trim().slice(0, k === 'notes' ? 3000 : 120); changed.push(k); } });
    if (b.blacklisted !== undefined && !!b.blacklisted !== !!c.blacklisted) { c.blacklisted = !!b.blacklisted; c.blacklistedAt = c.blacklisted ? new Date().toISOString() : null; if (!c.blacklisted) c.blacklistReason = ''; changed.push(c.blacklisted ? 'добавлен в ЧС' : 'убран из ЧС'); }
    // причина — «личный чёрный список» пользователя (то же поле, что в приложении XCAR)
    if (b.blacklistReason !== undefined && c.blacklisted && String(b.blacklistReason || '').trim() !== (c.blacklistReason || '')) { c.blacklistReason = String(b.blacklistReason || '').trim().slice(0, 2000); changed.push('причина ЧС'); }
    name = c.name;
  });
  await audit.log(req, 'Изменил клиента', { type: 'client', id: req.params.acc + '~' + req.params.id, name, userId: req.params.acc }, 'ok', changed.join(', '));
  res.json({ ok: true });
}));

/* ================= платежи и подписки ================= */
router.get('/payments', perm('payments.view'), wrap(async (req, res) => {
  const all = await agg.loadAll();
  res.json({ payments: agg.buildPayments(all, await listRequests(), all.cfg) });
}));
router.post('/payments/requests/:id/:action', perm('payments.edit'), wrap(async (req, res) => {
  const { id, action } = req.params; const reqs = await listRequests(); const r = reqs.find((x) => x.id === id);
  if (!r) throw bad('Заявка не найдена', 404);
  const cfg = await readConfig(); let detail = '';
  if (action === 'approve') {
    if (r.status !== 'pending') throw bad('Заявка уже обработана');
    const months = Math.max(1, Math.round(Number((req.body || {}).months) || r.months || 1));
    await mutateUser(r.userId, (u) => { u.subscription = extendSubscription(u.subscription, r.planId, months, cfg); });
    const { user } = await mutateUser(r.userId, () => {});
    await resolveRequest(id, 'approved', months, (req.body || {}).note, req.admin.name); detail = `+${months} мес.`;
    const planName = (cfg.plans.find((p) => p.id === r.planId) || {}).name || r.planId;
    const until = user.subscription && user.subscription.expiresAt ? new Date(user.subscription.expiresAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '';
    notifyPay(r.userId, `✅ Оплата подтверждена!\nТариф «${planName}» продлён на ${months} мес.${until ? ' — до ' + until : ''}.\nСпасибо, что пользуетесь XCAR!`);
  } else if (action === 'reject') {
    if (r.status !== 'pending') throw bad('Заявка уже обработана');
    const note = String((req.body || {}).note || '').trim();
    await resolveRequest(id, 'rejected', null, note, req.admin.name);
    notifyPay(r.userId, `❌ Заявка на оплату отклонена.${note ? '\nПричина: ' + note : ''}\nЕсли вы уже перевели деньги — ответьте в этот чат и приложите чек.`);
  } else if (action === 'refund') {
    if (r.status !== 'approved') throw bad('Возврат возможен только по подтверждённой оплате');
    const cut = (req.body || {}).cutSubscription !== false;
    if (cut) await mutateUser(r.userId, (u) => { const m = r.monthsGranted || r.months || 1; const d = new Date(u.subscription.expiresAt); d.setMonth(d.getMonth() - m); u.subscription.expiresAt = d.toISOString(); });
    await resolveRequest(id, 'refunded'); detail = cut ? 'подписка сокращена' : 'без изменения подписки';
  } else throw bad('Неизвестное действие');
  agg.invalidate();
  await audit.log(req, { approve: 'Подтвердил оплату подписки', reject: 'Отклонил заявку на оплату', refund: 'Оформил возврат оплаты' }[action], { type: 'payment', id, userId: r.userId }, 'ok', detail);
  res.json({ ok: true });
}));
// сообщение клиенту об оплате: в «Сообщения → Техподдержка» + push
async function notifyPay(userId, text) {
  try { await msgs.post(userId, { from: 'admin', text, adminName: 'Оплата XCAR', priority: 'high' }); } catch (e) {}
  push.sendToUser(userId, { title: 'XCAR · Оплата тарифа', body: text.slice(0, 160), tag: 'pay' }).catch(() => {});
}
// ---- Заявки на оплату (новый раздел «Тарифы → Заявки на оплату») ----
router.get('/payrequests', perm('payments.view'), wrap(async (req, res) => {
  const [list, usersData, cfg] = await Promise.all([listRequests(), readUsers(), readConfig()]);
  const um = new Map(usersData.users.map((u) => [u.id, u]));
  res.json({ requests: list.slice(0, 500).map((r) => { const u = um.get(r.userId) || {}; const plan = cfg.plans.find((p) => p.id === r.planId) || {};
    return Object.assign({}, r, { planName: plan.name || r.planId, carLimit: plan.carLimit, amount: r.amount || computeTariffAmount(plan.price || 0, r.months || 1, cfg.discounts),
      account: { id: u.id, companyName: u.companyName || '', fullName: u.fullName || '', phone: u.phone || '' },
      subscription: u.subscription ? publicSubscription(u.subscription, cfg) : null }); }), pending: list.filter((r) => r.status === 'pending').length });
}));
router.get('/payrequests/:id/receipt', perm('payments.view'), wrap(async (req, res) => {
  const r = (await listRequests()).find((x) => x.id === req.params.id);
  const a = r && r.receipt && msgs.readAttachment(r.receipt.id); if (!a) throw bad('Чек не найден', 404);
  res.setHeader('Content-Type', a.meta.type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.meta.name)}`);
  res.sendFile(a.file);
}));
// ---- Платёжные данные: QR-код, карты, телефон, ФИО — их видит клиент при выборе тарифа ----
router.get('/payment-settings', perm('payments.view', 'subscriptions.edit'), wrap(async (req, res) => { res.json({ payment: (await readConfig()).payment }); }));
router.put('/payment-settings', perm('payments.edit', 'subscriptions.edit'), wrap(async (req, res) => {
  const b = req.body || {}; const cfg = await readConfig(); const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  let qr = cfg.payment.qrCodeImage || '';
  if (b.qrCodeImage !== undefined) { qr = String(b.qrCodeImage || ''); if (qr && !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(qr)) throw bad('QR-код должен быть картинкой'); if (qr.length > 4 * 1024 * 1024) throw bad('Картинка QR-кода слишком большая (до 3 МБ)'); }
  const cards = (Array.isArray(b.cards) ? b.cards : []).slice(0, 10).map((c) => ({ bank: s(c.bank, 60), number: s(c.number, 40), holder: s(c.holder, 120), color: s(c.color, 20) })).filter((c) => c.bank || c.number);
  cfg.payment = Object.assign({}, cfg.payment, { holder: s(b.holder, 120), phone: s(b.phone, 40), comment: s(b.comment, 1000), instructions: s(b.instructions, 2000), qrTitle: s(b.qrTitle, 120), qrCodeImage: qr, cards,
    bank: cards[0] ? cards[0].bank : '', cardNumber: cards[0] ? cards[0].number : '' });
  await writeConfig(cfg); agg.invalidate();
  await audit.log(req, 'Изменил платёжные данные', { type: 'settings' }, 'ok', `карт: ${cards.length}${qr ? ', QR-код' : ''}`);
  res.json({ payment: cfg.payment });
}));
router.get('/subscriptions', perm('subscriptions.edit', 'payments.view'), wrap(async (req, res) => {
  const all = await agg.loadAll(); const cfg = all.cfg;
  const byPlan = {}; all.accounts.forEach((a) => { const k = a.sub.status === 'expired' ? 'expired' : (a.sub.planId || 'trial'); byPlan[k] = (byPlan[k] || 0) + 1; });
  res.json({ plans: cfg.plans, trialDays: cfg.trialDays, discounts: cfg.discounts, byPlan,
    expiringSoon: all.accounts.filter((a) => a.sub.status !== 'expired' && a.sub.daysLeft <= 5).map((a) => ({ id: a.user.id, name: agg.accName(a.user), daysLeft: a.sub.daysLeft, plan: a.sub.planName })) });
}));
router.put('/subscriptions', perm('subscriptions.edit'), wrap(async (req, res) => {
  const b = req.body || {}; const cfg = await readConfig();
  if (!Array.isArray(b.plans) || !b.plans.length) throw bad('Список тарифов не может быть пустым');
  const ids = new Set();
  const plans = b.plans.map((p) => {
    const id = String(p.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || ('plan' + Math.random().toString(36).slice(2, 6));
    if (ids.has(id)) throw bad('Повторяющийся код тарифа: ' + id); ids.add(id);
    if (!String(p.name || '').trim()) throw bad('У каждого тарифа должно быть название');
    return { id, name: String(p.name).trim().slice(0, 40), price: Math.max(0, Math.round(Number(p.price) || 0)), carLimit: Math.max(0, Math.round(Number(p.carLimit) || 0)) };
  });
  const td = Math.round(Number(b.trialDays)); if (!(td >= 0 && td <= 365)) throw bad('Бесплатный период — от 0 до 365 дней');
  const discounts = {}; [1, 3, 6, 12].forEach((m) => { const v = Number((b.discounts || {})[m]); discounts[m] = Number.isFinite(v) ? Math.min(0.9, Math.max(0, v)) : 0; });
  const saved = await writeConfig(Object.assign({}, cfg, { plans, trialDays: td, discounts }));
  agg.invalidate();
  await audit.log(req, 'Изменил тарифы', { type: 'plans' }, 'ok', plans.map((p) => `${p.name} ${p.price}₽/${p.carLimit}`).join('; ') + ` · пробный ${td} дн.`);
  res.json({ plans: saved.plans, trialDays: saved.trialDays, discounts: saved.discounts });
}));

/* ================= сообщения ================= */
router.get('/messages/threads', perm('messages.view'), wrap(async (req, res) => {
  const usersData = await readUsers(); const byId = new Map(usersData.users.map((u) => [u.id, u]));
  const threads = await msgs.threadsSummary(byId);
  const cfg = await readConfig();
  res.json({ threads, users: usersData.users.map((u) => ({ id: u.id, name: u.companyName || u.fullName, fullName: u.fullName, phone: u.phone, online: msgs.isOnline(u.id), blocked: !!u.blocked, subStatus: publicSubscription(u.subscription, cfg).status })) });
}));
router.get('/messages/threads/:userId', perm('messages.view'), wrap(async (req, res) => {
  const t = await msgs.getThreadForAdmin(req.params.userId, true);
  const u = (await readUsers()).users.find((x) => x.id === req.params.userId);
  res.json(Object.assign(t, { user: u ? { id: u.id, name: u.companyName || u.fullName, fullName: u.fullName, phone: u.phone, email: u.email } : null }));
}));
router.post('/messages/threads/:userId', perm('messages.send'), wrap(async (req, res) => {
  const b = req.body || {}; let m;
  try { m = await msgs.post(req.params.userId, { from: 'admin', text: b.text, attachments: b.attachments, adminName: req.admin.name }); } catch (e) { throw bad(e.message); }
  push.sendToUser(req.params.userId, { title: '💬 Сообщение от XCAR', body: (m.text || '📎 Вложение').slice(0, 160), tag: 'dm-' + m.id }).catch(() => {});
  await audit.log(req, 'Отправил сообщение', { type: 'user', id: req.params.userId }, 'ok', (m.text || '').slice(0, 80));
  res.json({ message: m });
}));
router.post('/messages/threads/:userId/pin/:msgId', perm('messages.send'), wrap(async (req, res) => { res.json({ pinned: await msgs.togglePin(req.params.userId, req.params.msgId) }); }));
router.delete('/messages/threads/:userId/:msgId', perm('messages.send'), wrap(async (req, res) => {
  await msgs.deleteMessage(req.params.userId, req.params.msgId); await audit.log(req, 'Удалил сообщение', { type: 'user', id: req.params.userId }); res.json({ ok: true });
}));
router.get('/messages/search', perm('messages.view'), wrap(async (req, res) => {
  const usersData = await readUsers(); res.json({ results: await msgs.searchMessages(req.query.q, new Map(usersData.users.map((u) => [u.id, u]))) });
}));
router.get('/attachments/:id', perm('messages.view', 'fleet.view'), wrap(async (req, res) => {
  const a = msgs.readAttachment(req.params.id); if (!a) throw bad('Файл не найден', 404);
  res.setHeader('Content-Type', a.meta.type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.meta.name)}`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(a.file);
}));
router.get('/broadcasts', perm('broadcast.send'), wrap(async (req, res) => { res.json({ broadcasts: await msgs.listBroadcasts() }); }));
router.post('/broadcasts', perm('broadcast.send'), wrap(async (req, res) => {
  let b; try { b = await msgs.createBroadcast(Object.assign({}, req.body || {}, { adminName: req.admin.name })); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Создал рассылку', { type: 'broadcast', id: b.id }, 'ok', `${b.audience}, ${b.priority}, отправка ${b.sendAt}`);
  deliverBroadcasts().catch(() => {});
  res.json({ broadcast: b });
}));
router.delete('/broadcasts/:id', perm('broadcast.send'), wrap(async (req, res) => {
  if (!(await msgs.cancelBroadcast(req.params.id))) throw bad('Рассылку уже нельзя отменить');
  await audit.log(req, 'Отменил рассылку', { type: 'broadcast', id: req.params.id }); res.json({ ok: true });
}));
// Общая группа (тот же чат, что в приложении)
router.get('/group', perm('messages.view'), wrap(async (req, res) => {
  const [chat, usersData, pmd, cm] = await Promise.all([community.readChat(), readUsers(), require('../lib/pm').snapshot(), chatmod.get()]);
  const bans = chat.bans || []; const mods = chat.mods || []; const pmBans = pmd.banned || []; const muted = chatmod.mutedMap(cm);
  const cnt = {}; chat.messages.forEach((m) => { if (m.userId) cnt[m.userId] = (cnt[m.userId] || 0) + 1; });
  // все пользователи: сначала модераторы, потом активные в группе, потом остальные
  const members = usersData.users.map((u) => ({ userId: u.id, name: u.companyName || u.fullName || u.phone, phone: u.phone, messages: cnt[u.id] || 0,
    banned: bans.includes(u.id), mod: mods.includes(u.id), pmBanned: pmBans.includes(u.id), supportBanned: cm.supportBans.includes(u.id), mutedUntil: muted[u.id] || null, online: msgs.isOnline(u.id) }))
    .sort((a, b) => (b.mod - a.mod) || (b.messages - a.messages) || String(a.name).localeCompare(String(b.name)));
  res.json({ closed: !!chat.closed, pmClosed: cm.pmClosed, supportClosed: cm.supportClosed, retention: cm.retention, fileMb: cm.fileMb, fileMaxMb: chatmod.HARD_MB, bans, mods, messages: chat.messages.slice(-300), members });
}));
router.post('/group', perm('messages.send'), wrap(async (req, res) => {
  const text = String((req.body || {}).text || '').trim(); if (!text) throw bad('Введите сообщение');
  const m = await community.postMessage({ userId: null, name: 'Администратор XCAR', text, fromAdmin: true });
  await audit.log(req, 'Написал в общую группу', { type: 'group' }, 'ok', text.slice(0, 80)); res.json({ message: m });
}));
router.put('/group/settings', perm('messages.send'), wrap(async (req, res) => {
  const closed = await community.setChatClosed(!!(req.body || {}).closed);
  await audit.log(req, closed ? 'Закрыл общую группу' : 'Открыл общую группу', { type: 'group' }); res.json({ closed });
}));
router.post('/group/ban', perm('messages.send'), wrap(async (req, res) => {
  const { userId, banned } = req.body || {}; if (!userId) throw bad('Не указан пользователь');
  await community.setChatBan(userId, !!banned);
  await audit.log(req, banned ? 'Запретил писать в группу' : 'Разрешил писать в группу', { type: 'user', id: userId }); res.json({ ok: true });
}));
router.post('/group/mod', perm('messages.send'), wrap(async (req, res) => {
  const { userId, on } = req.body || {}; if (!userId) throw bad('Не указан пользователь');
  await community.setChatMod(userId, !!on);
  await audit.log(req, on ? 'Назначил модератора группы' : 'Снял модератора группы', { type: 'user', id: userId }); res.json({ ok: true });
}));
router.post('/pm/ban', perm('messages.send'), wrap(async (req, res) => {
  const { userId, on } = req.body || {}; if (!userId) throw bad('Не указан пользователь');
  await require('../lib/pm').setBanned(userId, !!on);
  await audit.log(req, on ? 'Запретил личные сообщения' : 'Разрешил личные сообщения', { type: 'user', id: userId }); res.json({ ok: true });
}));
// ---- Модерация чатов: ограничить / заблокировать пользователя, закрыть чаты ----
router.put('/chatmod/settings', perm('messages.send'), wrap(async (req, res) => {
  const b = req.body || {}; const r = {};
  if (b.groupClosed !== undefined) { r.groupClosed = await community.setChatClosed(!!b.groupClosed); await audit.log(req, r.groupClosed ? 'Закрыл общую группу' : 'Открыл общую группу', { type: 'group' }); }
  if (b.pmClosed !== undefined || b.supportClosed !== undefined || b.retention || b.fileMb !== undefined) {
    Object.assign(r, await chatmod.setFlags({ pmClosed: b.pmClosed, supportClosed: b.supportClosed, retention: b.retention, fileMb: b.fileMb }));
    if (b.retention) { await audit.log(req, 'Изменил автоудаление сообщений', { type: 'chat' }, 'ok', JSON.stringify(r.retention)); runChatRetention().catch(() => {}); }
    if (b.fileMb !== undefined) await audit.log(req, 'Изменил лимит размера файла в чатах', { type: 'chat' }, 'ok', r.fileMb ? r.fileMb + ' МБ' : 'без ограничения');
    if (b.pmClosed !== undefined) await audit.log(req, b.pmClosed ? 'Отключил личные сообщения' : 'Включил личные сообщения', { type: 'chat' });
    if (b.supportClosed !== undefined) await audit.log(req, b.supportClosed ? 'Закрыл техподдержку' : 'Открыл техподдержку', { type: 'chat' });
  }
  res.json(r);
}));
router.post('/chatmod/user', perm('messages.send'), wrap(async (req, res) => {
  const { userId, action, hours } = req.body || {}; if (!userId) throw bad('Не указан пользователь');
  const who = req.admin && (req.admin.name || req.admin.login);
  if (action === 'mute') { const until = await chatmod.setMute(userId, hours === 'forever' ? 'forever' : Math.max(1, Math.min(24 * 365, Number(hours) || 24)), who); await audit.log(req, 'Ограничил сообщения пользователя', { type: 'user', id: userId }, 'ok', until === 'forever' ? 'бессрочно' : 'до ' + until); return res.json({ ok: true, until }); }
  if (action === 'unmute') { await chatmod.setMute(userId, 0); await audit.log(req, 'Снял ограничение сообщений', { type: 'user', id: userId }); return res.json({ ok: true }); }
  if (action === 'block' || action === 'unblock') {
    const on = action === 'block';
    await community.setChatBan(userId, on); await require('../lib/pm').setBanned(userId, on); await chatmod.setSupportBan(userId, on);
    if (!on) await chatmod.setMute(userId, 0);
    await audit.log(req, on ? 'Заблокировал пользователя во всех чатах' : 'Разблокировал пользователя во всех чатах', { type: 'user', id: userId }); return res.json({ ok: true });
  }
  if (action === 'supportBan' || action === 'supportUnban') { await chatmod.setSupportBan(userId, action === 'supportBan'); await audit.log(req, action === 'supportBan' ? 'Запретил писать в техподдержку' : 'Разрешил писать в техподдержку', { type: 'user', id: userId }); return res.json({ ok: true }); }
  throw bad('Неизвестное действие');
}));
// очистка чатов целиком: group | pm | support
router.post('/chatmod/clear', perm('messages.send'), wrap(async (req, res) => {
  const what = (req.body || {}).what; let n = 0;
  if (what === 'group') n = await community.clearChat();
  else if (what === 'pm') n = await require('../lib/pm').adminClear();
  else if (what === 'support') n = await msgs.clearAll();
  else throw bad('Не указан чат');
  await audit.log(req, 'Очистил чат', { type: 'chat', id: what }, 'ok', 'удалено сообщений: ' + n); res.json({ ok: true, removed: n });
}));
// личные переписки пользователей — для модерации
router.get('/pm/threads', perm('messages.send'), wrap(async (req, res) => {
  const [list, usersData] = await Promise.all([require('../lib/pm').adminThreads(), readUsers()]);
  const nm = {}; usersData.users.forEach((u) => { nm[u.id] = u.companyName || u.fullName || u.phone; });
  res.json({ threads: list.slice(0, 500).map((t) => Object.assign(t, { names: t.users.map((u) => nm[u] || 'Удалённый пользователь') })) });
}));
router.get('/pm/threads/:key', perm('messages.send'), wrap(async (req, res) => {
  const usersData = await readUsers(); const nm = {}; usersData.users.forEach((u) => { nm[u.id] = u.companyName || u.fullName || u.phone; });
  const list = await require('../lib/pm').adminThread(req.params.key);
  res.json({ messages: list.map((m) => Object.assign({}, m, { fromName: nm[m.from] || '—' })) });
}));
router.delete('/pm/threads/:key/:id', perm('messages.send'), wrap(async (req, res) => {
  if (!(await require('../lib/pm').adminDelete(req.params.key, req.params.id))) throw bad('Сообщение не найдено', 404);
  await audit.log(req, 'Удалил личное сообщение', { type: 'chat', id: req.params.key }); res.json({ ok: true });
}));
router.delete('/pm/threads/:key', perm('messages.send'), wrap(async (req, res) => {
  const n = await require('../lib/pm').adminClear(req.params.key);
  await audit.log(req, 'Очистил личную переписку', { type: 'chat', id: req.params.key }, 'ok', 'удалено: ' + n); res.json({ ok: true, removed: n });
}));
router.delete('/messages/threads/:userId', perm('messages.send'), wrap(async (req, res) => {
  const n = await msgs.clearThread(req.params.userId);
  await audit.log(req, 'Очистил переписку техподдержки', { type: 'user', id: req.params.userId }, 'ok', 'удалено: ' + n); res.json({ ok: true, removed: n });
}));
// автоудаление старых сообщений по настройкам модерации (раз в час)
async function runChatRetention() {
  const r = (await chatmod.get()).retention || {};
  if (r.group) await community.pruneChat(r.group);
  if (r.pm) await require('../lib/pm').prune(r.pm);
  if (r.support) await msgs.prune(r.support);
}
router.delete('/group/messages/:id', perm('messages.send'), wrap(async (req, res) => {
  await community.deleteMessage(req.params.id); await audit.log(req, 'Удалил сообщение группы', { type: 'group', id: req.params.id }); res.json({ ok: true });
}));
// Новости (окно по центру в приложении + оценки)
router.get('/news', perm('broadcast.send', 'messages.view'), wrap(async (req, res) => {
  const [news, usersData] = await Promise.all([community.listNewsAdmin(), readUsers()]);
  const names = {}; usersData.users.forEach((u) => { names[u.id] = u.companyName || u.fullName || u.phone; });
  res.json({ usersCount: usersData.users.length, news: news.map((n) => Object.assign({}, n, { ratings: Object.entries(n.ratings).map(([uid, stars]) => ({ userId: uid, name: names[uid] || 'Аккаунт удалён', stars })) })) });
}));
router.post('/news', perm('broadcast.send'), wrap(async (req, res) => {
  const { title, body, push: alsoPush } = req.body || {}; if (!String(body || '').trim()) throw bad('Введите текст новости');
  const n = await community.createNews(title, body); let sent = 0;
  if (alsoPush) for (const uid of push.allUserIdsWithSubs()) { try { const r = await push.sendToUser(uid, { title: n.title, body: n.body.slice(0, 300), tag: 'news-' + n.id }); sent += r.sent || 0; } catch (e) {} }
  await audit.log(req, 'Опубликовал новость', { type: 'news', id: n.id }, 'ok', n.title); res.json({ news: n, pushSent: sent });
}));
router.put('/news/:id', perm('broadcast.send'), wrap(async (req, res) => {
  const n = await community.updateNews(req.params.id, req.body || {}); if (!n) throw bad('Новость не найдена', 404);
  await audit.log(req, 'Изменил новость', { type: 'news', id: n.id }); res.json({ ok: true });
}));
router.delete('/news/:id', perm('broadcast.send'), wrap(async (req, res) => {
  if (!(await community.deleteNews(req.params.id))) throw bad('Новость не найдена', 404);
  await audit.log(req, 'Удалил новость', { type: 'news', id: req.params.id }); res.json({ ok: true });
}));

/* ================= чёрный список ================= */
router.get('/blacklist/info', perm('blacklist.view'), wrap(async (req, res) => {
  const i = await blacklist.info();
  const all = await agg.loadAll(); const appCount = agg.buildClients(all, agg.localNow(await tz())).filter((c) => c.blacklisted).length;
  res.json({ updatedAt: i.updatedAt, total: i.total + appCount, baseTotal: i.total, appClients: appCount, settings: i.settings, files: can(req, 'blacklist.edit') ? i.files : undefined });
}));
router.get('/blacklist/search', perm('blacklist.view'), wrap(async (req, res) => {
  const all = await agg.loadAll();
  const results = await blacklist.search(String(req.query.q || ''), agg.buildClients(all, agg.localNow(await tz())).filter((c) => c.blacklisted));
  res.json({ results });
}));
router.post('/blacklist/files', perm('blacklist.edit'), wrap(async (req, res) => {
  let m; try { const b = req.body || {}; m = await blacklist.addFile({ name: b.name, content: b.content, dataUrl: b.dataUrl, split: b.split }); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Загрузил файл в базу ЧС', { type: 'blacklist', id: m.id }, 'ok', `${m.name}: ${m.entries} записей`); res.json({ file: m });
}));
router.get('/blacklist/files/:id', perm('blacklist.edit'), wrap(async (req, res) => {
  const r = await blacklist.getFile(req.params.id); if (!r) throw bad('Файл не найден', 404); res.json(r);
}));
router.put('/blacklist/files/:id', perm('blacklist.edit'), wrap(async (req, res) => {
  const b = req.body || {}; let f;
  try { f = await blacklist.updateFile(req.params.id, { name: b.name, content: b.content, split: b.split }); } catch (e) { throw bad(e.message); }
  if (!f) throw bad('Файл не найден', 404);
  await audit.log(req, 'Изменил файл базы проверки клиента', { type: 'blacklist', id: f.id }, 'ok', `${f.name}: ${f.entries} записей`); res.json({ file: f });
}));
router.post('/blacklist/preview', perm('blacklist.edit'), wrap(async (req, res) => {
  try { res.json(await blacklist.preview(req.body || {})); } catch (e) { throw bad(e.message); }
}));
router.put('/blacklist/settings', perm('blacklist.edit'), wrap(async (req, res) => {
  const r = await blacklist.setSettings(req.body || {}); await audit.log(req, 'Изменил настройки карточек базы', { type: 'blacklist' }); res.json({ settings: r });
}));
// Telegram-бот, который пополняет базу
router.get('/blacklist/bot', perm('blacklist.edit'), wrap(async (req, res) => { res.json(await tgbot.get()); }));
router.put('/blacklist/bot', perm('blacklist.edit'), wrap(async (req, res) => {
  let r; try { r = await tgbot.set(req.body || {}); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Изменил настройки Telegram-бота базы', { type: 'blacklist' }, 'ok', r.enabled ? 'включён' : 'выключен'); res.json(r);
}));
// Общая база XCAR (чёрные списки и базы, которыми делятся пользователи приложения)
router.get('/blacklist/common', perm('blacklist.view'), wrap(async (req, res) => {
  res.json(checkshare.adminList(String(req.query.q || '').slice(0, 100), { hidden: req.query.hidden === '1', blOnly: req.query.bl === '1' }));
}));
router.put('/blacklist/common/:id', perm('blacklist.edit'), wrap(async (req, res) => {
  if (!checkshare.adminEdit(req.params.id, req.body || {})) throw bad('Запись не найдена', 404);
  await audit.log(req, 'Изменил запись общей базы', { type: 'blacklist' }); res.json({ ok: true });
}));
router.delete('/blacklist/common/:id', perm('blacklist.edit'), wrap(async (req, res) => {
  if (!checkshare.adminHide(req.params.id, true)) throw bad('Запись не найдена', 404);
  await audit.log(req, 'Удалил запись из общей базы', { type: 'blacklist' }); res.json({ ok: true });
}));
router.post('/blacklist/common/:id/restore', perm('blacklist.edit'), wrap(async (req, res) => {
  checkshare.adminHide(req.params.id, false); checkshare.adminReset(req.params.id);
  await audit.log(req, 'Восстановил запись общей базы', { type: 'blacklist' }); res.json({ ok: true });
}));
router.delete('/blacklist/files/:id', perm('blacklist.edit'), wrap(async (req, res) => {
  if (!(await blacklist.removeFile(req.params.id))) throw bad('Файл не найден', 404);
  await audit.log(req, 'Удалил файл из базы ЧС', { type: 'blacklist', id: req.params.id }); res.json({ ok: true });
}));

/* ================= доступ к базе Telegram ================= */
router.get('/tg-access', perm('blacklist.view'), wrap(async (req, res) => {
  const usersData = await readUsers(); const um = new Map(usersData.users.map((u) => [u.id, u]));
  res.json({ requests: (await tgAccess.list()).map((r) => { const u = um.get(r.uid) || {}; return Object.assign(r, { account: { id: r.uid, fullName: u.fullName || '', companyName: u.companyName || '', phone: u.phone || '' } }); }) });
}));
router.get('/tg-access/:uid/files/:i', perm('blacklist.view'), wrap(async (req, res) => {
  const f = await tgAccess.file(req.params.uid, req.params.i); if (!f) throw bad('Файл не найден', 404);
  res.setHeader('Content-Type', f.meta.type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.meta.name)}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(f.path);
}));
router.post('/tg-access/:uid', perm('blacklist.edit'), wrap(async (req, res) => {
  const action = String((req.body || {}).action || '');
  if (!['approve', 'reject', 'revoke'].includes(action)) throw bad('Неизвестное действие');
  let r; try { r = await tgAccess.decide(req.params.uid, action, req.admin.name, (req.body || {}).note); } catch (e) { throw bad(e.message, 404); }
  const text = action === 'approve' ? '✅ Доступ к базе Telegram в «Проверке клиента» открыт.' : action === 'revoke' ? '⛔ Доступ к базе Telegram закрыт администратором.' + (r.note ? ' Причина: ' + r.note : '') : '❌ Заявка на доступ к базе Telegram отклонена.' + (r.note ? ' Причина: ' + r.note : '') + ' Вы можете подать её заново.';
  try { await msgs.post(req.params.uid, { from: 'admin', text, adminName: req.admin.name }); } catch (e) {}
  push.sendToUser(req.params.uid, { title: 'XCAR · База Telegram', body: text.slice(0, 160), tag: 'tg-access' }).catch(() => {});
  await audit.log(req, action === 'approve' ? 'Открыл доступ к базе Telegram' : action === 'revoke' ? 'Закрыл доступ к базе Telegram' : 'Отклонил заявку на базу Telegram', { type: 'user', id: req.params.uid });
  res.json({ request: r });
}));

/* ================= готовые машины для пользователей ================= */
router.get('/car-presets', perm('fleet.view'), wrap(async (req, res) => { res.json({ items: await carPresets.list() }); }));
router.post('/car-presets', perm('fleet.edit'), wrap(async (req, res) => {
  let it; try { it = await carPresets.create(req.body || {}, req.admin.name); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Добавил готовую машину', { type: 'preset', id: it.id }, 'ok', `${it.make} ${it.model} · ${it.target === 'all' ? 'всем' : it.userIds.length + ' польз.'}`); res.json({ item: it });
}));
router.put('/car-presets/:id', perm('fleet.edit'), wrap(async (req, res) => {
  let it; try { it = await carPresets.update(req.params.id, req.body || {}); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Изменил готовую машину', { type: 'preset', id: it.id }); res.json({ item: it });
}));
router.delete('/car-presets/:id', perm('fleet.edit'), wrap(async (req, res) => {
  await carPresets.remove(req.params.id); await audit.log(req, 'Удалил готовую машину', { type: 'preset', id: req.params.id }); res.json({ ok: true });
}));

/* ================= установочные файлы приложения ================= */
router.get('/releases', perm('settings.edit', 'servers.view'), wrap(async (req, res) => { res.json({ releases: await releases.info() }); }));
router.post('/releases/:platform', perm('settings.edit'), express.raw({ type: '*/*', limit: '300mb' }), wrap(async (req, res) => {
  let r; try { r = await releases.save(req.params.platform, req.body, { version: req.query.version, name: req.query.name, notes: req.query.notes, by: req.admin.name }); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Загрузил обновление приложения', { type: 'release', id: req.params.platform }, 'ok', `${r.name} · ${r.version}`);
  res.json({ release: r });
}));
router.delete('/releases/:platform', perm('settings.edit'), wrap(async (req, res) => {
  await releases.remove(req.params.platform); await audit.log(req, 'Удалил обновление приложения', { type: 'release', id: req.params.platform }); res.json({ ok: true });
}));

/* ================= серверы ================= */
router.get('/servers', perm('servers.view'), wrap(async (req, res) => {
  const s = await ctlSettings.get();
  const results = req.query.check ? await monitor.checkAll(s.servers) : s.servers.map((sv) => monitor.last(sv.id) || { id: sv.id, name: sv.name, role: sv.role, url: sv.url || '(этот сервер)', self: !sv.url, online: null });
  res.json({ servers: s.servers, results, health: monitor.localMetrics() });
}));
router.post('/servers/check', perm('servers.view'), wrap(async (req, res) => {
  const s = await ctlSettings.get(); res.json({ results: await monitor.checkAll(s.servers), health: monitor.localMetrics() });
}));
router.put('/servers', perm('servers.edit'), wrap(async (req, res) => {
  let r; try { r = await ctlSettings.patch('servers', (req.body || {}).servers); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Изменил список серверов', { type: 'servers' }, 'ok', r.servers.map((x) => `${x.name}: ${x.url || 'этот'}`).join('; '));
  res.json({ servers: r.servers });
}));

/* ================= резервные копии ================= */
router.get('/backups', perm('backup.view'), wrap(async (req, res) => {
  const s = await ctlSettings.get(); res.json({ backups: backup.list(), health: await backup.health(s.backup), settings: s.backup });
}));
router.post('/backups', perm('backup.create'), wrap(async (req, res) => {
  const m = await backup.create('manual', req.admin.name);
  await audit.log(req, 'Создал резервную копию', { type: 'backup', id: m.id }, 'ok', `${m.usersCount} польз., ${Math.round(m.size / 1024)} КБ`);
  res.json({ backup: m });
}));
router.get('/backups/:id/download', perm('backup.view'), wrap(async (req, res) => {
  const f = backup.findFile(req.params.id); if (!f) throw bad('Копия не найдена', 404);
  await audit.log(req, 'Скачал резервную копию', { type: 'backup', id: req.params.id });
  res.download(f);
}));
router.get('/backups/:id/preview', perm('backup.restore'), wrap(async (req, res) => {
  const p = backup.preview(req.params.id); if (!p) throw bad('Копия не найдена', 404); res.json(p);
}));
router.post('/backups/:id/restore', perm('backup.restore'), wrap(async (req, res) => {
  const b = req.body || {};
  if (b.confirm !== 'ВОССТАНОВИТЬ') throw bad('Подтвердите восстановление: введите слово ВОССТАНОВИТЬ');
  let r; try { r = await backup.restore(req.params.id, { userIds: b.userIds, includeAccounts: !!b.includeAccounts, includeSystem: !!b.includeSystem }, req.admin.name); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Восстановил данные из копии', { type: 'backup', id: req.params.id }, 'ok', `данных: ${r.restored}, аккаунтов: ${r.accounts}, системных файлов: ${r.systemFiles}; страховочная копия ${r.safetyBackup}`);
  res.json(r);
}));
router.delete('/backups/:id', perm('backup.create'), wrap(async (req, res) => {
  if (!backup.remove(req.params.id)) throw bad('Копия не найдена', 404);
  await audit.log(req, 'Удалил резервную копию', { type: 'backup', id: req.params.id }); res.json({ ok: true });
}));
router.post('/backups/import', perm('backup.restore'), wrap(async (req, res) => {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(String((req.body || {}).dataUrl || '')); if (!m) throw bad('Выберите файл .json.gz');
  let meta; try { meta = backup.importFile(Buffer.from(m[1], 'base64')); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Загрузил файл резервной копии', { type: 'backup', id: meta.id }); res.json({ backup: meta });
}));
router.put('/backups/settings', perm('backup.create'), wrap(async (req, res) => {
  const r = await ctlSettings.patch('backup', req.body || {});
  await audit.log(req, 'Изменил расписание бэкапов', { type: 'backup' }, 'ok', `авто: ${r.backup.auto ? 'да' : 'нет'}, каждые ${r.backup.everyHours} ч, хранить ${r.backup.keep}`);
  res.json({ settings: r.backup });
}));

/* ================= журнал, администраторы, настройки ================= */
router.get('/audit', perm('audit.view'), wrap(async (req, res) => {
  res.json(await audit.list({ q: req.query.q, adminId: req.query.adminId, objectId: req.query.objectId, limit: Math.min(1000, Number(req.query.limit) || 300), offset: Number(req.query.offset) || 0 }));
}));
router.get('/admins', perm('admins.manage'), wrap(async (req, res) => {
  const admins = await rbac.listAdmins(); const sessions = await rbac.listSessions();
  res.json({ admins: admins.map((a) => Object.assign(a, { sessions: sessions.filter((s) => s.adminId === a.id).length })), roles: rbac.ROLES, permissions: rbac.PERMISSIONS });
}));
router.post('/admins', perm('admins.manage'), wrap(async (req, res) => {
  let a; try { a = await rbac.createAdmin(req.body || {}); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Создал администратора', { type: 'admin', id: a.id, name: a.login }, 'ok', a.role); res.json({ admin: a });
}));
router.put('/admins/:id', perm('admins.manage'), wrap(async (req, res) => {
  let a; try { a = await rbac.updateAdmin(req.params.id, req.body || {}); } catch (e) { throw bad(e.message); }
  if ((req.body || {}).disabled) await rbac.revokeAllForAdmin(req.params.id);
  if ((req.body || {}).reset2fa) await rbac.disableTotp(req.params.id, null, true);
  await audit.log(req, 'Изменил администратора', { type: 'admin', id: a.id, name: a.login }, 'ok', Object.keys(req.body || {}).filter((k) => k !== 'password').join(', ') + ((req.body || {}).password ? ', пароль' : ''));
  res.json({ admin: a });
}));
router.delete('/admins/:id', perm('admins.manage'), wrap(async (req, res) => {
  try { await rbac.deleteAdmin(req.params.id); } catch (e) { throw bad(e.message); }
  await rbac.revokeAllForAdmin(req.params.id);
  await audit.log(req, 'Удалил администратора', { type: 'admin', id: req.params.id }); res.json({ ok: true });
}));
router.get('/settings', wrap(async (req, res) => {
  const s = await ctlSettings.get();
  res.json({ general: s.general, notifications: s.notifications, quickReplies: s.quickReplies, backup: s.backup, servers: s.servers, app: s.app, version: monitor.VERSION });
}));
router.put('/settings/:section', wrap(async (req, res) => {
  const section = req.params.section;
  const need = section === 'quickReplies' ? 'messages.send' : section === 'servers' ? 'servers.edit' : 'settings.edit';
  if (!can(req, need)) return res.status(403).json({ error: 'Недостаточно прав для этого действия' });
  let r; try { r = await ctlSettings.patch(section, section === 'quickReplies' ? (req.body || {}).items : req.body); } catch (e) { throw bad(e.message); }
  await audit.log(req, 'Изменил настройки', { type: 'settings', id: section });
  res.json(r);
}));

/* ================= фоновые задачи ================= */
async function deliverBroadcasts() {
  return msgs.deliverDue(async () => (await readUsers()).users, (u) => publicSubscription(u.subscription, { plans: [], trialDays: 0 }), (uid, p) => push.sendToUser(uid, p));
}
function startJobs() {
  setInterval(() => { deliverBroadcasts().catch((e) => console.error('Рассылки:', e.message)); }, 20000).unref();
  setTimeout(() => runChatRetention().catch(() => {}), 30 * 1000).unref();
  tgbot.start();
  setInterval(() => { runChatRetention().catch((e) => console.error('Автоудаление сообщений:', e.message)); }, 60 * 60 * 1000).unref();
  setInterval(async () => { try { const s = await ctlSettings.get(); await backup.autoTick(s.backup); } catch (e) { console.error('Авто-бэкап:', e.message); } }, 5 * 60 * 1000).unref();
  setTimeout(async () => { try { const s = await ctlSettings.get(); await backup.autoTick(s.backup); } catch (e) {} }, 60 * 1000).unref();
  setInterval(async () => { try { const s = await ctlSettings.get(); await monitor.checkAll(s.servers); } catch (e) {} }, 60 * 1000).unref();
  setTimeout(async () => { try { const s = await ctlSettings.get(); await monitor.checkAll(s.servers); } catch (e) {} }, 3000).unref();
}

module.exports = { router, startJobs };
