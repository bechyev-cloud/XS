// Роли администраторов XCAR CONTROL (RBAC), учётные записи, сессии и 2FA (TOTP).
// Владелец (Owner) входит по паролю ADMIN_PASSWORD из переменных окружения —
// как и в старой панели /admin. Остальных администраторов создаёт владелец.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { jsonFile } = require('./jsonfile');
const { verifyToken, hashPassword, comparePassword } = require('../auth');

const PERMISSIONS = {
  'dashboard.view': 'Dashboard',
  'users.view': 'Пользователи — просмотр', 'users.edit': 'Пользователи — изменение', 'users.delete': 'Пользователи — удаление',
  'subscriptions.edit': 'Подписки и тарифы',
  'fleet.view': 'Автопарк — просмотр', 'fleet.edit': 'Автопарк — изменение',
  'rentals.view': 'Аренды и брони — просмотр', 'rentals.edit': 'Аренды и брони — изменение',
  'clients.view': 'Клиенты — просмотр', 'clients.edit': 'Клиенты — изменение',
  'payments.view': 'Платежи — просмотр', 'payments.edit': 'Платежи — подтверждение',
  'analytics.view': 'Аналитика',
  'messages.view': 'Сообщения — просмотр', 'messages.send': 'Сообщения — отправка', 'broadcast.send': 'Массовые рассылки',
  'blacklist.view': 'Чёрный список — поиск', 'blacklist.edit': 'Чёрный список — загрузка базы',
  'notifications.view': 'Уведомления',
  'servers.view': 'Серверы — просмотр', 'servers.edit': 'Серверы — настройка',
  'backup.view': 'Резервные копии — просмотр', 'backup.create': 'Резервные копии — создание', 'backup.restore': 'Резервные копии — восстановление',
  'settings.edit': 'Настройки системы', 'audit.view': 'Журнал действий', 'admins.manage': 'Администраторы и роли',
};
const ALL = Object.keys(PERMISSIONS);
const VIEW = ALL.filter((p) => p.endsWith('.view'));
const ROLES = {
  owner:   { label: 'Owner',   desc: 'Полный доступ', perms: ALL },
  admin:   { label: 'Admin',   desc: 'Почти полный доступ (без управления администраторами и восстановления из копий)',
             perms: ALL.filter((p) => !['admins.manage', 'backup.restore'].includes(p)) },
  manager: { label: 'Manager', desc: 'Пользователи, аренды, автомобили, клиенты',
             perms: ['dashboard.view', 'users.view', 'users.edit', 'fleet.view', 'fleet.edit', 'rentals.view', 'rentals.edit',
                     'clients.view', 'clients.edit', 'analytics.view', 'blacklist.view', 'blacklist.edit', 'notifications.view', 'messages.view'] },
  finance: { label: 'Finance', desc: 'Платежи, подписки и финансовая аналитика',
             perms: ['dashboard.view', 'users.view', 'payments.view', 'payments.edit', 'subscriptions.edit', 'analytics.view', 'notifications.view', 'rentals.view'] },
  support: { label: 'Support', desc: 'Пользователи и чаты',
             perms: ['dashboard.view', 'users.view', 'clients.view', 'messages.view', 'messages.send', 'blacklist.view', 'notifications.view'] },
  viewer:  { label: 'Viewer',  desc: 'Только просмотр',
             perms: VIEW.filter((p) => !['backup.view', 'audit.view'].includes(p)) },
};

const adminsDb = jsonFile('control-admins.json', () => ({ admins: [] }));
const sessionsDb = jsonFile('control-sessions.json', () => ({ sessions: [] }));

function publicAdmin(a) {
  return { id: a.id, login: a.login, name: a.name, role: a.role, roleLabel: (ROLES[a.role] || {}).label,
    totpEnabled: !!a.totpEnabled, disabled: !!a.disabled, createdAt: a.createdAt, lastLoginAt: a.lastLoginAt || null };
}
async function ownerRecord() {
  return adminsDb.update((d) => {
    let o = d.admins.find((a) => a.id === 'owner');
    if (!o) { o = { id: 'owner', login: 'owner', name: 'Владелец', role: 'owner', createdAt: new Date().toISOString() }; d.admins.unshift(o); }
    return Object.assign({}, o);
  });
}
async function listAdmins() { await ownerRecord(); const d = await adminsDb.read(); return d.admins.map(publicAdmin); }
async function getAdmin(id) { const d = await adminsDb.read(); return d.admins.find((a) => a.id === id) || null; }

