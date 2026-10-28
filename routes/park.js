// «Статус автопарка»: управление ссылкой (приложение) и публичная страница для клиентов.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../lib/auth');
const { readUsers } = require('../lib/store');
const park = require('../lib/parkshare');
const page = require('../lib/parkpage');

// ---- владелец (приложение XCAR) ----
const owner = express.Router();
owner.use(authMiddleware);
owner.get('/share', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(Object.assign({ ok: true }, park.get(req.userId))); });
// логин аккаунта (e-mail или телефон) — из него собирается адрес ссылки по умолчанию
async function loginOf(uid) { try { const u = ((await readUsers()).users || []).find((x) => x.id === uid); return u ? (u.email || u.phone || '') : ''; } catch (e) { return ''; } }
owner.post('/share', async (req, res) => {
  const b = req.body || {};
  res.json(Object.assign({ ok: true }, park.update(req.userId, await loginOf(req.userId), { enabled: b.enabled, hidden: b.hidden, opts: b.opts, car: b.car })));
});
owner.post('/share/regen', async (req, res) => { res.json(Object.assign({ ok: true }, park.regen(req.userId, await loginOf(req.userId)))); });
// дополнительные фото машины для клиентов
owner.post('/photos/:carId', express.json({ limit: '8mb' }), async (req, res) => {
  const r = park.addPhoto(req.userId, await loginOf(req.userId), req.params.carId, (req.body || {}).data);
  res.status(r.ok ? 200 : 400).json(r);
});
owner.delete('/photos/:carId/:id', (req, res) => { res.json(park.delPhoto(req.userId, req.params.carId, req.params.id)); });
owner.post('/photos/:carId/order', (req, res) => { res.json(park.orderPhotos(req.userId, req.params.carId, (req.body || {}).ids)); });
// фото для приложения владельца (без публичной ссылки)
owner.get('/photos/:carId/:id', (req, res) => {
  const f = require('path').join(__dirname, '..', 'data', 'park-photos', String(req.userId).replace(/[^a-zA-Z0-9_-]/g, ''), String(req.params.carId).replace(/[^a-zA-Z0-9_-]/g, ''), String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '') + '.jpg');
  if (!require('fs').existsSync(f)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=86400'); res.type('jpg').sendFile(f);
});
// логотип для клиентов (квадратный и широкий)
owner.post('/logo/:kind', express.json({ limit: '4mb' }), async (req, res) => { const r = park.setLogo(req.userId, await loginOf(req.userId), req.params.kind, (req.body || {}).data); res.status(r.ok ? 200 : 400).json(r); });
owner.delete('/logo/:kind', (req, res) => { res.json(park.delLogo(req.userId, req.params.kind)); });
owner.get('/logo/:kind', (req, res) => { const x = park.logoFileOwner(req.userId, req.params.kind); if (!x) return res.status(404).end(); res.setHeader('Cache-Control', 'private, no-cache'); res.type(x.mime).sendFile(x.f); });
// свой адрес ссылки: проверка «свободен ли» и сохранение
owner.get('/share/check', (req, res) => { res.json(park.checkName(req.userId, req.query.name)); });
owner.post('/share/name', async (req, res) => {
  const r = park.setName(req.userId, await loginOf(req.userId), (req.body || {}).name);
  if (!r.ok) return res.status(409).json(r);
  res.json(r);
});

// ---- публичная часть (без входа) ----
const pubLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком много запросов. Подождите минуту.' } });
const tokOk = (t) => /^[a-z0-9-]{3,48}$/.test(String(t || ''));
const pub = express.Router();
pub.use(pubLimiter);
pub.get('/park/:token', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const e = tokOk(req.params.token) ? await park.publicData(req.params.token) : null;
  if (!e) return res.status(404).json({ ok: false, error: 'Ссылка недоступна' });
  res.json(Object.assign({}, e.data, { now: new Date().toISOString() }));
});
pub.get('/park/:token/photo/:carId', async (req, res) => {
  const e = tokOk(req.params.token) ? await park.publicData(req.params.token) : null;
  const p = e && e.photos.get(String(req.params.carId));
  if (!p) return res.status(404).end();
  if (req.headers['if-none-match'] === '"' + p.h + '"') return res.status(304).end();
  const m = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(p.src); if (!m) return res.status(404).end();
  res.setHeader('Content-Type', m[1] === 'image/jpg' ? 'image/jpeg' : m[1]);
  res.setHeader('ETag', '"' + p.h + '"');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(Buffer.from(m[2], 'base64'));
});

pub.get('/park/:token/logo/:kind', (req, res) => {
  const x = tokOk(req.params.token) ? park.logoFile(req.params.token, req.params.kind) : null; if (!x) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); res.type(x.mime).sendFile(x.f);
});
pub.get('/park/:token/g/:carId/:id', (req, res) => {
  const f = tokOk(req.params.token) ? park.photoFile(req.params.token, req.params.carId, req.params.id) : null;
  if (!f) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); res.type('jpg').sendFile(f);
});

// ---- HTML-страница для клиента ----
const html = express.Router();
html.get('/park/:token', pubLimiter, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // страницу можно показать внутри приложения владельца («Так увидят клиенты»)
  res.removeHeader('X-Frame-Options'); res.setHeader('Content-Security-Policy', 'frame-ancestors *');
  res.type('html').send(page.render(tokOk(req.params.token) ? req.params.token : ''));
});

module.exports = { owner, pub, html };
