// Заявки «Забыл пароль»: пользователь на экране входа оставляет свои данные
// (фамилия, имя, телефон, компания, как связаться). Заявка попадает в
// XCAR CONTROL → «Забыл пароль». Администратор связывается с человеком,
// задаёт уточняющие вопросы и сам назначает новый пароль.
const crypto = require('crypto');
const { jsonFile } = require('./jsonfile');

const db = jsonFile('pw-requests.json', () => ({ items: [] }));
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const normPhone = (p) => (p ? String(p).replace(/[^\d+]/g, '') : '');

async function create(body, ip) {
  const b = body || {};
  const r = {
    lastName: clip(b.lastName, 60), firstName: clip(b.firstName, 60), middleName: clip(b.middleName, 60),
    phone: normPhone(b.phone).slice(0, 20), company: clip(b.company, 80), contact: clip(b.contact, 120), note: clip(b.note, 500),
  };
  if (!r.lastName || !r.firstName) throw new Error('Укажите фамилию и имя');
  if (r.phone.replace(/\D/g, '').length < 6) throw new Error('Укажите номер телефона, с которым входите в XCAR');
  return db.update((s) => {
    s.items = Array.isArray(s.items) ? s.items : [];
    // повтор от того же номера, пока заявка ещё не рассмотрена, — обновляем её, а не плодим новые
    const dup = s.items.find((x) => x.status === 'pending' && x.phone === r.phone);
    if (dup) { Object.assign(dup, r, { updatedAt: new Date().toISOString(), repeats: (dup.repeats || 0) + 1 }); return dup; }
    const it = Object.assign({ id: 'pw' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), status: 'pending', createdAt: new Date().toISOString(), ip: clip(ip, 60) }, r);
    s.items.unshift(it);
    s.items = s.items.slice(0, 500);
    return it;
  });
}
async function list() { const s = await db.read(); return Array.isArray(s.items) ? s.items : []; }
async function get(id) { return (await list()).find((x) => x.id === id) || null; }
async function resolve(id, status, by, extra) {
  return db.update((s) => {
    const it = (s.items || []).find((x) => x.id === id);
    if (!it) throw new Error('Заявка не найдена');
    Object.assign(it, extra || {}, { status, resolvedAt: new Date().toISOString(), resolvedBy: by || '' });
    return it;
  });
}
async function pendingCount() { return (await list()).filter((x) => x.status === 'pending').length; }
module.exports = { create, list, get, resolve, pendingCount, normPhone };
