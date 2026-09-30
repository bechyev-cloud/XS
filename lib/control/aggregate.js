// Сводные данные по ВСЕМ аккаунтам XCAR: автопарк, аренды, брони, клиенты,
// платежи, KPI, графики, аналитика, глобальный поиск.
// Логика денег — та же, что в приложении (xcarapp/index.html → REVENUE ENGINE):
// доход = только реально полученные деньги (оплаченная часть аренды +
// погашения долгов без displayOnly). Долг в доход не попадает.
const { readUsers, readStore } = require('../store');
const { readConfig } = require('../config');
const { publicSubscription, computeStatus } = require('../subscription');

let cache = null, cacheAt = 0;
const stats = { hits: 0, misses: 0 };
const TTL = 10000;
function invalidate() { cache = null; }

async function loadAll(force) {
  if (!force && cache && Date.now() - cacheAt < TTL) { stats.hits++; return cache; }
  stats.misses++;
  const [usersData, cfg] = await Promise.all([readUsers(), readConfig()]);
  const accounts = [];
  for (const u of usersData.users) {
    const store = await readStore(u.id);
    accounts.push({ user: u, store, sub: publicSubscription(u.subscription, cfg) });
  }
  cache = { accounts, cfg, loadedAt: Date.now() }; cacheAt = Date.now();
  return cache;
}

/* ---------- время (строки приложения — местное время 'YYYY-MM-DDTHH:MM') ---------- */
function localNow(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => (parts.find((p) => p.type === t) || {}).value;
  const h = g('hour') === '24' ? '00' : g('hour');
  return `${g('year')}-${g('month')}-${g('day')}T${h}:${g('minute')}`;
}
const d10 = (s) => String(s || '').slice(0, 10);
const d16 = (s) => String(s || '').slice(0, 16);
function addDays(key, n) { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekStart(key) { const d = new Date(key + 'T00:00:00Z'); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }
function isoLocalKey(iso, tz) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); } catch (e) { return d10(iso); } }

/* ---------- деньги ---------- */
const isRental = (ct) => !ct.type || ct.type === 'rental';
function paidPortion(ct) { return ct.paidAmount != null ? (Number(ct.paidAmount) || 0) : (ct.paid ? (Number(ct.total) || 0) : 0); }
function realPayments(store) { return (store.clientLedger || []).filter((l) => l && l.type === 'payment' && !l.displayOnly); }
function rentalReceived(store, ct) {
  return paidPortion(ct) + realPayments(store).filter((l) => l.rentalId === ct.id).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}
function rentalRemaining(store, ct) { return Math.max(0, (Number(ct.total) || 0) - rentalReceived(store, ct)); }
function clientDebt(store, clientId) {
  const cts = (store.contracts || []).filter((c) => c.clientId === clientId && c.status !== 'cancelled');
  const unpaid = cts.filter(isRental).reduce((s, c) => s + Math.max(0, (Number(c.total) || 0) - paidPortion(c)), 0);
  const led = (store.clientLedger || []).filter((l) => l && l.clientId === clientId);
  const sum = (t) => led.filter((l) => l.type === t).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const pays = led.filter((l) => l.type === 'payment' && !l.displayOnly).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  return Math.max(0, unpaid + sum('fine') + sum('violation') + sum('oldDebt') - pays - sum('discount'));
}
function clientIncome(store, clientId) {
  const r = (store.contracts || []).filter((c) => c.clientId === clientId && c.status !== 'cancelled' && isRental(c)).reduce((s, c) => s + paidPortion(c), 0);
  return r + realPayments(store).filter((l) => l.clientId === clientId).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}
// Все события «деньги получены»: [{key:'YYYY-MM-DD', amount, accountId}]
function incomeEvents(accounts) {
  const out = [];
  for (const a of accounts) {
    const st = a.store;
    (st.contracts || []).forEach((c) => { if (isRental(c) && c.status !== 'cancelled') { const p = paidPortion(c); if (p > 0) out.push({ key: d10(c.start), amount: p, accountId: a.user.id, carId: c.carId }); } });
    realPayments(st).forEach((l) => { if (l.date) out.push({ key: d10(l.date), amount: Number(l.amount) || 0, accountId: a.user.id, carId: null, rentalId: l.rentalId }); });
  }
  return out;
}

