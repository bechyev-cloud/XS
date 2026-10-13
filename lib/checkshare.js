// Общая база «Пользователи XCAR» для раздела «Проверка клиента».
// Пользователь сам решает делиться ли своей базой (Проверка клиента → Настройки).
// Приложение присылает уже обезличенные записи: телефон частично скрыт или
// скрыт полностью, полный телефон и паспорт — только в виде хэша (ph/dh),
// по которому работает поиск по точному номеру.
//   data/check-share.json — { owners: { uid: { company, phoneMode, scope, updatedAt, clients:[...] } } }
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'check-share.json');
let memo = null;
function read() {
  if (memo) return memo;
  try { memo = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}') : {}; } catch (e) { memo = {}; }
  if (!memo.owners) memo.owners = {};
  return memo;
}
function write(d) {
  const dir = path.dirname(FILE); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = FILE + '.tmp' + process.pid; fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, FILE); memo = d;
}
const s = (v, n) => String(v == null ? '' : v).slice(0, n);
const hex = (v) => (/^[0-9a-f]{64}$/.test(String(v || '')) ? String(v) : '');
function clean(c) {
  return {
    name: s(c.name, 120), phone: s(c.phone, 40), ph: hex(c.ph), doc: s(c.doc, 40), dh: hex(c.dh),
    blacklisted: !!c.blacklisted, reason: s(c.reason, 1000), debt: !!c.debt,
    rentals: Math.max(0, Math.min(100000, parseInt(c.rentals, 10) || 0)),
    rating: Math.max(0, Math.min(5, Number(c.rating) || 0)), lastAt: s(c.lastAt, 30),
  };
}
function setShare(uid, company, payload) {
  const d = read();
  const list = (Array.isArray(payload.clients) ? payload.clients : []).slice(0, 20000).map(clean).filter((c) => c.name || c.ph);
  d.owners[uid] = { company: s(company, 120), phoneMode: payload.phoneMode === 'hidden' ? 'hidden' : 'partial', scope: payload.scope === 'flagged' ? 'flagged' : 'all', updatedAt: new Date().toISOString(), clients: list };
  write(d); return d.owners[uid];
}
function removeShare(uid) { const d = read(); if (d.owners[uid]) { delete d.owners[uid]; write(d); } }
function status(uid) { const o = read().owners[uid]; return o ? { enabled: true, count: o.clients.length, updatedAt: o.updatedAt, phoneMode: o.phoneMode, scope: o.scope } : { enabled: false }; }
function stats(exceptUid) {
  const d = read(); let owners = 0, clients = 0, flagged = 0;
  Object.entries(d.owners).forEach(([uid, o]) => { if (uid === exceptUid) return; owners++; clients += o.clients.length; flagged += o.clients.filter((c) => c.blacklisted).length; });
  return { owners, clients, flagged };
}
const norm = (v) => String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
function search(q, hashes, exceptUid) {
  const d = read(); const nq = norm(q); const toks = nq.split(' ').filter((t) => t.length > 1 && !/^\d+$/.test(t));
  const hs = new Set((hashes || []).filter(hex));
  const out = [];
  Object.entries(d.owners).forEach(([uid, o]) => {
    if (uid === exceptUid) return;
    o.clients.forEach((c, i) => {
      const byHash = hs.size && ((c.ph && hs.has(c.ph)) || (c.dh && hs.has(c.dh)));
      const byName = toks.length && toks.every((t) => norm(c.name).includes(t));
      if (!byHash && !byName) return;
      out.push(Object.assign({ id: uid.slice(0, 8) + ':' + i, company: o.company, updatedAt: o.updatedAt, exact: !!byHash }, c, { ph: undefined, dh: undefined }));
    });
  });
  out.sort((a, b) => (b.exact - a.exact) || (b.blacklisted - a.blacklisted) || (b.debt - a.debt));
  return out.slice(0, 100);
}
module.exports = { setShare, removeShare, status, stats, search };
