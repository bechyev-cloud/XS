// «Статистика проката» в приложении: спрос по всем пользователям XCAR (общая)
// или только по своему аккаунту (моя). Данные — договоры аренды из всех аккаунтов,
// без имён и телефонов (только количество, длительность и суммы).
const agg = require('./control/aggregate');

const d10 = (s) => String(s || '').slice(0, 10);
const addDays = (key, n) => { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isRental = (c) => c && (!c.type || c.type === 'rental') && c.status !== 'cancelled' && c.start;
const durDays = (c) => { const ms = new Date(c.end) - new Date(c.start); return isFinite(ms) && ms > 0 ? ms / 864e5 : 0; };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function buckets(period, today) {
  if (period === 'year') {
    const out = []; const [y, m] = today.split('-').map(Number);
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); const k = d.toISOString().slice(0, 7); out.push({ key: k, from: k + '-01', label: MONTHS[d.getUTCMonth()] }); }
    out.forEach((b, i) => { b.to = i < out.length - 1 ? addDays(out[i + 1].from, -1) : today; });
    return out;
  }
  const n = period === 'month' ? 30 : 7; const out = [];
  for (let i = n - 1; i >= 0; i--) { const k = addDays(today, -i); const d = new Date(k + 'T00:00:00Z'); out.push({ key: k, from: k, to: k, label: period === 'week' ? WD[(d.getUTCDay() + 6) % 7] : String(d.getUTCDate()) }); }
  return out;
}
function summarize(rows, from, to) {
  const r = rows.filter((x) => x.day >= from && x.day <= to);
  const clients = new Set(r.map((x) => x.client));
  const days = r.reduce((s, x) => s + x.days, 0); const sum = r.reduce((s, x) => s + x.total, 0);
  return { rentals: r.length, clients: clients.size, days: Math.round(days * 10) / 10, avgDays: r.length ? Math.round(days / r.length * 10) / 10 : 0, sum: Math.round(sum), avgPerDay: days ? Math.round(sum / days) : 0 };
}
async function compute({ period, scope, userId }) {
  period = ['week', 'month', 'year'].includes(period) ? period : 'month';
  const all = await agg.loadAll(); const today = d10(agg.localNow('Europe/Moscow'));
  const rows = []; const companies = new Set(); let cars = 0;
  for (const a of all.accounts) {
    if (scope === 'mine' && a.user.id !== userId) continue;
    const st = a.store || {}; cars += (st.cars || []).length;
    (st.contracts || []).forEach((c) => {
      if (!isRental(c)) return;
      const car = (st.cars || []).find((x) => x.id === c.carId);
      companies.add(a.user.id);
      rows.push({ day: d10(c.start), days: durDays(c), total: Number(c.total) || 0, client: a.user.id + ':' + c.clientId, six: c.rentalType === '6h', active: c.status === 'active',
        model: car ? `${car.make || ''} ${car.model || ''}`.trim() : '' });
    });
  }
  const bs = buckets(period, today);
  const from = bs[0].from, to = today;
  const span = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
  const prevTo = addDays(from, -1), prevFrom = addDays(from, -span);
  const cur = summarize(rows, from, to), prev = summarize(rows, prevFrom, prevTo);
  const series = bs.map((b) => { const s = summarize(rows, b.from, b.to); return { label: b.label, from: b.from, to: b.to, rentals: s.rentals, clients: s.clients, days: s.days }; });
  const inP = rows.filter((x) => x.day >= from && x.day <= to);
  const wd = WD.map((l) => ({ label: l, rentals: 0 }));
  inP.forEach((x) => { const d = new Date(x.day + 'T00:00:00Z'); if (!isNaN(d)) wd[(d.getUTCDay() + 6) % 7].rentals++; });
  const lens = [['до суток', 0, 1], ['1–2 дня', 1, 2], ['3–6 дней', 2, 6], ['неделя+', 6, 1e9]].map(([label, lo, hi]) => ({ label, rentals: inP.filter((x) => (lo === 0 ? x.days <= hi : x.days > lo && x.days <= hi)).length }));
  const mm = {}; inP.forEach((x) => { if (x.model) mm[x.model] = (mm[x.model] || 0) + 1; });
  const models = Object.entries(mm).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, rentals]) => ({ label, rentals }));
  return { period, scope: scope === 'mine' ? 'mine' : 'all', from, to, cur, prev, series, weekdays: wd, lengths: lens, models,
    six: inP.filter((x) => x.six).length, daily: inP.filter((x) => !x.six).length, activeNow: rows.filter((x) => x.active).length,
    companies: scope === 'mine' ? 1 : all.accounts.length, cars, updatedAt: new Date().toISOString() };
}
module.exports = { compute };
