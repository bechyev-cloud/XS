// Сквозное шифрование трафика «приложение ↔ сервер» (поверх HTTPS).
//
// 1) Рукопожатие POST /api/e2e/hello: клиент присылает свой одноразовый
//    публичный ключ ECDH P-256, сервер отвечает своим одноразовым ключом,
//    подписанным долговременным ключом сервера (ECDSA P-256). Клиент проверяет
//    подпись и запоминает отпечаток ключа сервера (TOFU): если ключ подменят —
//    приложение откажется работать в зашифрованном режиме.
// 2) Из общего секрета ECDH через HKDF-SHA256 получается ключ AES-256-GCM
//    сессии (kid). Сессия живёт 24 часа (в памяти сервера).
// 3) Запросы с заголовком X-XCAR-E2E: <kid> присылают тело как
//    { __e2e: { iv, ct } } — сервер расшифровывает его ДО обработчиков, а
//    ответ res.json(...) шифрует тем же ключом. Обработчики ничего не знают
//    о шифровании — они получают и отдают обычный JSON.
//
// Ключ сервера: переменная окружения E2E_SIGN_KEY (PEM, PKCS8) или файл
// data/e2e-sign-key.pem (создаётся автоматически при первом запуске).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_TTL = 24 * 3600 * 1000;
const MAX_SESSIONS = 20000;
const sessions = new Map(); // kid -> { key, exp, n, created, ua, ip }
const stats = { handshakes: 0, encrypted: 0, plain: 0, rejected: 0, startedAt: new Date().toISOString() };

let signKey = null, pubSpki = null, fingerprint = '';
function dataDir() { return process.env.DATA_DIR || path.join(__dirname, '..', 'data'); }
function loadKey() {
  if (signKey) return;
  let pem = process.env.E2E_SIGN_KEY ? String(process.env.E2E_SIGN_KEY).replace(/\\n/g, '\n') : '';
  const file = path.join(dataDir(), 'e2e-sign-key.pem');
  if (!pem) { try { pem = fs.readFileSync(file, 'utf8'); } catch (e) { pem = ''; } }
  if (!pem) {
    const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    pem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
    try { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(file, pem, { mode: 0o600 }); } catch (e) { /* только в памяти */ }
  }
  signKey = crypto.createPrivateKey(pem);
  pubSpki = crypto.createPublicKey(signKey).export({ type: 'spki', format: 'der' });
  fingerprint = crypto.createHash('sha256').update(pubSpki).digest('hex');
}
function fpShort() { loadKey(); return fingerprint.slice(0, 16).toUpperCase().match(/.{4}/g).join('-'); }

function sweep() {
  const now = Date.now();
  for (const [k, s] of sessions) if (s.exp < now) sessions.delete(k);
  if (sessions.size > MAX_SESSIONS) { const extra = sessions.size - MAX_SESSIONS; let i = 0; for (const k of sessions.keys()) { if (i++ >= extra) break; sessions.delete(k); } }
}
setInterval(sweep, 10 * 60 * 1000).unref();

function hello(req, res) {
  loadKey();
  const b = req.body || {};
  let cpub;
  try { cpub = Buffer.from(String(b.pub || ''), 'base64'); if (cpub.length !== 65 || cpub[0] !== 4) throw new Error(); }
  catch (e) { return res.status(400).json({ error: 'Неверный ключ клиента' }); }
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  let secret;
  try { secret = ecdh.computeSecret(cpub); } catch (e) { return res.status(400).json({ error: 'Неверный ключ клиента' }); }
  const kid = crypto.randomBytes(16).toString('hex');
  const spub = ecdh.getPublicKey();
  const key = Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.from('xcar-e2e-v1'), Buffer.from(kid), 32));
  // подпись: клиентский ключ | серверный ключ | kid — нельзя подменить ответ сервера
  const sig = crypto.sign('sha256', Buffer.concat([cpub, spub, Buffer.from(kid)]), { key: signKey, dsaEncoding: 'ieee-p1363' });
  sweep();
  sessions.set(kid, { key, exp: Date.now() + SESSION_TTL, n: 0, created: Date.now(), ua: String(req.headers['user-agent'] || '').slice(0, 160), ip: req.ip, client: String(b.client || 'app').slice(0, 20) });
  stats.handshakes++;
  res.json({ ok: true, kid, pub: spub.toString('base64'), sig: sig.toString('base64'), spki: pubSpki.toString('base64'), fp: fingerprint, alg: 'ECDH-P256 + HKDF-SHA256 + AES-256-GCM', ttl: SESSION_TTL });
}

