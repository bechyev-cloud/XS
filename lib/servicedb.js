// «Сервисные контакты» между пользователями XCAR: СТО, мойки, шиномонтаж, эвакуаторы…
// Пользователь включает обмен (Клиенты → База → Делиться базой онлайн → «Сервисные контакты»),
// приложение присылает свои сервисные контакты, взамен видит контакты других участников.
//   data/service-share.json — { owners: { uid: { company, updatedAt, items:[{ id, name, phone, kind, note, addr, rate }] } } }
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'service-share.json');
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
const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const KINDS = ['motor', 'chassis', 'kpp', 'elec', 'diag', 'body', 'tire', 'wash', 'tow', 'parts', 'sto', 'other'];
function clean(x) {
  return { id: s(x.id, 40), name: s(x.name, 120), phone: s(x.phone, 30).replace(/[^\d+()\-\s]/g, ''), kind: KINDS.includes(x.kind) ? x.kind : 'other', note: s(x.note, 600), city: s(x.city, 80), addr: s(x.addr, 160), rate: Math.max(0, Math.min(5, Math.round(+x.rate || 0))) };
}
function setShare(uid, company, items) {
  const d = read();
  const list = (Array.isArray(items) ? items : []).slice(0, 500).map(clean).filter((x) => x.name && x.phone);
  d.owners[uid] = { company: s(company, 120), updatedAt: new Date().toISOString(), items: list };
  write(d); return { ok: true, count: list.length };
}
function removeShare(uid) { const d = read(); if (d.owners[uid]) { delete d.owners[uid]; write(d); } return { ok: true }; }
function status(uid) { const o = read().owners[uid]; return o ? { enabled: true, count: o.items.length, updatedAt: o.updatedAt } : { enabled: false }; }
// контакты других участников (свои не возвращаются); одинаковые номера объединяются
function list(uid) {
  const d = read(); const out = []; const seen = new Map();
  Object.entries(d.owners).forEach(([ou, o]) => {
    if (ou === uid) return;
    (o.items || []).forEach((x) => {
      const key = x.phone.replace(/\D/g, '').slice(-10) + '|' + x.kind;
      const had = seen.get(key);
      if (had) { if (!had.from.includes(o.company)) had.from.push(o.company); return; }
      const it = Object.assign({}, x, { from: [o.company || 'Пользователь XCAR'], ref: Buffer.from(ou.slice(0, 8) + ':' + x.id).toString('base64url') });
      seen.set(key, it); out.push(it);
    });
  });
  out.sort((a, b) => b.from.length - a.from.length || a.name.localeCompare(b.name, 'ru'));
  return out.slice(0, 2000);
}
module.exports = { setShare, removeShare, status, list, KINDS };
