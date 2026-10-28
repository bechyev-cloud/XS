// Публичная ссылка на личную страницу пользователя XCAR: https://сервер/u/<код>
// Кто открыл ссылку (WhatsApp, Telegram…), тот видит страницу без входа в приложение:
// свободные машины («статус»), автопарк, о прокате и контакты — всё, что владелец не скрыл совсем («Никто»).
const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { readUsers } = require('../lib/store');
const profile = require('../lib/profile');

const lim = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком много запросов. Подождите минуту.' } });
const pub = express.Router(); pub.use(lim);
async function load(tok) {
  const e = await profile.byLink(tok); if (!e) return null;
  const users = await readUsers(); const u = users.users.find((x) => x.id === e.uid && !x.deletedAt && !x.blocked);
  return u ? Object.assign(e, { u }) : null;
}
pub.get('/u/:token', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const e = await load(req.params.token); if (!e) return res.status(404).json({ ok: false, error: 'Ссылка недоступна' });
  const { p, u, uid } = e; const pv = profile.priv(p); const show = (k) => pv[k] !== 'none';
  const fleet = await profile.fleetFor(uid, p); const roles = await require('../lib/roles').map();
  res.json({
    ok: true, name: u.companyName || u.fullName || 'Прокат XCAR', role: roles[uid] || '', about: p.about || '', city: p.city || '',
    cover: p.cover || 'glass', coverAt: p.coverAt || 0, avatarAt: p.avatarAt || 0, since: u.createdAt || null, parkUrl: p.parkUrl || '',
    status: show('status') ? fleet.filter((c) => c.s === 'free') : null,
    fleet: show('fleet') ? fleet : null,
    phone: show('phone') ? (u.phone || '') : null, whatsapp: show('wa') ? (p.whatsapp || u.phone || '') : null,
    instagram: show('ig') ? (p.instagram || '') : null, telegram: show('tg') ? (p.telegram || '') : null,
    address: show('place') ? (p.address || '') : null, hours: show('place') ? (p.hours || '') : null,
  });
});
pub.get('/u/:token/img/:kind', async (req, res) => {
  const e = await profile.byLink(req.params.token); const f = e && profile.imagePath(e.uid, req.params.kind);
  if (!f) return res.status(404).end(); res.setHeader('Cache-Control', 'public, max-age=86400'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.sendFile(f);
});
pub.get('/u/:token/car/:carId', async (req, res) => {
  const e = await profile.byLink(req.params.token); if (!e) return res.status(404).end();
  const pv = profile.priv(e.p); if (pv.status === 'none' && pv.fleet === 'none') return res.status(404).end();
  profile.sendCarPhoto(res, await profile.fleetOf(e.uid), req.params.carId);
});

const html = express.Router();
const PAGE = path.join(__dirname, '..', 'lib', 'userpage.html');
html.get('/u/:token', lim, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(fs.readFileSync(PAGE, 'utf8'));
});
module.exports = { pub, html };
