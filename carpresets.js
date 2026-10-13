// Готовые машины от администратора: XCAR CONTROL → «Готовые машины».
// Машина с фото и ценами для всех пользователей или только для выбранных.
// Приложение при запуске забирает новые для себя машины и добавляет их в автопарк
// (один раз — удалённая пользователем машина не возвращается).
const crypto = require('crypto');
const { jsonFile } = require('./jsonfile');
const db = jsonFile('car-presets.json', () => ({ items: [] }));
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const num = (v) => { const x = Number(v); return isFinite(x) && x >= 0 ? Math.round(x) : 0; };
function clean(b, prev) {
  const make = s(b.make, 60), model = s(b.model, 60);
  if (!make && !model) throw new Error('Укажите марку и модель');
  const photo = String(b.photo || '');
  if (photo && !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) throw new Error('Фото должно быть картинкой');
  if (photo.length > 4 * 1024 * 1024) throw new Error('Фото слишком большое');
  return Object.assign({}, prev || {}, {
    make, model, year: num(b.year) || '', plate: s(b.plate, 20), color: s(b.color, 30), category: s(b.category, 30),
    rate: num(b.rate), rate6h: num(b.rate6h), overdueHourRate: num(b.overdueHourRate), deposit: num(b.deposit), mileage: num(b.mileage),
    notes: s(b.notes, 1000), photo,
    target: b.target === 'users' ? 'users' : 'all', userIds: Array.isArray(b.userIds) ? b.userIds.map((x) => s(x, 80)).filter(Boolean).slice(0, 5000) : [],
  });
}
async function list() { return (await db.read()).items || []; }
async function create(b, by) { const it = Object.assign(clean(b), { id: 'cp_' + crypto.randomBytes(6).toString('hex'), createdAt: new Date().toISOString(), by: s(by, 80) }); await db.update((d) => { d.items = d.items || []; d.items.unshift(it); }); return it; }
async function update(id, b) { return db.update((d) => { const i = (d.items || []).findIndex((x) => x.id === id); if (i < 0) throw new Error('Не найдено'); d.items[i] = Object.assign(clean(b, d.items[i]), { updatedAt: new Date().toISOString() }); return d.items[i]; }); }
async function remove(id) { return db.update((d) => { const n = (d.items || []).length; d.items = (d.items || []).filter((x) => x.id !== id); return d.items.length < n; }); }
async function forUser(uid) { return (await list()).filter((x) => x.target === 'all' || (x.userIds || []).includes(uid)); }
module.exports = { list, create, update, remove, forUser };
