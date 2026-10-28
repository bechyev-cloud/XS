// Новости (для клиента) и общая группа-чат пользователей XCAR.
// Админская часть — в routes/admin.js (/api/admin/news, /api/admin/chat...).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../lib/auth');
const { readUsers } = require('../lib/store');
const c = require('../lib/community');

const dm = require('../lib/control/messages');
const mod = require('../lib/control/chatmod');
// вложения (файлы, фото, резервные копии) — до 5 штук по 10 МБ
function saveAtts(list, maxBytes) { const out = []; for (const a of (Array.isArray(list) ? list : []).slice(0, 5)) { if (!a || !a.dataUrl) continue; const m = dm.saveAttachment(a, maxBytes); out.push(dm.attOf(m, a)); } return out; }

const router = express.Router();
// ссылки на вложения открываются в <img>/новой вкладке — токен можно передать в ?t=
router.use((req, res, next) => { if (!req.headers.authorization && req.query.t) req.headers.authorization = 'Bearer ' + String(req.query.t); next(); });
router.use(authMiddleware);
// звания (разработчик / админ) — подставляются в карточки пользователей и сообщения группы
const roles = require('../lib/roles');
let ROLES = {};
router.use(async (req, res, next) => { try { ROLES = await roles.map(); PRIV = await profile.privMap(); const pa = await profile.all(); PRIV_AV = {}; PRIV_WL = {}; Object.keys(pa).forEach((k) => { if (pa[k].avatarAt) PRIV_AV[k] = pa[k].avatarAt; if (pa[k].wideAt) PRIV_WL[k] = pa[k].wideAt; }); } catch (e) {} next(); });
// личная страница пользователя и «кто что видит»
const profile = require('../lib/profile');
let PRIV = {};
// rel — кем viewer приходится владельцу: 'me' | 'contact' (владелец добавил viewer в контакты) | 'guest'
function relOf(d, owner, viewer) { if (owner === viewer) return 'me'; return ((d && d.contacts && d.contacts[owner]) || []).includes(viewer) ? 'contact' : 'guest'; }
function privAllows(owner, key, rel) { const lv = (PRIV[owner] || profile.DEF_PRIV)[key] || profile.DEF_PRIV[key]; return profile.allowed(lv, rel); }

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Слишком часто. Подождите немного перед следующим сообщением.' },
});

// ---- Новости ----
router.get('/news', async (req, res) => {
  const users = await readUsers(); const u = users.users.find((x) => x.id === req.userId);
  res.json({ news: await c.listNewsForUser(req.userId, u && u.createdAt) });
});
router.post('/news/:id/seen', async (req, res) => {
  const n = await c.markNewsSeen(req.params.id, req.userId);
  if (!n) return res.status(404).json({ error: 'Новость не найдена' });
  res.json({ news: n });
});
router.post('/news/:id/rate', async (req, res) => {
  const stars = Math.round(Number((req.body || {}).stars));
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Оценка — от 1 до 5 звёзд' });
  const n = await c.rateNews(req.params.id, req.userId, stars);
  if (!n) return res.status(404).json({ error: 'Новость не найдена' });
  res.json({ news: n });
});