/* ---------- статусы ---------- */
const CAR_STATUS = { free: 'Свободен', rented: 'В аренде', booked: 'Забронирован', service: 'Сервис', archive: 'Архив' };
function rentalStatus(ct, now) {
  if (ct.status === 'cancelled') return 'cancelled';
  if (ct.status === 'done') return 'done';
  if (ct.status === 'booked') return d16(ct.start) > now ? 'booked' : 'pending';
  if (ct.status === 'active') return d16(ct.end) < now ? 'overdue' : 'active';
  return ct.status || 'done';
}
const RENTAL_STATUS = { active: 'Активная', pending: 'Ожидает', booked: 'Забронирована', overdue: 'Просрочена', done: 'Завершена', cancelled: 'Отменена' };
function accName(u) { return u.companyName || u.fullName || u.phone || 'Аккаунт'; }

/* ---------- автопарк ---------- */
function buildFleet(all, now) {
  const out = [];
  for (const a of all.accounts) {
    const st = a.store; const clients = st.clients || [];
    for (const car of (st.cars || [])) {
      if (!car || !car.id) continue;
      const cts = (st.contracts || []).filter((c) => c.carId === car.id);
      const active = cts.find((c) => c.status === 'active' && isRental(c));
      const booked = cts.filter((c) => c.status === 'booked').sort((x, y) => d16(x.start) < d16(y.start) ? -1 : 1)[0];
      const renter = active ? clients.find((c) => c.id === active.clientId) : null;
      const status = car.status && CAR_STATUS[car.status] ? car.status : 'free';
      let nextAvailable = null;
      if (status === 'rented' && active) nextAvailable = d16(active.end);
      else if (status === 'booked' && booked) nextAvailable = d16(booked.end);
      else if (status === 'free') nextAvailable = now;
      const income = cts.filter((c) => isRental(c) && c.status !== 'cancelled').reduce((s, c) => s + rentalReceived(st, c), 0);
      out.push({
        uid: a.user.id + '~' + car.id, id: car.id, accountId: a.user.id, account: accName(a.user),
        make: car.make || '', model: car.model || '', trim: car.trim || '', year: car.year || null, plate: car.plate || '',
        vin: car.vin || '', color: car.color || '', rate: Number(car.rate) || 0, rate6h: Number(car.rate6h) || 0,
        weekRate: Number(car.weekRate) || 0, monthRate: Number(car.monthRate) || 0, deposit: Number(car.deposit) || 0,
        mileage: car.currentMileage != null ? car.currentMileage : (car.mileage != null ? car.mileage : null),
        category: car.category || '', description: car.description || car.notes || '', notes: car.notes || '',
        status, statusLabel: CAR_STATUS[status], photo: car.photo || null, photosCount: Array.isArray(car.photos) ? car.photos.length : (car.photo ? 1 : 0),
        renter: renter ? { id: renter.id, name: renter.name, phone: renter.phone } : null,
        activeRental: active ? { id: active.id, start: d16(active.start), end: d16(active.end), total: active.total, overdue: d16(active.end) < now } : null,
        nextAvailable, rentalsCount: cts.filter(isRental).length, income, overdueHourRate: car.overdueHourRate || 0,
      });
    }
  }
  return out;
}

