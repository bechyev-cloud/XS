// Оценки клиентов при завершении аренды: вождение, оплата, ответственность, рекомендация (1–5).
// Хранится только обезличенно: хэш телефона/паспорта (ph/dh — те же, что в общей базе «Проверка клиента»),
// оценки и дата. Имён и номеров на сервере нет.
//   data/ratings.json — { r: { "<uid>|<contractId>": { ph, dh, d, p, s, c, at } }, v: { uid: { by, at } } }
// v — «обнулённые» пользователи: их оценки не учитываются нигде (защита от накрутки аферистами).
// «Общая оценка XCAR» = среднее всех оценок этого клиента от всех прокатов.
const { jsonFile } = require('./control/jsonfile');
const db = jsonFile('ratings.json', () => ({ r: {} }));
const hex = (v) => (/^[0-9a-f]{64}$/.test(String(v || '')) ? String(v) : '');
const sc = (v) => { const n = Math.round(Number(v) || 0); return n >= 1 && n <= 5 ? n : 0; };
const K = ['d', 'p', 's', 'c'];
let memo = null, memoV = {}, memoAt = 0;
async function all() { if (memo && Date.now() - memoAt < 5000) return memo; const d = await db.read(); memo = (d && d.r) || {}; memoV = (d && d.v) || {}; memoAt = Date.now(); return memo; }
async function voids() { await all(); return memoV; }

// пакет оценок от приложения: [{ id, ph, dh, d, p, s, c, at }] (id — номер договора у пользователя)
async function put(uid, items) {
  const list = (Array.isArray(items) ? items : []).slice(0, 500);
  let n = 0;
  await db.update((d) => {
    d.r = d.r || {};
    list.forEach((x) => {
      const id = String((x && x.id) || '').replace(/[^\w-]/g, '').slice(0, 64); if (!id) return;
      const key = uid + '|' + id; const ph = hex(x.ph), dh = hex(x.dh);
      const v = { d: sc(x.d), p: sc(x.p), s: sc(x.s), c: sc(x.c) };
      if (x.del || (!ph && !dh) || !K.some((k) => v[k])) { if (d.r[key]) { delete d.r[key]; n++; } return; }
      d.r[key] = Object.assign({ ph, dh, at: String(x.at || new Date().toISOString()).slice(0, 30) }, v); n++;
    });
    return true;
  });
  memo = null; return n;
}
// сводка по клиенту: по каждому критерию и общая, от всех прокатов XCAR
async function summary(ph, dh, exceptUid) {
  ph = hex(ph); dh = hex(dh); if (!ph && !dh) return { count: 0 };
  const r = await all(); const V = memoV; const sum = { d: [0, 0], p: [0, 0], s: [0, 0], c: [0, 0] }; let count = 0, mine = 0; const owners = new Set();
  Object.entries(r).forEach(([key, x]) => {
    if (!((ph && x.ph === ph) || (dh && x.dh === dh))) return;
    const uid = key.split('|')[0]; if (V[uid]) return;
    count++; owners.add(uid); if (uid === exceptUid) mine++;
    K.forEach((k) => { if (x[k]) { sum[k][0] += x[k]; sum[k][1]++; } });
  });
  const out = { count, owners: owners.size, mine };
  let tot = 0, tn = 0;
  K.forEach((k) => { if (sum[k][1]) { out[k] = Math.round(sum[k][0] / sum[k][1] * 10) / 10; tot += sum[k][0]; tn += sum[k][1]; } });
  out.avg = tn ? Math.round(tot / tn * 10) / 10 : 0;
  return out;
}
// оценка пользователя по его договорам: среднее всех оценок, которые он поставил клиентам за аренды
async function ownerStats(uid) {
  const r = await all(); const v = memoV[uid]; let tot = 0, n = 0, rentals = 0;
  Object.entries(r).forEach(([key, x]) => {
    if (key.split('|')[0] !== uid) return; rentals++;
    K.forEach((k) => { if (x[k]) { tot += x[k]; n++; } });
  });
  if (v) return { avg: 0, count: 0, voided: { by: v.by, at: v.at, count: rentals } };
  return { avg: n ? Math.round(tot / n * 10) / 10 : 0, count: rentals };
}
// обнулить / вернуть оценки пользователя (разработчик и админы)
async function setVoid(uid, by, on) {
  await db.update((d) => { d.v = d.v || {}; if (on) d.v[uid] = { by, at: new Date().toISOString() }; else delete d.v[uid]; return true; });
  memo = null; return ownerStats(uid);
}
module.exports = { put, summary, ownerStats, setVoid, voids };
