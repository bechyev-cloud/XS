// «Проверка клиента» в приложении: поиск по общей базе пользователей XCAR
// и по базе, загруженной администратором (TXT/HTML, в т.ч. экспорт Telegram).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../lib/auth');
const { readUsers } = require('../lib/store');
const share = require('../lib/checkshare');
const blacklist = require('../lib/control/blacklist');
const tgAccess = require('../lib/control/tgaccess');

const router = express.Router();
router.use(authMiddleware);
// Доступ к разделу «Пользователи XCAR»: только если пользователь сам делится базой, прошло
// N часов после включения (XCAR CONTROL → Настройки → Application) и подписка активна.
//   state: open | off (не делится) | wait (ждёт, availableAt) | sub (подписка истекла)
async function xcarAccess(uid) {
  let app = {}; try { app = (await require('../lib/control/settings').get()).app || {}; } catch (e) {}
  const delayH = Number.isFinite(Number(app.xcarDelayHours)) ? Number(app.xcarDelayHours) : 24;
  const st = share.status(uid);
  const base = { delayHours: delayH, now: new Date().toISOString() };
  if (app.xcarNeedSub !== false) {
    try {
      const u = await require('../lib/store').getUserLite(uid); const cfg = await require('../lib/config').readConfig();
      const sub = require('../lib/subscription').publicSubscription(u && u.subscription, cfg);
      if (sub.status === 'expired') return Object.assign(base, { state: 'sub' });
    } catch (e) {}
  }
  if (!st.enabled) return Object.assign(base, { state: 'off' });
  const t = st.enabledAt ? Date.parse(st.enabledAt) : 0; // старые участники (без даты) — уже открыто
  const at = t ? t + delayH * 3600000 : 0;
  if (at > Date.now()) return Object.assign(base, { state: 'wait', availableAt: new Date(at).toISOString(), enabledAt: st.enabledAt });
  return Object.assign(base, { state: 'open' });
}
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком много запросов. Подождите минуту.' } });

router.get('/stats', async (req, res) => {
  const bi = await blacklist.info();
  res.json({ xcar: share.stats(req.userId), telegram: { files: bi.files.length, total: bi.total, updatedAt: bi.updatedAt }, share: share.status(req.userId), tgAccess: await tgAccess.get(req.userId), xcarAccess: await xcarAccess(req.userId) });
});
router.get('/search', limiter, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  const hashes = String(req.query.h || '').split(',').filter(Boolean).slice(0, 4);
  const src = String(req.query.src || 'all');
  if (q.length < 2 && !hashes.length) return res.json({ xcar: [], telegram: [] });
  const out = { xcar: [], telegram: [] };
  // базы других пользователей доступны только тем, кто сам делится базой онлайн
  const acc = await xcarAccess(req.userId); out.xcarAccess = acc;
  out.xcarLocked = acc.state !== 'open';
  // чёрные списки других прокатов видны всем; полные базы — только тем, кто сам делится
  if (src === 'all' || src === 'xcar') out.xcar = share.search(q, hashes, req.userId, { blOnly: out.xcarLocked });
  out.tgLocked = !(await tgAccess.approved(req.userId));
  if (!out.tgLocked && (src === 'all' || src === 'telegram') && q.length >= 2) {
    const bi = await blacklist.info(); const names = {}; bi.files.forEach((f) => { names[f.id] = f.name; });
    out.telegram = (await blacklist.search(q, [])).slice(0, 100).map((e) => ({ id: e.id, title: e.title, text: e.text, date: e.date, file: names[String(e.id).split(':')[0]] || 'База', addedAt: e.addedAt }));
    out.tgUpdatedAt = bi.updatedAt;
  }
  res.json(out);
});
// просмотр источника целиком (без поиска): xcar — клиенты других прокатов, telegram — чёрный список
router.get('/browse', limiter, async (req, res) => {
  const src = String(req.query.src || 'xcar');
  const acc = await xcarAccess(req.userId); const locked = acc.state !== 'open';
  if (src === 'telegram') {
    if (!(await tgAccess.approved(req.userId))) return res.json({ telegram: [], tgLocked: true, tgAccess: await tgAccess.get(req.userId) });
    const bi = await blacklist.info(); const names = {}; bi.files.forEach((f) => { names[f.id] = f.name; });
    const seen = new Set(); const out = [];
    for (const e of await blacklist.allEntries()) {
      const key = (e.title + '\n' + e.text).toLowerCase().replace(/\s+/g, ' ').trim(); if (seen.has(key)) continue; seen.add(key);
      out.push({ id: e.id, title: e.title, text: e.text, date: e.date, file: names[String(e.id).split(':')[0]] || 'База', addedAt: e.addedAt });
      if (out.length >= 3000) break;
    }
    return res.json({ telegram: out, tgUpdatedAt: bi.updatedAt });
  }
  res.json({ xcar: locked ? [] : share.list(req.userId, {}), xcarLocked: locked, xcarAccess: acc });
});
// заявка на доступ к базе Telegram
router.get('/tg-access', async (req, res) => { res.json(await tgAccess.get(req.userId)); });
router.post('/tg-access', express.json({ limit: '30mb' }), async (req, res) => {
  try { const r = await tgAccess.submit(req.userId, req.body || {}); res.json(r); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/share', (req, res) => { res.json(share.status(req.userId)); });
router.put('/share', express.json({ limit: '15mb' }), async (req, res) => {
  const users = await readUsers(); const u = users.users.find((x) => x.id === req.userId) || {};
  const o = share.setShare(req.userId, (req.body || {}).company || u.companyName || u.fullName || 'Компания', req.body || {});
  res.json({ ok: true, count: o.clients.length, updatedAt: o.updatedAt });
});
router.put('/blacklist', express.json({ limit: '15mb' }), async (req, res) => {
  const users = await readUsers(); const u = users.users.find((x) => x.id === req.userId) || {};
  const r = share.setBlacklist(req.userId, (req.body || {}).company || u.companyName || u.fullName || 'Компания', req.body || {});
  res.json({ ok: true, count: r.count });
});
router.delete('/share', (req, res) => { share.removeShare(req.userId); res.json({ ok: true }); });
module.exports = router;