/* ---------- TOTP (RFC 6238) без внешних библиотек ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32decode(s) { const clean = String(s).replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, val = 0; const out = []; for (const c of clean) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totpAt(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0); buf.writeUInt32BE(counter % 0x100000000, 4);
  const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000;
  return String(code).padStart(6, '0');
}
function verifyTotp(secret, code) {
  const c = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return false;
  const t = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((w) => totpAt(secret, t + w) === c);
}
function newTotpSecret() { return b32encode(crypto.randomBytes(20)); }

/* ---------- вход и сессии ---------- */
const SESSION_TTL_MS = 12 * 3600 * 1000;
async function login({ login, password, code, ip, ua }) {
  const lg = String(login || 'owner').trim().toLowerCase() || 'owner';
  await ownerRecord();
  const d = await adminsDb.read();
  const rec = d.admins.find((a) => (a.login || '').toLowerCase() === lg);
  if (!rec || rec.disabled) return { error: 'Неверный логин или пароль', status: 401 };
  let ok = false;
  if (rec.id === 'owner') {
    const configured = process.env.ADMIN_PASSWORD;
    if (!configured || !configured.trim()) return { error: 'Пароль владельца не настроен на сервере (переменная ADMIN_PASSWORD)', status: 500 };
    ok = password === configured;
  } else if (rec.passwordHash) ok = await comparePassword(String(password || ''), rec.passwordHash);
  if (!ok) return { error: 'Неверный логин или пароль', status: 401 };
  if (rec.totpEnabled) {
    if (!code) return { need2fa: true, status: 401, error: 'Введите код из приложения-аутентификатора' };
    if (!verifyTotp(rec.totpSecret, code)) return { need2fa: true, status: 401, error: 'Неверный код 2FA' };
  }
  const sid = crypto.randomUUID();
  const now = new Date().toISOString();
  await sessionsDb.update((s) => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    s.sessions = s.sessions.filter((x) => !x.revoked && new Date(x.lastSeenAt).getTime() > cutoff);
    s.sessions.push({ id: sid, adminId: rec.id, createdAt: now, lastSeenAt: now, ip: ip || '', ua: String(ua || '').slice(0, 200) });
  });
  await adminsDb.update((x) => { const a = x.admins.find((y) => y.id === rec.id); if (a) a.lastLoginAt = now; });
  const token = jwt.sign({ ctl: 1, aid: rec.id, role: rec.role, sid }, require('../auth').JWT_SECRET_FOR_CONTROL(), { expiresIn: '12h' });
  return { token, admin: publicAdmin(rec) };
}
const seenThrottle = new Map();
async function authenticate(token) {
  let p; try { p = verifyToken(token); } catch (e) { return null; }
  if (!p || !p.ctl || !p.sid) return null;
  const s = await sessionsDb.read();
  const sess = s.sessions.find((x) => x.id === p.sid);
  if (!sess || sess.revoked) return null;
  const rec = await getAdmin(p.aid);
  if (!rec || rec.disabled) return null;
  if (Date.now() - (seenThrottle.get(p.sid) || 0) > 60000) {
    seenThrottle.set(p.sid, Date.now());
    sessionsDb.update((x) => { const y = x.sessions.find((z) => z.id === p.sid); if (y) y.lastSeenAt = new Date().toISOString(); }).catch(() => {});
  }
  const role = ROLES[rec.role] ? rec.role : 'viewer';
  return { id: rec.id, login: rec.login, name: rec.name || rec.login, role, perms: ROLES[role].perms, sid: p.sid };
}
async function listSessions(adminId) {
  const s = await sessionsDb.read();
  const cutoff = Date.now() - SESSION_TTL_MS;
  return s.sessions.filter((x) => !x.revoked && (!adminId || x.adminId === adminId) && new Date(x.lastSeenAt).getTime() > cutoff);
}
async function revokeSession(id, adminId) {
  return sessionsDb.update((s) => { const x = s.sessions.find((y) => y.id === id && (!adminId || y.adminId === adminId)); if (!x) return false; x.revoked = true; return true; });
}
async function revokeAllForAdmin(adminId, exceptSid) {
  return sessionsDb.update((s) => { s.sessions.forEach((x) => { if (x.adminId === adminId && x.id !== exceptSid) x.revoked = true; }); });
}