const zlib = require('zlib');
const ZIP_MIN = 24 * 1024;
// большие ответы (вся база с тысячами договоров) сжимаются gzip ДО шифрования — z:1
function encrypt(key, kid, obj, canZip) {
  const iv = crypto.randomBytes(12);
  let data = Buffer.from(JSON.stringify(obj === undefined ? null : obj), 'utf8'); let z = 0;
  if (canZip && data.length > ZIP_MIN) { data = zlib.gzipSync(data, { level: 6 }); z = 1; }
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(kid));
  const ct = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
  const out = { iv: iv.toString('base64'), ct: ct.toString('base64') }; if (z) out.z = 1; return out;
}
function decrypt(key, kid, env) {
  const iv = Buffer.from(String(env.iv || ''), 'base64'); const all = Buffer.from(String(env.ct || ''), 'base64');
  if (iv.length !== 12 || all.length < 16) throw new Error('bad');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAAD(Buffer.from(kid)); d.setAuthTag(all.subarray(all.length - 16));
  let pt = Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]);
  if (env.z) pt = zlib.gunzipSync(pt, { maxOutputLength: 200 * 1024 * 1024 });
  return JSON.parse(pt.toString('utf8'));
}

// Требовать шифрование от приложений (настройка в XCAR CONTROL → Настройки → Приложение)
let forceCache = { v: false, t: 0 };
async function forced() {
  if (Date.now() - forceCache.t < 15000) return forceCache.v;
  try { forceCache = { v: !!(await require('./control/settings').get()).app.e2eForce, t: Date.now() }; } catch (e) { forceCache = { v: false, t: Date.now() }; }
  return forceCache.v;
}
function resetForceCache() { forceCache.t = 0; }
// Эти адреса работают без шифрования всегда (рукопожатие, проверка связи, файлы)
const OPEN = [/^\/api\/e2e\//, /^\/api\/health/, /^\/api\/app\//, /^\/api\/control\//, /^\/api\/public\//, /^\/api\/park\/photos\/[^/]+\/[^/]+$/];

async function middleware(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const kid = req.headers['x-xcar-e2e'];
  if (!kid) {
    if (!OPEN.some((r) => r.test(req.path)) && await forced()) { stats.rejected++; return res.status(426).json({ error: 'Сервер требует сквозное шифрование. Включите его: Настройки → Общие → Сквозное шифрование (или обновите приложение).', e2eRequired: true }); }
    stats.plain++; return next();
  }
  const s = sessions.get(String(kid));
  if (!s || s.exp < Date.now()) return res.status(409).json({ error: 'Сессия шифрования истекла', e2e: 'rehandshake' });
  if (req.body && req.body.__e2e) {
    try { req.body = decrypt(s.key, kid, req.body.__e2e); } catch (e) { return res.status(400).json({ error: 'Не удалось расшифровать запрос', e2e: 'rehandshake' }); }
  }
  s.n++; stats.encrypted++;
  const orig = res.json.bind(res);
  const canZip = req.headers['x-xcar-zip'] === '1';
  res.json = (obj) => { res.setHeader('X-XCAR-E2E', '1'); res.setHeader('Cache-Control', 'no-store'); return orig({ __e2e: encrypt(s.key, kid, obj, canZip) }); };
  next();
}

function status() {
  sweep(); loadKey();
  const now = Date.now(); let app = 0, panel = 0;
  for (const s of sessions.values()) { if (s.client === 'control') panel++; else app++; }
  return { fingerprint: fpShort(), fingerprintFull: fingerprint, alg: 'ECDH P-256 · HKDF-SHA256 · AES-256-GCM', sessions: sessions.size, appSessions: app, panelSessions: panel, keySource: process.env.E2E_SIGN_KEY ? 'env' : 'file', stats: Object.assign({}, stats), now: new Date(now).toISOString() };
}

module.exports = { hello, middleware, status, resetForceCache, fpShort };