/* ---------- аренды и брони ---------- */
function buildRentals(all, now) {
  const out = [];
  for (const a of all.accounts) {
    const st = a.store;
    for (const ct of (st.contracts || [])) {
      if (!ct || !isRental(ct)) continue;
      const car = (st.cars || []).find((c) => c.id === ct.carId);
      const cl = (st.clients || []).find((c) => c.id === ct.clientId);
      const received = rentalReceived(st, ct); const total = Number(ct.total) || 0;
      out.push({
        uid: a.user.id + '~' + ct.id, id: ct.id, accountId: a.user.id, account: accName(a.user),
        carId: ct.carId, car: car ? `${car.make || ''} ${car.model || ''}`.trim() : 'Удалённая машина', plate: car ? car.plate || '' : '', carPhoto: car ? car.photo || null : null,
        clientId: ct.clientId, client: cl ? cl.name : 'Удалённый клиент', clientPhone: cl ? cl.phone || '' : '',
        start: d16(ct.start), end: d16(ct.end), total, received, remaining: Math.max(0, total - received),
        payment: total <= 0 ? 'paid' : received >= total ? 'paid' : received > 0 ? 'partial' : 'unpaid',
        rawStatus: ct.status, status: rentalStatus(ct, now), statusLabel: RENTAL_STATUS[rentalStatus(ct, now)],
        rentalType: ct.rentalType || '', rate: ct.rate || 0, notes: ct.notes || '',
      });
    }
  }
  return out.sort((x, y) => (x.start < y.start ? 1 : -1));
}

/* ---------- клиенты ---------- */
function buildClients(all, now) {
  const out = [];
  for (const a of all.accounts) {
    const st = a.store;
    for (const c of (st.clients || [])) {
      if (!c || !c.id) continue;
      const cts = (st.contracts || []).filter((x) => x.clientId === c.id && isRental(x));
      const last = cts.map((x) => d16(x.start)).sort().pop() || null;
      out.push({
        uid: a.user.id + '~' + c.id, id: c.id, accountId: a.user.id, account: accName(a.user),
        name: c.name || '', phone: c.phone || '', doc: c.doc || '', licenseNum: c.licenseNum || '', notes: c.notes || '',
        blacklisted: !!c.blacklisted, rentals: cts.length, activeRental: cts.some((x) => x.status === 'active'),
        income: clientIncome(st, c.id), debt: clientDebt(st, c.id), lastRental: last, createdAt: c.createdAt || null,
      });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, 'ru'));
}

/* ---------- платежи ---------- */
const PURPOSE = { rental: 'Аренда', fine: 'Штраф', violation: 'Нарушение', oldDebt: 'Старый долг', auto: 'Авто-распределение' };
function buildPayments(all, requests, cfg) {
  const out = [];
  for (const a of all.accounts) {
    const st = a.store;
    for (const l of (st.clientLedger || [])) {
      if (!l || l.type !== 'payment') continue;
      const cl = (st.clients || []).find((c) => c.id === l.clientId);
      out.push({
        uid: 'p~' + a.user.id + '~' + l.id, id: l.id, kind: 'client', accountId: a.user.id, account: accName(a.user),
        clientId: l.clientId, client: cl ? cl.name : 'Удалённый клиент', amount: Number(l.amount) || 0,
        method: l.method || (l.purpose ? PURPOSE[l.purpose] || l.purpose : 'Оплата'), purpose: l.purpose || 'rental',
        date: d16(l.date), status: 'paid', comment: l.note || '',
      });
    }
  }
  const users = new Map(all.accounts.map((a) => [a.user.id, a.user]));
  for (const r of requests) {
    const u = users.get(r.userId); const plan = (cfg.plans || []).find((p) => p.id === r.planId);
    const months = r.months || 1;
    const disc = (cfg.discounts || {})[months] || 0;
    const amount = plan ? Math.round((plan.price || 0) * months * (1 - disc)) : 0;
    out.push({
      uid: 'r~' + r.id, id: r.id, kind: 'subscription', accountId: r.userId, account: u ? accName(u) : 'Аккаунт удалён',
      client: r.clientName || (u ? u.fullName : ''), amount, method: 'Перевод' + (r.paymentBank ? ' · ' + r.paymentBank : ''),
      purpose: 'subscription', planName: plan ? plan.name : r.planId, months,
      date: (r.createdAt || '').slice(0, 16), status: ({ pending: 'pending', approved: 'paid', rejected: 'cancelled', refunded: 'refund' })[r.status] || r.status,
      comment: `Подписка «${plan ? plan.name : r.planId}» на ${months} мес.` + (r.contactPhone ? ' · тел. ' + r.contactPhone : ''),
    });
  }
  return out.sort((x, y) => (x.date < y.date ? 1 : -1));
}

