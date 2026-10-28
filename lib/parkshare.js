// «Статус автопарка» — публичная ссылка для клиентов.
// Владелец включает ссылку в приложении (Машины → Статус), выбирает какие машины
// показывать. Клиент открывает https://сервер/park/<код> и видит, какие машины
// свободны, в аренде, забронированы или в ремонте. Данные берутся прямо из
// базы аккаунта на сервере (cars / contracts), поэтому страница всегда актуальна.
//   data/park-share.json — { owners: { uid: { token, enabled, hidden:[carId], opts, createdAt, updatedAt } }, tokens: { token: uid } }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readStore, storeMtime } = require('./store');

const FILE = path.join(__dirname, '..', 'data', 'park-share.json');
let memo = null;
function read() {
  if (memo) return memo;
  try { memo = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}') : {}; } catch (e) { memo = {}; }
  if (!memo.owners) memo.owners = {};
  if (!memo.tokens) memo.tokens = {};
  return memo;
}
function write(d) {
  const dir = path.dirname(FILE); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = FILE + '.tmp' + process.pid; fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, FILE); memo = d;
}

const TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
function slugify(name) {
  const s = String(name || '').toLowerCase().split('').map((ch) => (TR[ch] !== undefined ? TR[ch] : ch)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  return s || 'xcar';
}
const ALPH = 'abcdefghjkmnpqrstuvwxyz23456789'; // без похожих символов (l/1, o/0)
function code(n) { const b = crypto.randomBytes(n); let o = ''; for (let i = 0; i < n; i++) o += ALPH[b[i] % ALPH.length]; return o; }
// Адрес по умолчанию — как логин аккаунта (часть e-mail до @ или номер телефона) + цифры: /park/idris-4821
function digits(n) { const b = crypto.randomBytes(n); let o = ''; for (let i = 0; i < n; i++) o += String(b[i] % 10); return o; }
function loginBase(login) {
  const s = String(login || '');
  if (s.indexOf('@') > 0) return slugify(s.split('@')[0]);
  const d = s.replace(/\D/g, ''); return d ? d.slice(-11) : 'xcar';
}
function newToken(d, login) {
  const base = loginBase(login);
  for (let i = 0; i < 30; i++) { const t = base + '-' + digits(i < 15 ? 4 : 6); if (!d.tokens[t]) return t; }
  return base + '-' + code(10);
}
// Свой адрес: латиница, цифры и дефис, 3–32 символа (русские буквы переводятся в латиницу)
const RESERVED = new Set(['admin', 'api', 'control', 'download', 'park', 'xcar', 'login', 'test', 'support', 'help', 'www', 'app']);
function cleanName(v) {
  const s = slugify(v).slice(0, 32).replace(/-+$/, '');
  if (s.length < 3) return { error: 'Адрес слишком короткий — минимум 3 символа' };
  if (RESERVED.has(s)) return { error: 'Этот адрес зарезервирован, выберите другой' };
  return { name: s };
}
function checkName(uid, v) {
  const c = cleanName(v); if (c.error) return { ok: false, error: c.error };
  const owner = read().tokens[c.name];
  if (owner && owner !== uid) return { ok: false, name: c.name, error: 'Адрес занят — попробуйте другой' };
  return { ok: true, name: c.name, mine: owner === uid };
}
function setName(uid, login, v) {
  const r = checkName(uid, v); if (!r.ok) return r;
  const d = read(); let o = d.owners[uid];
  if (!o) { update(uid, login, {}); o = read().owners[uid]; }
  if (o.token !== r.name) { delete d.tokens[o.token]; o.token = r.name; d.tokens[r.name] = uid; o.custom = true; o.updatedAt = new Date().toISOString(); write(d); cache.delete(uid); }
  return Object.assign({ ok: true }, pub(uid, o));
}
const DEF_OPTS = { price: true, plate: false, until: true, phone: '', terms: '', about: '', address: '', map: '' };
function cleanOpts(o, prev) {
  o = o || {}; const p = Object.assign({}, DEF_OPTS, prev || {});
  if (o.price !== undefined) p.price = !!o.price;
  if (o.plate !== undefined) p.plate = !!o.plate;
  if (o.until !== undefined) p.until = !!o.until;
  if (o.phone !== undefined) p.phone = String(o.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
  // условия аренды и местоположение — по желанию владельца, клиенты видят их по кнопкам на странице
  if (o.terms !== undefined) p.terms = String(o.terms || '').replace(/\r/g, '').slice(0, 5000);
  if (o.about !== undefined) p.about = String(o.about || '').replace(/\r/g, '').slice(0, 3000);
  if (o.address !== undefined) p.address = String(o.address || '').slice(0, 300);
  // вид карточек владельца (только названия стилей и цвета — без разметки)
  if (o.look !== undefined) {
    const L = o.look || {}; const id = (v, d) => (/^[a-z0-9]{1,8}$/.test(String(v || '')) ? String(v) : d);
    const col = (v) => (/^#[0-9a-fA-F]{3,8}$/.test(String(v || '').trim()) ? String(v).trim() : '');
    p.look = { mob: id(L.mob, 'cm4'), tile: id(L.tile, 's7'), view: id(L.view, 'default'), chip: id(L.chip, 'cur'), mode: L.mode === 'light' ? 'light' : 'dark', accent: col(L.accent), accentDim: col(L.accentDim), wt: L.wt ? 1 : 0, lg: L.lg ? 1 : 0 };
  }
  if (o.map !== undefined) { const m = String(o.map || '').trim().slice(0, 600); p.map = /^https?:\/\//i.test(m) ? m : ''; }
  return p;
}
function pub(uid, o, base) {
  if (!o) return { enabled: false, token: '', hidden: [], opts: Object.assign({}, DEF_OPTS) };
  return { enabled: !!o.enabled, token: o.token, custom: !!o.custom, gallery: o.gallery || {}, cars: o.cars || {}, logo: o.logo || {}, path: '/park/' + o.token, hidden: o.hidden || [], opts: Object.assign({}, DEF_OPTS, o.opts || {}), createdAt: o.createdAt, updatedAt: o.updatedAt };
}
function get(uid) { return pub(uid, read().owners[uid]); }
// enabled / hidden / opts — любые из полей; при первом включении создаётся ссылка
function update(uid, login, body) {
  const d = read(); let o = d.owners[uid];
  if (!o) { o = { token: newToken(d, login), enabled: false, hidden: [], opts: Object.assign({}, DEF_OPTS), createdAt: new Date().toISOString() }; d.tokens[o.token] = uid; d.owners[uid] = o; }
  if (body.enabled !== undefined) o.enabled = !!body.enabled;
  if (Array.isArray(body.hidden)) o.hidden = body.hidden.map((x) => String(x).slice(0, 64)).slice(0, 2000);
  if (body.opts) o.opts = cleanOpts(body.opts, o.opts);
  // настройки машины для клиентов: h6 — показывать аренду на 6 часов, p6 — своя цена за 6 часов
  if (body.car && body.car.id) {
    const id = String(body.car.id).slice(0, 64); o.cars = o.cars || {}; const c = Object.assign({}, o.cars[id] || {});
    if (body.car.h6 !== undefined) c.h6 = !!body.car.h6;
    if (body.car.p6 !== undefined) { const n = Math.round(Number(body.car.p6) || 0); if (n > 0) c.p6 = Math.min(n, 1e7); else delete c.p6; }
    o.cars[id] = c;
  }
  o.updatedAt = new Date().toISOString();
  write(d); cache.delete(uid); return pub(uid, o);
}
// Новая ссылка: старая сразу перестаёт работать
function regen(uid, login) {
  const d = read(); const o = d.owners[uid];
  if (!o) return update(uid, login, { enabled: true });
  delete d.tokens[o.token];
  o.token = newToken(d, login); o.custom = false; d.tokens[o.token] = uid; o.updatedAt = new Date().toISOString();
  write(d); cache.delete(uid); return pub(uid, o);
}
function remove(uid) { const d = read(); const o = d.owners[uid]; if (!o) return; delete d.tokens[o.token]; delete d.owners[uid]; write(d); cache.delete(uid); }

// ---- публичные данные (кэш по времени изменения базы аккаунта) ----
const cache = new Map(); // uid -> { mtime, upd, data, photos }
const photoHash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
async function build(uid, o) {
  const m = storeMtime(uid); const c = cache.get(uid);
  if (c && c.mtime === m && c.upd === o.updatedAt) return c;
  const st = await readStore(uid);
  const hidden = new Set(o.hidden || []); const opts = Object.assign({}, DEF_OPTS, o.opts || {});
  const contracts = Array.isArray(st.contracts) ? st.contracts : [];
  const photos = new Map();
  const cars = (Array.isArray(st.cars) ? st.cars : []).filter((car) => car && car.id && !hidden.has(car.id)).map((car) => {
    const rental = (ct) => !ct.type || ct.type === 'rental';
    const active = contracts.find((ct) => ct.carId === car.id && ct.status === 'active' && rental(ct));
    const booked = contracts.filter((ct) => ct.carId === car.id && ct.status === 'booked' && rental(ct)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    let status = ['free', 'rented', 'booked', 'service'].includes(car.status) ? car.status : 'free';
    if (active) status = 'rented';
    const out = { id: car.id, make: String(car.make || '').slice(0, 60), model: String(car.model || '').slice(0, 80), year: car.year ? String(car.year).slice(0, 6) : '', status };
    const co = (o.cars && o.cars[car.id]) || {};
    if (opts.price) {
      out.rate = Number(car.rate) || 0;
      const r6 = Number(co.p6) || Number(car.rate6h) || 0;
      if (co.h6 !== false && r6 > 0) out.rate6h = r6;
    }
    if (opts.plate && car.plate) out.plate = String(car.plate).slice(0, 20);
    if (opts.until) {
      if (status === 'rented' && active && active.end) { out.until = active.end; if (active.start) out.since = active.start; if (active.rentalType === '6h') out.h6 = 1; }
      if (status === 'booked' && booked && booked.start) out.from = booked.start;
      if (status === 'free' && booked && booked.start) out.bookedFrom = booked.start;
    }
    const g = (o.gallery && o.gallery[car.id]) || []; if (g.length) out.gallery = g.slice(0, 12);
    if (typeof car.photo === 'string' && /^data:image\/(jpeg|jpg|png|webp);base64,/.test(car.photo)) {
      const h = photoHash(car.photo); photos.set(car.id, { h, src: car.photo }); out.photo = h;
    }
    return out;
  });
  const order = { free: 0, booked: 1, rented: 2, service: 3 };
  cars.sort((a, b) => (order[a.status] - order[b.status]) || (a.make + a.model).localeCompare(b.make + b.model, 'ru'));
  const company = String((st.settings && st.settings.companyName) || 'Автопрокат').slice(0, 80);
  const phone = opts.phone || '';
  const data = { ok: true, company, phone, terms: opts.terms || '', about: opts.about || '', address: opts.address || '', map: opts.map || '', look: opts.look || null, logo: { sq: (o.logo && o.logo.sq && o.logo.sq.h) || '', wide: (o.logo && o.logo.wide && o.logo.wide.h) || '' }, updatedAt: new Date().toISOString(), cars };
  const entry = { mtime: m, upd: o.updatedAt, data, photos };
  cache.set(uid, entry); if (cache.size > 500) cache.delete(cache.keys().next().value);
  return entry;
}
// null — ссылка не существует / выключена
async function publicData(token) {
  const d = read(); const uid = d.tokens[String(token || '')]; if (!uid) return null;
  const o = d.owners[uid]; if (!o || !o.enabled) return null;
  try { const u = await require('./store').getUserLite(uid); if (!u || u.blocked) return null; } catch (e) { return null; }
  return build(uid, o);
}

// ---- дополнительные фото машин для клиентов (галерея) ----
//   data/park-photos/<uid>/<carId>/<id>.jpg ; порядок — owners[uid].gallery[carId] = [id, ...]
const PH_DIR = path.join(__dirname, '..', 'data', 'park-photos');
const MAX_PH = 12, MAX_BYTES = 4 * 1024 * 1024;
const safe = (v) => String(v || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
function phPath(uid, carId, id) { return path.join(PH_DIR, safe(uid), safe(carId), safe(id) + '.jpg'); }
function gallery(uid, carId) { const o = read().owners[uid]; return (o && o.gallery && o.gallery[carId]) || []; }
function ensureOwner(uid, login) { const d = read(); if (!d.owners[uid]) update(uid, login, {}); return read(); }
function addPhoto(uid, login, carId, dataUrl) {
  carId = safe(carId); if (!carId) return { ok: false, error: 'Нет машины' };
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) return { ok: false, error: 'Нужна картинка JPG, PNG или WEBP' };
  const buf = Buffer.from(m[2], 'base64'); if (!buf.length || buf.length > MAX_BYTES) return { ok: false, error: 'Фото слишком большое (до 4 МБ)' };
  const d = ensureOwner(uid, login); const o = d.owners[uid]; o.gallery = o.gallery || {};
  const list = o.gallery[carId] || []; if (list.length >= MAX_PH) return { ok: false, error: 'Можно добавить до ' + MAX_PH + ' фото' };
  const id = crypto.randomBytes(8).toString('hex'); const f = phPath(uid, carId, id);
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  o.gallery[carId] = list.concat(id); o.updatedAt = new Date().toISOString(); write(d); cache.delete(uid);
  return { ok: true, id, gallery: o.gallery[carId] };
}
function delPhoto(uid, carId, id) {
  carId = safe(carId); id = safe(id); const d = read(); const o = d.owners[uid]; if (!o || !o.gallery || !o.gallery[carId]) return { ok: true, gallery: [] };
  o.gallery[carId] = o.gallery[carId].filter((x) => x !== id); try { fs.unlinkSync(phPath(uid, carId, id)); } catch (e) {}
  o.updatedAt = new Date().toISOString(); write(d); cache.delete(uid); return { ok: true, gallery: o.gallery[carId] };
}
function orderPhotos(uid, carId, ids) {
  carId = safe(carId); const d = read(); const o = d.owners[uid]; if (!o || !o.gallery || !o.gallery[carId]) return { ok: true, gallery: [] };
  const cur = o.gallery[carId]; const next = (Array.isArray(ids) ? ids : []).map(safe).filter((x) => cur.includes(x));
  cur.forEach((x) => { if (!next.includes(x)) next.push(x); });
  o.gallery[carId] = next; o.updatedAt = new Date().toISOString(); write(d); cache.delete(uid); return { ok: true, gallery: next };
}
function photoFile(token, carId, id) {
  const d = read(); const uid = d.tokens[String(token || '')]; if (!uid) return null; const o = d.owners[uid]; if (!o || !o.enabled) return null;
  if (!(gallery(uid, safe(carId)).includes(safe(id)))) return null;
  const f = phPath(uid, carId, id); return fs.existsSync(f) ? f : null;
}

// ---- логотип для клиентов: квадратный (sq) и широкий (wide) ----
//   data/park-photos/<uid>/_logo/<kind>.img ; o.logo[kind] = { h, mime }
const LOGO_KINDS = ['sq', 'wide'];
function logoPath(uid, kind) { return path.join(PH_DIR, safe(uid), '_logo', kind + '.img'); }
function setLogo(uid, login, kind, dataUrl) {
  if (!LOGO_KINDS.includes(kind)) return { ok: false, error: 'Неверный вид логотипа' };
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) return { ok: false, error: 'Нужна картинка PNG, JPG или WEBP' };
  const buf = Buffer.from(m[2], 'base64'); if (!buf.length || buf.length > 2 * 1024 * 1024) return { ok: false, error: 'Логотип слишком большой (до 2 МБ)' };
  const d = ensureOwner(uid, login); const o = d.owners[uid]; o.logo = o.logo || {};
  const f = logoPath(uid, kind); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  o.logo[kind] = { h: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12), mime: 'image/' + (m[1] === 'jpg' ? 'jpeg' : m[1]) };
  o.updatedAt = new Date().toISOString(); write(d); cache.delete(uid); return { ok: true, logo: o.logo };
}
function delLogo(uid, kind) {
  const d = read(); const o = d.owners[uid]; if (!o || !o.logo || !o.logo[kind]) return { ok: true, logo: (o && o.logo) || {} };
  delete o.logo[kind]; try { fs.unlinkSync(logoPath(uid, kind)); } catch (e) {}
  o.updatedAt = new Date().toISOString(); write(d); cache.delete(uid); return { ok: true, logo: o.logo };
}
function logoFileOwner(uid, kind) { const o = read().owners[uid]; if (!o || !o.logo || !o.logo[kind]) return null; const f = logoPath(uid, kind); return fs.existsSync(f) ? { f, mime: o.logo[kind].mime } : null; }
function logoFile(token, kind) {
  const d = read(); const uid = d.tokens[String(token || '')]; if (!uid) return null; const o = d.owners[uid]; if (!o || !o.enabled) return null;
  return LOGO_KINDS.includes(kind) ? logoFileOwner(uid, kind) : null;
}
module.exports = { get, update, regen, remove, publicData, slugify, checkName, setName, addPhoto, delPhoto, orderPhotos, photoFile, gallery, setLogo, delLogo, logoFile, logoFileOwner };
