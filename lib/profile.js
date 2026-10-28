// Личная страница пользователя XCAR (открывается по иконке XCAR слева вверху).
//   data/profiles.json — { profiles: { uid: {...} } }
//   data/profile-img/<uid>-avatar.jpg|png, <uid>-cover.jpg|png — фото и обложка (только JPEG/PNG)
// Кто что видит: privacy[k] = 'all' | 'contacts' | 'none'
//   phone — телефон и WhatsApp, write — кто может писать, call — кто может звонить,
//   online — статус «в сети», fleet — автопарк и цены, place — адрес и график.
const fs = require('fs');
const path = require('path');
const { jsonFile, dataPath, ensureDir } = require('./control/jsonfile');

const db = jsonFile('profiles.json', () => ({ profiles: {} }));
const IMG_DIR = dataPath('profile-img');
const LEVELS = ['all', 'contacts', 'none'];
const KEYS = ['status', 'phone', 'wa', 'ig', 'tg', 'write', 'call', 'online', 'fleet', 'place'];
const DEF_PRIV = { status: 'all', phone: 'contacts', wa: 'contacts', ig: 'all', tg: 'all', write: 'all', call: 'contacts', online: 'all', fleet: 'all', place: 'all' };
const COVERS = ['glass', 'sunset', 'ocean', 'mint', 'night', 'gold'];
const STATUSES = ['free', 'rented', 'booked', 'service'];