/* ---------- KPI и графики ---------- */
function seriesFromEvents(events, granularity, todayKey, valueOf) {
  const buckets = []; const idx = new Map();
  if (granularity === 'month') {
    const [y, m] = todayKey.split('-').map(Number);
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); const k = d.toISOString().slice(0, 7); idx.set(k, buckets.length); buckets.push({ key: k, label: d.toLocaleDateString('ru-RU', { month: 'short', timeZone: 'UTC' }).replace('.', ''), value: 0 }); }
    events.forEach((e) => { const i = idx.get(e.key.slice(0, 7)); if (i != null) buckets[i].value += valueOf(e); });
  } else if (granularity === 'week') {
    const ws = weekStart(todayKey);
    for (let i = 11; i >= 0; i--) { const k = addDays(ws, -7 * i); idx.set(k, buckets.length); buckets.push({ key: k, label: k.slice(8, 10) + '.' + k.slice(5, 7), value: 0 }); }
    events.forEach((e) => { const i = idx.get(weekStart(e.key)); if (i != null) buckets[i].value += valueOf(e); });
  } else {
    for (let i = 29; i >= 0; i--) { const k = addDays(todayKey, -i); idx.set(k, buckets.length); buckets.push({ key: k, label: k.slice(8, 10) + '.' + k.slice(5, 7), value: 0 }); }
    events.forEach((e) => { const i = idx.get(e.key); if (i != null) buckets[i].value += valueOf(e); });
  }
  return buckets;
}
function overview(all, tz, granularity) {
  const now = localNow(tz); const today = now.slice(0, 10);
  const fleet = buildFleet(all, now); const rentals = buildRentals(all, now);
  const inc = incomeEvents(all.accounts);
  const sumFrom = (from) => inc.filter((e) => e.key >= from && e.key <= today).reduce((s, e) => s + e.amount, 0);
  const monthStart = today.slice(0, 8) + '01';
  const fleetCounts = { free: 0, rented: 0, booked: 0, service: 0, archive: 0 };
  fleet.forEach((c) => { fleetCounts[c.status] = (fleetCounts[c.status] || 0) + 1; });
  const overduePayments = rentals.filter((r) => r.remaining > 0 && r.status !== 'cancelled' && r.end < now && r.status !== 'booked' && r.status !== 'pending').length;
  const g = ['day', 'week', 'month'].includes(granularity) ? granularity : 'day';
  const users = all.accounts.map((a) => a.user);
  return {
    now, generatedAt: new Date().toISOString(),
    kpi: {
      users: users.length,
      activeUsers: all.accounts.filter((a) => a.sub.status !== 'expired' && !a.user.blocked).length,
      paidUsers: all.accounts.filter((a) => a.sub.status === 'active').length,
      cars: fleet.filter((c) => c.status !== 'archive').length,
      free: fleetCounts.free, rented: fleetCounts.rented, booked: fleetCounts.booked, service: fleetCounts.service, archive: fleetCounts.archive,
      incomeToday: sumFrom(today), incomeWeek: sumFrom(weekStart(today)), incomeMonth: sumFrom(monthStart),
      overduePayments, overdueRentals: rentals.filter((r) => r.status === 'overdue').length,
      activeRentals: rentals.filter((r) => r.status === 'active' || r.status === 'overdue').length,
    },
    charts: {
      granularity: g,
      income: seriesFromEvents(inc, g, today, (e) => e.amount),
      rentals: seriesFromEvents(rentals.filter((r) => r.status !== 'cancelled').map((r) => ({ key: r.start.slice(0, 10) })), g, today, () => 1),
      users: seriesFromEvents(users.map((u) => ({ key: isoLocalKey(u.createdAt, tz) })), g, today, () => 1),
      fleet: fleetCounts,
    },
    recentRentals: rentals.slice(0, 6),
  };
}
function analytics(all, tz) {
  const now = localNow(tz); const today = now.slice(0, 10);
  const fleet = buildFleet(all, now); const rentals = buildRentals(all, now); const inc = incomeEvents(all.accounts);
  const byAccount = all.accounts.map((a) => ({ id: a.user.id, name: accName(a.user),
    income: inc.filter((e) => e.accountId === a.user.id).reduce((s, e) => s + e.amount, 0),
    cars: (a.store.cars || []).length, rentals: rentals.filter((r) => r.accountId === a.user.id).length,
    debt: (a.store.clients || []).reduce((s, c) => s + clientDebt(a.store, c.id), 0), plan: a.sub.planName, status: a.sub.status }))
    .sort((x, y) => y.income - x.income);
  const topCars = fleet.slice().sort((x, y) => y.income - x.income).slice(0, 10).map((c) => ({ uid: c.uid, name: `${c.make} ${c.model}`, plate: c.plate, account: c.account, income: c.income, rentals: c.rentalsCount }));
  const purposes = {};
  all.accounts.forEach((a) => realPayments(a.store).forEach((l) => { const k = PURPOSE[l.purpose] || 'Аренда'; purposes[k] = (purposes[k] || 0) + (Number(l.amount) || 0); }));
  const rentalPaid = all.accounts.reduce((s, a) => s + (a.store.contracts || []).filter((c) => isRental(c) && c.status !== 'cancelled').reduce((x, c) => x + paidPortion(c), 0), 0);
  purposes['Аренда (при выдаче)'] = rentalPaid;
  const totalDebt = byAccount.reduce((s, x) => s + x.debt, 0);
  const days30 = rentals.filter((r) => r.status !== 'cancelled' && r.end.slice(0, 10) >= addDays(today, -30));
  // загрузка = доля «машино-дней» в аренде за последние 30 дней
  let rentedDays = 0;
  days30.forEach((r) => { const s = r.start.slice(0, 10) < addDays(today, -30) ? addDays(today, -30) : r.start.slice(0, 10); const e = r.end.slice(0, 10) > today ? today : r.end.slice(0, 10); const n = Math.max(0, (new Date(e) - new Date(s)) / 86400000) + 1; rentedDays += n; });
  const activeCars = fleet.filter((c) => c.status !== 'archive').length;
  return {
    income: { month: seriesFromEvents(inc, 'month', today, (e) => e.amount), week: seriesFromEvents(inc, 'week', today, (e) => e.amount), day: seriesFromEvents(inc, 'day', today, (e) => e.amount) },
    rentals: seriesFromEvents(rentals.filter((r) => r.status !== 'cancelled').map((r) => ({ key: r.start.slice(0, 10) })), 'month', today, () => 1),
    users: seriesFromEvents(all.accounts.map((a) => ({ key: isoLocalKey(a.user.createdAt, tz) })), 'month', today, () => 1),
    utilization: activeCars ? Math.min(100, Math.round(rentedDays / (activeCars * 30) * 100)) : 0,
    avgCheck: (() => { const r = rentals.filter((x) => x.status !== 'cancelled' && x.total > 0); return r.length ? Math.round(r.reduce((s, x) => s + x.total, 0) / r.length) : 0; })(),
    totalIncome: inc.reduce((s, e) => s + e.amount, 0), totalDebt, byAccount, topCars, purposes,
    subscriptions: { trial: all.accounts.filter((a) => a.sub.status === 'trial').length, active: all.accounts.filter((a) => a.sub.status === 'active').length, expired: all.accounts.filter((a) => a.sub.status === 'expired').length },
  };
}

module.exports = { loadAll, invalidate, stats, localNow, d10, d16, addDays, isoLocalKey, paidPortion, rentalReceived, rentalRemaining, clientDebt, clientIncome,
  incomeEvents, buildFleet, buildRentals, buildClients, buildPayments, overview, analytics, accName, CAR_STATUS, RENTAL_STATUS, PURPOSE, isRental, computeStatus };