// ---- Общая группа ----
// Модераторы (назначает администратор в XCAR CONTROL) могут писать в закрытую группу,
// удалять сообщения участников и запрещать им писать.
function userName(u) { return u ? ((u.companyName || u.fullName || 'Пользователь') + (u.companyName && u.fullName ? ' · ' + u.fullName : '')) : 'Пользователь'; }
function chatView(chat, userId, after, since) {
  const mods = chat.mods || []; const bans = chat.bans || []; const isMod = mods.includes(userId);
  // кто присоединился позже — не видит переписку, которая была до его регистрации
  let messages = since ? chat.messages.filter((m) => m.createdAt >= since) : chat.messages;
  if (after) { const i = messages.findIndex((m) => m.id === after); if (i >= 0) messages = messages.slice(i + 1); else messages = messages.slice(-150); }
  else messages = messages.slice(-150);
  return {
    closed: !!chat.closed, banned: bans.includes(userId), isMod, delRev: chat.delRev || 0,
    messages: messages.map((m) => Object.assign({ id: m.id, name: m.name, text: m.text, attachments: m.attachments || [], createdAt: m.createdAt, fromAdmin: !!m.fromAdmin, deleted: !!m.deleted, delMod: !!m.delMod,
      mod: !!m.userId && mods.includes(m.userId), mine: m.userId === userId, uid: m.userId || null, role: (m.userId && ROLES[m.userId]) || '' },
      isMod && m.userId ? { authorBanned: bans.includes(m.userId) } : {})),
    lastId: chat.messages.length ? chat.messages[chat.messages.length - 1].id : null,
  };
}
router.get('/chat', async (req, res) => {
  const chat = await c.readChat();
  const st = await mod.status(req.userId);
  const me = (await readUsers()).users.find((x) => x.id === req.userId);
  res.json(Object.assign(chatView(chat, req.userId, req.query.after, me && me.createdAt), { mutedUntil: st.mutedUntil, fileMb: st.fileMb }));
});
// своё сообщение в группе — удалить у всех (в течение 3 часов)
router.delete('/chat/my/:id', async (req, res) => {
  try { await c.deleteOwnMessage(req.userId, req.params.id, dm.DELETE_FOR_ALL_MS); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/chat', chatLimiter, async (req, res) => {
  const text = String((req.body || {}).text || '').trim();
  const hasAtt = Array.isArray((req.body || {}).attachments) && req.body.attachments.length;
  if (!text && !hasAtt) return res.status(400).json({ error: 'Введите сообщение' });
  const deny = await mod.denyReason(req.userId, 'group'); if (deny) return res.status(403).json({ error: deny });
  const chat = await c.readChat();
  const isMod = (chat.mods || []).includes(req.userId);
  if (chat.closed && !isMod) return res.status(403).json({ error: 'Администратор закрыл группу — писать могут только администратор и модераторы' });
  if ((chat.bans || []).includes(req.userId)) return res.status(403).json({ error: 'Вам запрещено писать в группу' });
  const users = await readUsers();
  const u = users.users.find((x) => x.id === req.userId);
  let attachments = [];
  try { attachments = saveAtts(req.body.attachments, await mod.maxBytes()); } catch (e) { return res.status(400).json({ error: e.message }); }
  const m = await c.postMessage({ userId: req.userId, name: userName(u), text, fromMod: isMod, attachments });
  res.json({ ok: true, id: m.id });
});
async function needMod(req, res) {
  const chat = await c.readChat();
  if (!(chat.mods || []).includes(req.userId)) { res.status(403).json({ error: 'Только модератор группы может это сделать' }); return null; }
  return chat;
}
// удалить у всех от имени разработчика/админа приложения: админ не может удалить сообщение разработчика
async function appModCheck(req, authorId) {
  const me = ROLES[req.userId]; if (me !== 'dev' && me !== 'admin') return false;
  if (authorId && authorId !== req.userId && ROLES[authorId] === 'dev' && me !== 'dev') throw new Error('Сообщение разработчика может удалить только разработчик');
  return true;
}
router.delete('/chat/messages/:id', async (req, res) => {
  if (ROLES[req.userId] === 'dev' || ROLES[req.userId] === 'admin') {
    try {
      const chat0 = await c.readChat(); const m0 = chat0.messages.find((x) => x.id === req.params.id);
      if (!m0) return res.status(404).json({ error: 'Сообщение уже удалено' });
      if (m0.fromAdmin) return res.status(403).json({ error: 'Сообщение администрации XCAR удалить нельзя' });
      await appModCheck(req, m0.userId); await c.modDeleteMessage(m0.id, req.userId); return res.json({ ok: true });
    } catch (e) { return res.status(403).json({ error: e.message }); }
  }
  const chat = await needMod(req, res); if (!chat) return;
  const m = chat.messages.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Сообщение уже удалено' });
  if (m.fromAdmin) return res.status(403).json({ error: 'Сообщение администратора удалить нельзя' });
  if (m.userId !== req.userId && (chat.mods || []).includes(m.userId)) return res.status(403).json({ error: 'Сообщение другого модератора удалить нельзя' });
  await c.deleteMessage(m.id); res.json({ ok: true });
});
router.post('/chat/ban', async (req, res) => {
  const chat = await needMod(req, res); if (!chat) return;
  const { userId, banned } = req.body || {};
  if (!userId || userId === req.userId) return res.status(400).json({ error: 'Неверный пользователь' });
  if ((chat.mods || []).includes(userId)) return res.status(403).json({ error: 'Модератора может ограничить только администратор' });
  await c.setChatBan(userId, !!banned); res.json({ ok: true });
});

// ---- Личные сообщения между пользователями ----
const pm = require('../lib/pm');
const { isOnline } = require('../lib/control/messages');
const pmLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком часто. Подождите немного.' } });
// ctx = { d: pm.snapshot(), viewer } — чтобы скрыть «в сети», если владелец так настроил
function pubUser(u, ctx) {
  const rel = ctx ? relOf(ctx.d, u.id, ctx.viewer) : 'guest';
  const p = PRIV_AV[u.id];
  return { userId: u.id, name: u.companyName || u.fullName || 'Пользователь', sub: u.companyName && u.fullName ? u.fullName : '', online: privAllows(u.id, 'online', rel) ? isOnline(u.id) : false, role: ROLES[u.id] || '', av: p || 0, wl: PRIV_WL[u.id] || 0 };
}
let PRIV_AV = {}, PRIV_WL = {};
router.get('/pm', async (req, res) => {
  const [d, users] = await Promise.all([pm.snapshot(), readUsers()]);
  const byId = {}; users.users.forEach((u) => { byId[u.id] = u; });
  const list = pm.dialogs(d, req.userId).filter((x) => byId[x.userId]).map((x) => Object.assign(pubUser(byId[x.userId], { d, viewer: req.userId }), x))
    .sort((a, b) => ((b.last && b.last.createdAt) || '').localeCompare((a.last && a.last.createdAt) || '') || a.name.localeCompare(b.name));
  const st = await mod.status(req.userId);
  const rq = pm.requestsOf(d, req.userId);
  const requests = rq.incoming.filter((r) => byId[r.from]).map((r) => Object.assign(pubUser(byId[r.from], { d, viewer: req.userId }), { at: r.at }));
  const live = users.users.filter((u) => !u.blocked && !u.deletedAt);
  res.json({ me: await roles.me(req.userId), dialogs: list, requests, outgoing: rq.outgoing, members: live.length, online: live.filter((u) => isOnline(u.id)).length, banned: (d.banned || []).includes(req.userId), pmClosed: st.pmClosed, mutedUntil: st.mutedUntil, fileMb: st.fileMb });
});
router.get('/pm/unread', async (req, res) => { const n = await pm.unread(req.userId); const rq = pm.requestsOf(await pm.snapshot(), req.userId); res.json({ unread: n + rq.incoming.length, requests: rq.incoming.length }); });
router.get('/pm/search', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const digits = q.replace(/\D/g, '');
  const [d, users] = await Promise.all([pm.snapshot(), readUsers()]);
  const mine = new Set(d.contacts[req.userId] || []);
  const pa = await profile.all();
  const found = users.users.filter((u) => u.id !== req.userId && !u.blocked && !u.deletedAt && ((pa[u.id] || {}).search !== false || mine.has(u.id)) && (
    ((u.companyName || '') + ' ' + (u.fullName || '')).toLowerCase().includes(q) ||
    (digits.length >= 5 && String(u.phone || '').replace(/\D/g, '').endsWith(digits))))
    .slice(0, 30).map((u) => Object.assign(pubUser(u, { d, viewer: req.userId }), { contact: mine.has(u.id) }));
  res.json({ users: found });
});
async function existingUser(id) { const users = await readUsers(); return users.users.find((u) => u.id === id); }
router.post('/pm/contacts', async (req, res) => {
  const { userId, on } = req.body || {};
  if (!userId || userId === req.userId || !(await existingUser(userId))) return res.status(400).json({ error: 'Пользователь не найден' });
  try {
    if (on === false) { await pm.removeContact(req.userId, userId); return res.json({ ok: true, status: 'removed' }); }
    res.json(Object.assign({ ok: true }, await pm.requestContact(req.userId, userId)));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// ответ на запрос в контакты: { userId, accept }
router.post('/pm/requests', async (req, res) => {
  const { userId, accept } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'Пользователь не найден' });
  res.json(await pm.answerRequest(req.userId, userId, accept !== false));
});
router.post('/pm/block', async (req, res) => {
  const { userId, on } = req.body || {};
  if (!userId || userId === req.userId) return res.status(400).json({ error: 'Пользователь не найден' });
  await pm.setBlock(req.userId, userId, on !== false); res.json({ ok: true });
});
router.get('/pm/t/:uid', async (req, res) => {
  const u = await existingUser(req.params.uid); if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  const st = await mod.status(req.userId);
  const d0 = await pm.snapshot(); const rq = pm.requestsOf(d0, req.userId); const rel0 = relOf(d0, u.id, req.userId);
  res.json(Object.assign({ user: pubUser(u, { d: d0, viewer: req.userId }), canWrite: !!ROLES[req.userId] || privAllows(u.id, 'write', rel0), canCall: privAllows(u.id, 'call', rel0), pmClosed: st.pmClosed, mutedUntil: st.mutedUntil, requested: rq.outgoing.includes(u.id), requestedMe: rq.incoming.some((r) => r.from === u.id) }, await pm.thread(req.userId, u.id, req.query.read === '1')));
});
router.delete('/pm/t/:uid/m/:id', async (req, res) => {
  if (req.query.mod) {
    try { const me = ROLES[req.userId]; if (me !== 'dev' && me !== 'admin') return res.status(403).json({ error: 'Нет прав' }); await pm.modDelete(req.userId, req.params.uid, req.params.id, !(ROLES[req.params.uid] === 'dev' && me !== 'dev')); return res.json({ ok: true }); }
    catch (e) { return res.status(400).json({ error: e.message }); }
  }
  try { await pm.deleteOwn(req.userId, req.params.uid, req.params.id, dm.DELETE_FOR_ALL_MS); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/pm/t/:uid', pmLimiter, async (req, res) => {
  const u = await existingUser(req.params.uid); if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  const deny = await mod.denyReason(req.userId, 'pm'); if (deny) return res.status(403).json({ error: deny });
  if (!ROLES[req.userId] && !privAllows(u.id, 'write', relOf(await pm.snapshot(), u.id, req.userId))) return res.status(403).json({ error: (PRIV[u.id] || {}).write === 'none' ? 'Пользователь закрыл личные сообщения' : 'Пользователь принимает сообщения только от своих контактов' });
  try { const m = await pm.send(req.userId, u.id, (req.body || {}).text, saveAtts((req.body || {}).attachments, await mod.maxBytes())); res.json({ ok: true, id: m.id }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Личная страница ----
router.get('/profile/:uid', async (req, res) => {
  const uid = req.params.uid === 'me' ? req.userId : req.params.uid;
  const users = await readUsers(); const u = users.users.find((x) => x.id === uid && !x.deletedAt);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  const d = await pm.snapshot(); const p = await profile.get(uid);
  let rel = relOf(d, uid, req.userId);
  if (rel === 'me' && ['contact', 'guest'].includes(req.query.as)) rel = req.query.as; // «Как видят другие»
  const pv = profile.priv(p); const can = (k) => profile.allowed(pv[k], rel);
  const fleet = await profile.fleetFor(uid, p);
  const out = {
    rel, self: uid === req.userId,
    user: { userId: u.id, name: u.companyName || u.fullName || 'Пользователь', sub: u.companyName && u.fullName ? u.fullName : '', role: ROLES[u.id] || '', since: u.createdAt || null, online: can('online') ? isOnline(u.id) : null },
    about: p.about || '', city: p.city || '', cover: p.cover || 'glass', coverAt: p.coverAt || 0, avatarAt: p.avatarAt || 0, wideAt: p.wideAt || 0, parkUrl: p.parkUrl || '',
    stats: { cars: fleet.length, free: fleet.filter((c) => c.s === 'free').length, contacts: (d.contacts[uid] || []).length },
    rating: await require('../lib/ratings').ownerStats(uid), viewer: await roles.me(req.userId),
    fleet: can('fleet') ? fleet : null,
    status: can('status') ? fleet.filter((c) => c.s === 'free') : null,
    phone: can('phone') ? (u.phone || '') : null, whatsapp: can('wa') ? (p.whatsapp || u.phone || '') : null,
    instagram: can('ig') ? (p.instagram || '') : null, telegram: can('tg') ? (p.telegram || '') : null,
    address: can('place') ? (p.address || '') : null, hours: can('place') ? (p.hours || '') : null,
    canWrite: rel === 'me' ? false : (!!ROLES[req.userId] || can('write')), canCall: rel === 'me' ? false : can('call'),
    hidden: profile.KEYS.filter((k) => !can(k)),
  };
  if (uid === req.userId) Object.assign(out, { privacy: pv, search: p.search !== false, raw: { address: p.address || '', hours: p.hours || '', whatsapp: p.whatsapp || '', instagram: p.instagram || '', telegram: p.telegram || '' }, fleetAt: p.fleetAt || null, link: p.link || '', linkOn: p.linkOn !== false });
  else { const rq = pm.requestsOf(d, req.userId); Object.assign(out, { contact: (d.contacts[req.userId] || []).includes(uid), requested: rq.outgoing.includes(uid), blocked: (d.blocks[req.userId] || []).includes(uid) }); }
  res.json(out);
});
router.put('/profile', async (req, res) => {
  try { await profile.save(req.userId, req.body); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/profile/image', async (req, res) => {
  try { const { kind, dataUrl } = req.body || {}; const p = await profile.saveImage(req.userId, kind, dataUrl); res.json({ ok: true, at: p[kind + 'At'] }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/profile/image/:kind', async (req, res) => { await profile.dropImage(req.userId, req.params.kind); res.json({ ok: true }); });
router.post('/profile/link', async (req, res) => {
  const b = req.body || {}; const users = await readUsers(); const u = users.users.find((x) => x.id === req.userId) || {};
  res.json(Object.assign({ ok: true }, await profile.link(req.userId, u.companyName || u.fullName || 'xcar', typeof b.on === 'boolean' ? b.on : undefined, !!b.regen)));
});
// фото машины для «статуса» (только если зрителю разрешено видеть статус или автопарк)
router.get('/profile/:uid/car/:carId', async (req, res) => {
  const uid = req.params.uid; const d = await pm.snapshot(); const rel = relOf(d, uid, req.userId);
  if (!privAllows(uid, 'status', rel) && !privAllows(uid, 'fleet', rel)) return res.status(403).end();
  profile.sendCarPhoto(res, await profile.fleetOf(uid), req.params.carId);
});
router.get('/profile/:uid/img/:kind', (req, res) => {
  const f = profile.imagePath(req.params.uid, req.params.kind); if (!f) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=86400'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.sendFile(f);
});

// ---- Звания и ограничения (разработчик / админ прямо в приложении) ----
router.get('/roles/user/:uid', async (req, res) => {
  const me = await roles.me(req.userId); if (!me.role) return res.status(403).json({ error: 'Нет прав' });
  const u = await existingUser(req.params.uid); if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ role: ROLES[u.id] || '', restr: await roles.restrOf(u.id), me, rating: await require('../lib/ratings').ownerStats(u.id) });
});
router.post('/roles/admin', async (req, res) => {
  const { userId, on } = req.body || {};
  if (!userId || !(await existingUser(userId))) return res.status(400).json({ error: 'Пользователь не найден' });
  try { await roles.setAdmin(req.userId, userId, on !== false); res.json({ ok: true, me: await roles.me(req.userId) }); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/roles/restrict', async (req, res) => {
  const { userId, kind, hours } = req.body || {};
  if (!userId || !(await existingUser(userId))) return res.status(400).json({ error: 'Пользователь не найден' });
  try { const r = await roles.restrict(req.userId, userId, kind, hours); res.json(Object.assign(r, { restr: await roles.restrOf(userId) })); } catch (e) { res.status(400).json({ error: e.message }); }
});
// обнулить оценки пользователя (подозрение на накрутку): разработчик — любого, админ — кроме разработчиков и админов
router.post('/roles/ratings', async (req, res) => {
  const { userId, on } = req.body || {}; const me = ROLES[req.userId];
  if (me !== 'dev' && me !== 'admin') return res.status(403).json({ error: 'Нет прав' });
  if (!userId || !(await existingUser(userId))) return res.status(400).json({ error: 'Пользователь не найден' });
  const t = ROLES[userId]; if (t === 'dev' || (t === 'admin' && me !== 'dev')) return res.status(403).json({ error: t === 'dev' ? 'Оценки разработчика обнулить нельзя' : 'Оценки админа может обнулить только разработчик' });
  res.json({ ok: true, rating: await require('../lib/ratings').setVoid(userId, req.userId, on !== false) });
});

// ---- Звонки (WebRTC): сервер передаёт только offer / answer / ICE ----
const calls = require('../lib/calls');
router.get('/calls/config', (req, res) => {
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  // свой TURN-сервер (для сложных сетей / мобильного интернета): TURN_URL=turn:host:3478, TURN_USER, TURN_PASS в server.env
  if (process.env.TURN_URL) ice.push({ urls: String(process.env.TURN_URL).split(',').map((s) => s.trim()).filter(Boolean), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  res.json({ iceServers: ice });
});
router.post('/calls', async (req, res) => {
  const { to, offer, video } = req.body || {};
  const u = await existingUser(to); if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  const d = await pm.snapshot();
  if ((d.blocks[to] || []).includes(req.userId)) return res.status(403).json({ error: 'Пользователь ограничил вам звонки' });
  if ((d.blocks[req.userId] || []).includes(to)) return res.status(403).json({ error: 'Вы заблокировали этого пользователя' });
  const deny = await mod.denyReason(req.userId, 'pm'); if (deny) return res.status(403).json({ error: deny });
  if (!privAllows(to, 'call', relOf(d, to, req.userId))) return res.status(403).json({ error: (PRIV[to] || {}).call === 'none' ? 'Пользователь отключил звонки' : 'Пользователь принимает звонки только от своих контактов' });
  try { res.json({ ok: true, id: calls.start(req.userId, to, offer, video) }); }
  catch (e) { res.status(e.code === 'busy' ? 409 : 400).json({ error: e.message, busy: e.code === 'busy' }); }
});
router.get('/calls/incoming', async (req, res) => {
  const c0 = calls.incoming(req.userId); if (!c0) return res.json({ call: null });
  const u = await existingUser(c0.from); res.json({ call: Object.assign(c0, { user: u ? pubUser(u) : { name: 'Пользователь XCAR' } }) });
});
router.get('/calls/:id', (req, res) => { const c0 = calls.get(req.params.id, req.userId, req.query.since); if (!c0) return res.status(404).json({ error: 'Звонок не найден' }); res.json(c0); });
router.post('/calls/:id/answer', (req, res) => { try { calls.answer(req.params.id, req.userId, (req.body || {}).answer); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
router.post('/calls/:id/ice', (req, res) => { const b = req.body || {}; (Array.isArray(b.list) ? b.list : [b.cand]).slice(0, 30).forEach((x) => { if (x) calls.ice(req.params.id, req.userId, x); }); res.json({ ok: true }); });
router.post('/calls/:id/end', (req, res) => { calls.end(req.params.id, req.userId, (req.body || {}).reason); res.json({ ok: true }); });

// ---- Личные сообщения с администрацией XCAR (XCAR CONTROL → Сообщения) ----
const dmLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком часто. Подождите немного.' } });
router.get('/dm', async (req, res) => { const st = await mod.status(req.userId); res.json(Object.assign(await dm.getThreadForUser(req.userId, { markRead: req.query.read === '1' }), { supportClosed: st.supportClosed, supportBanned: st.supportBanned, mutedUntil: st.mutedUntil, fileMb: st.fileMb })); });
router.get('/dm/unread', async (req, res) => { res.json(await dm.unreadForUser(req.userId)); });
router.post('/dm', dmLimiter, async (req, res) => {
  const b = req.body || {};
  const deny = await mod.denyReason(req.userId, 'support'); if (deny) return res.status(403).json({ error: deny });
  try { const m = await dm.post(req.userId, { from: 'user', text: b.text, attachments: b.attachments, maxBytes: await mod.maxBytes() }); res.json({ ok: true, id: m.id }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/dm/:id', async (req, res) => {
  try { await dm.deleteOwnByUser(req.userId, req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/attachments/:id', async (req, res) => {
  const a = dm.readAttachment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Файл не найден' });
  const id = req.params.id; const hasIt = (list) => (list || []).some((m) => (m.attachments || []).some((x) => x.id === id));
  let ok = hasIt((await dm.getThreadForUser(req.userId, {})).messages);
  if (!ok) ok = hasIt((await c.readChat()).messages);
  if (!ok) { const d = await pm.snapshot(); ok = Object.keys(d.threads || {}).some((k) => k.split('|').includes(req.userId) && hasIt(d.threads[k].messages)); }
  if (!ok) return res.status(404).json({ error: 'Файл не найден' });
  res.setHeader('Content-Type', a.meta.type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.meta.name)}`);
  res.sendFile(a.file);
});

module.exports = router;