/* ---------- управление администраторами (только Owner) ---------- */
async function createAdmin({ login, name, role, password }) {
  const lg = String(login || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(lg)) throw new Error('Логин: 3–32 символа, латиница, цифры, точка, дефис');
  if (!ROLES[role] || role === 'owner') throw new Error('Недопустимая роль');
  if (String(password || '').length < 8) throw new Error('Пароль не короче 8 символов');
  const passwordHash = await hashPassword(String(password));
  return adminsDb.update((d) => {
    if (d.admins.some((a) => (a.login || '').toLowerCase() === lg)) throw new Error('Такой логин уже есть');
    const a = { id: crypto.randomUUID(), login: lg, name: String(name || lg).trim().slice(0, 60), role, passwordHash, createdAt: new Date().toISOString() };
    d.admins.push(a); return publicAdmin(a);
  });
}
async function updateAdmin(id, patch) {
  if (id === 'owner' && (patch.role || patch.disabled)) throw new Error('Роль владельца менять нельзя');
  let passwordHash = null;
  if (patch.password) { if (String(patch.password).length < 8) throw new Error('Пароль не короче 8 символов'); passwordHash = await hashPassword(String(patch.password)); }
  return adminsDb.update((d) => {
    const a = d.admins.find((x) => x.id === id); if (!a) throw new Error('Администратор не найден');
    if (patch.name != null) a.name = String(patch.name).trim().slice(0, 60) || a.name;
    if (patch.role != null) { if (!ROLES[patch.role] || patch.role === 'owner') throw new Error('Недопустимая роль'); a.role = patch.role; }
    if (patch.disabled != null) a.disabled = !!patch.disabled;
    if (passwordHash && id !== 'owner') a.passwordHash = passwordHash;
    return publicAdmin(a);
  });
}
async function deleteAdmin(id) {
  if (id === 'owner') throw new Error('Владельца удалить нельзя');
  return adminsDb.update((d) => { const n = d.admins.length; d.admins = d.admins.filter((a) => a.id !== id); return n !== d.admins.length; });
}
async function startTotp(adminId) {
  const secret = newTotpSecret();
  await adminsDb.update((d) => { const a = d.admins.find((x) => x.id === adminId); if (a) a.totpPending = secret; });
  const rec = await getAdmin(adminId);
  const label = encodeURIComponent('XCAR CONTROL:' + (rec ? rec.login : 'admin'));
  return { secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=XCAR%20CONTROL&digits=6&period=30` };
}
async function enableTotp(adminId, code) {
  const rec = await getAdmin(adminId);
  if (!rec || !rec.totpPending) throw new Error('Сначала начните настройку 2FA');
  if (!verifyTotp(rec.totpPending, code)) throw new Error('Неверный код — проверьте время на телефоне');
  await adminsDb.update((d) => { const a = d.admins.find((x) => x.id === adminId); a.totpSecret = a.totpPending; a.totpEnabled = true; delete a.totpPending; });
}
async function disableTotp(adminId, code, force) {
  const rec = await getAdmin(adminId);
  if (!rec || !rec.totpEnabled) return;
  if (!force && !verifyTotp(rec.totpSecret, code)) throw new Error('Неверный код 2FA');
  await adminsDb.update((d) => { const a = d.admins.find((x) => x.id === adminId); a.totpEnabled = false; delete a.totpSecret; });
}

module.exports = { PERMISSIONS, ROLES, login, authenticate, listAdmins, getAdmin, createAdmin, updateAdmin, deleteAdmin,
  listSessions, revokeSession, revokeAllForAdmin, startTotp, enableTotp, disableTotp, verifyTotp, totpAt, publicAdmin };