let memo = null, memoAt = 0;
async function all() { if (memo && Date.now() - memoAt < 3000) return memo; const d = await db.read(); memo = (d && d.profiles) || {}; memoAt = Date.now(); return memo; }
async function get(uid) { return (await all())[uid] || {}; }
function priv(p) { const out = Object.assign({}, DEF_PRIV); const src = (p && p.privacy) || {}; KEYS.forEach((k) => { if (LEVELS.includes(src[k])) out[k] = src[k]; }); if (!LEVELS.includes(src.wa) && LEVELS.includes(src.phone)) out.wa = src.phone; return out; }
async function privOf(uid) { return priv(await get(uid)); }
async function privMap() { const a = await all(); const out = {}; Object.keys(a).forEach((u) => { out[u] = priv(a[u]); }); return out; }
// можно ли viewer'у (rel: 'me' | 'contact' | 'guest') видеть/делать k
function allowed(level, rel) { return rel === 'me' || level === 'all' || (level === 'contacts' && rel === 'contact'); }

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
function cleanFleet(list) {
  return (Array.isArray(list) ? list : []).slice(0, 80).map((c) => ({
    m: str(c && c.m, 60), y: parseInt(c && c.y, 10) || null, p: Math.max(0, Math.min(10000000, Math.round(Number(c && c.p) || 0))),
    s: STATUSES.includes(c && c.s) ? c.s : 'free',
  })).filter((c) => c.m);
}
async function save(uid, body) {
  const b = body || {};
  return db.update((d) => {
    d.profiles = d.profiles || {}; const p = d.profiles[uid] || (d.profiles[uid] = {});
    if ('about' in b) p.about = str(b.about, 300);
    if ('city' in b) p.city = str(b.city, 60);
    if ('address' in b) p.address = str(b.address, 140);
    if ('hours' in b) p.hours = str(b.hours, 60);
    if ('whatsapp' in b) p.whatsapp = str(b.whatsapp, 24).replace(/[^\d+]/g, '');
    // Instagram и Telegram — только имя пользователя (без ссылок): буквы, цифры, точка, подчёркивание
    if ('instagram' in b) p.instagram = str(b.instagram, 120).replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '').replace(/[^\w.]/g, '').slice(0, 30);
    if ('telegram' in b) p.telegram = str(b.telegram, 120).replace(/^https?:\/\/(t|telegram)\.me\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '').replace(/[^\w]/g, '').slice(0, 32);
    if ('parkUrl' in b) { const u = str(b.parkUrl, 200); p.parkUrl = /^https?:\/\//i.test(u) ? u : ''; }
    if ('cover' in b && (COVERS.includes(b.cover) || (b.cover === 'img' && p.coverAt))) p.cover = b.cover;
    if (b.privacy && typeof b.privacy === 'object') { const cur = priv(p); KEYS.forEach((k) => { if (LEVELS.includes(b.privacy[k])) cur[k] = b.privacy[k]; }); p.privacy = cur; }
    if ('search' in b) p.search = b.search !== false;
    if ('fleet' in b) { p.fleet = cleanFleet(b.fleet); p.fleetAt = new Date().toISOString(); }
    p.updatedAt = new Date().toISOString(); memo = null;
    return p;
  });
}
// фото / обложка: data:image/jpeg|png;base64,… до 600 КБ
async function saveImage(uid, kind, dataUrl) {
  if (!['avatar', 'cover', 'wide'].includes(kind)) throw new Error('Неизвестный тип');
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Нужна картинка JPEG или PNG');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 600 * 1024) throw new Error('Картинка слишком большая');
  const ok = m[1] === 'png' ? buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) : (buf[0] === 0xff && buf[1] === 0xd8);
  if (!ok) throw new Error('Файл не похож на картинку');
  ensureDir(IMG_DIR);
  ['jpg', 'png'].forEach((e) => { try { fs.unlinkSync(path.join(IMG_DIR, `${uid}-${kind}.${e}`)); } catch (x) {} });
  fs.writeFileSync(path.join(IMG_DIR, `${uid}-${kind}.${m[1] === 'png' ? 'png' : 'jpg'}`), buf);
  return db.update((d) => { d.profiles = d.profiles || {}; const p = d.profiles[uid] || (d.profiles[uid] = {}); p[kind + 'At'] = Date.now(); if (kind === 'cover') p.cover = 'img'; memo = null; return p; });
}
async function dropImage(uid, kind) {
  ['jpg', 'png'].forEach((e) => { try { fs.unlinkSync(path.join(IMG_DIR, `${uid}-${kind}.${e}`)); } catch (x) {} });
  return db.update((d) => { const p = (d.profiles || {})[uid]; if (p) { delete p[kind + 'At']; if (kind === 'cover' && p.cover === 'img') p.cover = 'glass'; } memo = null; return true; });
}
function imagePath(uid, kind) {
  if (!/^[\w-]{6,64}$/.test(String(uid)) || !['avatar', 'cover', 'wide'].includes(kind)) return null;
  for (const e of ['jpg', 'png']) { const f = path.join(IMG_DIR, `${uid}-${kind}.${e}`); if (fs.existsSync(f)) return f; }
  return null;
}
// ---- автопарк прямо из базы аккаунта (как «Статус автопарка»): реальный статус по договорам и фото ----
const crypto = require('crypto');
const fcache = new Map(); // uid -> { m, list, photos }
async function fleetOf(uid) {
  const { readStore, storeMtime } = require('./store');
  const m = storeMtime(uid); const c = fcache.get(uid); if (c && c.m === m) return c;
  let st = {}; try { st = await readStore(uid) || {}; } catch (e) { st = {}; }
  const contracts = Array.isArray(st.contracts) ? st.contracts : []; const rental = (ct) => !ct.type || ct.type === 'rental';
  const photos = new Map();
  const list = (Array.isArray(st.cars) ? st.cars : []).filter((car) => car && car.id).map((car) => {
    const active = contracts.find((ct) => ct.carId === car.id && ct.status === 'active' && rental(ct));
    const booked = contracts.filter((ct) => ct.carId === car.id && ct.status === 'booked' && rental(ct)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    let s = STATUSES.includes(car.status) ? car.status : 'free'; if (active) s = 'rented';
    const o = { id: String(car.id).slice(0, 64), m: [car.make, car.model].filter(Boolean).join(' ').slice(0, 60), y: parseInt(car.year, 10) || null, p: Math.round(Number(car.rate) || 0), p6: Math.round(Number(car.rate6h) || 0), s };
    if (s === 'free' && booked && booked.start) o.bf = booked.start;
    if (s === 'rented' && active && active.end) o.until = active.end;
    if (typeof car.photo === 'string' && /^data:image\/(jpeg|jpg|png|webp);base64,/.test(car.photo)) { const h = crypto.createHash('sha1').update(car.photo).digest('hex').slice(0, 12); photos.set(o.id, { h, src: car.photo }); o.ph = h; }
    return o;
  }).filter((x) => x.m);
  const order = { free: 0, booked: 1, rented: 2, service: 3 };
  list.sort((a, b) => (order[a.s] - order[b.s]) || a.m.localeCompare(b.m, 'ru'));
  const e = { m, list, photos }; fcache.set(uid, e); if (fcache.size > 300) fcache.delete(fcache.keys().next().value); return e;
}
// автопарк страницы: из базы аккаунта, если там есть машины, иначе — снимок из приложения
async function fleetFor(uid, p) { const f = await fleetOf(uid); return f.list.length ? f.list : ((p && p.fleet) || []).map((c, i) => Object.assign({ id: 'x' + i }, c)); }
function sendCarPhoto(res, entry, carId) {
  const ph = entry && entry.photos.get(String(carId)); if (!ph) return res.status(404).end();
  const mm = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(ph.src); if (!mm) return res.status(404).end();
  res.setHeader('Content-Type', mm[1] === 'image/jpg' ? 'image/jpeg' : mm[1]); res.setHeader('Cache-Control', 'private, max-age=86400'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(Buffer.from(mm[2], 'base64'));
}
// ---- публичная ссылка на страницу: /u/<token> — видна всем, у кого есть ссылка ----
function slug(s) { const TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  return String(s || '').toLowerCase().split('').map((ch) => (TR[ch] !== undefined ? TR[ch] : ch)).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'xcar'; }
async function link(uid, name, on, regen) {
  return db.update((d) => {
    d.profiles = d.profiles || {}; d.links = d.links || {}; const p = d.profiles[uid] || (d.profiles[uid] = {});
    if (regen && p.link) { delete d.links[p.link]; p.link = ''; }
    if (!p.link) { let tok; do { tok = slug(name) + '-' + crypto.randomBytes(3).toString('hex'); } while (d.links[tok]); p.link = tok; d.links[tok] = uid; if (p.linkOn === undefined) p.linkOn = true; }
    if (typeof on === 'boolean') p.linkOn = on;
    memo = null; return { link: p.link, linkOn: p.linkOn !== false };
  });
}
async function byLink(tok) { if (!/^[a-z0-9-]{3,40}$/.test(String(tok || ''))) return null; const d = await db.read(); const uid = ((d && d.links) || {})[tok]; const p = uid && d.profiles[uid]; if (!p || p.linkOn === false || p.link !== tok) return null; return { uid, p }; }
module.exports = { fleetOf, fleetFor, sendCarPhoto, link, byLink, KEYS, LEVELS, COVERS, DEF_PRIV, get, all, priv, privOf, privMap, allowed, save, saveImage, dropImage, imagePath };
