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
  if (!memo.bl) memo.bl = {};
  if (!memo.adm) memo.adm = { hide: {}, edit: {} };
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
    blacklisted: !!c.blacklisted, reason: s(c.reason, 1000), debt: !!c.debt || Number(c.debtAmount) > 0,
    debtAmount: Math.max(0, Math.min(1e9, Math.round(Number(c.debtAmount) || 0))), debtNote: s(c.debtNote, 300),
    rentals: Math.max(0, Math.min(100000, parseInt(c.rentals, 10) || 0)),
    rating: Math.max(0, Math.min(5, Number(c.rating) || 0)), lastAt: s(c.lastAt, 30),
    fines: Math.max(0, Math.min(10000, parseInt(c.fines, 10) || 0)), viol: Math.max(0, Math.min(10000, parseInt(c.viol, 10) || 0)),
    late: Math.max(0, Math.min(10000, parseInt(c.late, 10) || 0)), days: Math.max(0, Math.min(1e6, parseInt(c.days, 10) || 0)),
  };
}
function setShare(uid, company, payload) {
  const d = read();
  const list = (Array.isArray(payload.clients) ? payload.clients : []).slice(0, 20000).map(clean).filter((c) => c.name || c.ph);
  // enabledAt — когда пользователь включил «Делиться базой онлайн» (от него считается задержка доступа к базам других)
  const prev = d.owners[uid]; const enabledAt = prev ? (prev.enabledAt || '') : new Date().toISOString();
  const scope = payload.scope === 'flagged' ? 'flagged' : 'all';
  // allAt — когда включили «Всех моих клиентов»: от него отсчитывается доступ к полной истории других
  const allAt = scope === 'all' ? (prev && prev.scope === 'all' ? (prev.allAt || '') : new Date().toISOString()) : '';
  d.owners[uid] = { enabledAt, allAt, company: s(company, 120), phoneMode: payload.phoneMode === 'hidden' ? 'hidden' : 'partial', scope, updatedAt: new Date().toISOString(), clients: list };
  write(d); return d.owners[uid];
}
// Чёрный список каждого пользователя публикуется всегда (даже без «Делиться базой онлайн»)
// и виден всем пользователям XCAR в «Проверке клиента».
function setBlacklist(uid, company, payload) {
  const d = read();
  const list = (Array.isArray(payload.clients) ? payload.clients : []).slice(0, 20000).map(clean).filter((c) => (c.name || c.ph)).map((c) => Object.assign(c, { blacklisted: true }));
  if (!list.length) delete d.bl[uid];
  else d.bl[uid] = { company: s(company, 120), updatedAt: new Date().toISOString(), clients: list };
  write(d); return { count: list.length };
}
function removeShare(uid) { const d = read(); if (d.owners[uid]) { delete d.owners[uid]; write(d); } }
function status(uid) { const o = read().owners[uid]; return o ? { enabled: true, enabledAt: o.enabledAt || '', allAt: o.allAt || '', count: o.clients.length, updatedAt: o.updatedAt, phoneMode: o.phoneMode, scope: o.scope } : { enabled: false }; }
function stats(exceptUid) {
  const d = read(); let owners = 0, clients = 0, flagged = 0;
  const vis = (uid, list) => list.map((c) => adm(d, uid, c)).filter(Boolean);
  Object.entries(d.owners).forEach(([uid, o]) => { if (uid === exceptUid) return; owners++; const v = vis(uid, o.clients); clients += v.length; flagged += v.filter((c) => c.blacklisted).length; });
  let blOwners = 0;
  Object.entries(d.bl).forEach(([uid, o]) => { if (uid === exceptUid) return; blOwners++; if (!d.owners[uid]) flagged += vis(uid, o.clients).length; });
  return { owners, clients, flagged, blOwners };
}
const norm = (v) => String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
// правки администратора (XCAR CONTROL → Проверка клиента → Общая база): переживают повторную синхронизацию приложений
const akey = (uid, c) => uid + '|' + (c.ph || (norm(c.name) + '|' + String(c.phone || '').replace(/\D/g, '')));
const aid = (k) => Buffer.from(k).toString('base64url');
function adm(d, uid, c) {
  const k = akey(uid, c); if (d.adm.hide[k]) return null;
  const e = d.adm.edit[k]; return e ? Object.assign({}, c, e, { adminEdited: true }) : c;
}
function search(q, hashes, exceptUid, opts) {
  opts = opts || {};
  const d = read(); const nq = norm(q); const toks = nq.split(' ').filter((t) => t.length > 1 && !/^\d+$/.test(t));
  const hs = new Set((hashes || []).filter(hex));
  const out = [];
  const lists = [];
  Object.entries(d.owners).forEach(([uid, o]) => lists.push([uid, o, 's']));
  Object.entries(d.bl).forEach(([uid, o]) => { if (!d.owners[uid]) lists.push([uid, o, 'b']); });
  lists.forEach(([uid, o, kind]) => {
    if (uid === exceptUid) return;
    o.clients.forEach((c0, i) => {
      const c = adm(d, uid, c0); if (!c) return;
      if (opts.blOnly && !c.blacklisted) return;
      if (opts.flagged && !c.blacklisted && !c.debt) return;
      const byHash = hs.size && ((c.ph && hs.has(c.ph)) || (c.dh && hs.has(c.dh)));
      const byName = toks.length && toks.every((t) => norm(c.name).includes(t));
      if (!byHash && !byName) return;
      out.push(Object.assign({ id: uid.slice(0, 8) + ':' + kind + i, oid: uid, company: o.company, updatedAt: o.updatedAt, exact: !!byHash }, c, { ph: undefined, dh: undefined }));
    });
  });
  out.sort((a, b) => (b.exact - a.exact) || (b.blacklisted - a.blacklisted) || (b.debt - a.debt));
  return out.slice(0, 100);
}
// весь список (для просмотра без поиска); blOnly — только чёрные списки
function list(exceptUid, opts) {
  opts = opts || {}; const d = read(); const out = [];
  Object.entries(d.owners).forEach(([uid, o]) => { if (uid === exceptUid) return; o.clients.forEach((c0, i) => { const c = adm(d, uid, c0); if (!c) return; if (opts.blOnly && !c.blacklisted) return; if (opts.flagged && !c.blacklisted && !c.debt) return; out.push(Object.assign({ id: uid.slice(0, 8) + ':s' + i, oid: uid, company: o.company, updatedAt: o.updatedAt }, c, { ph: undefined, dh: undefined })); }); });
  Object.entries(d.bl).forEach(([uid, o]) => { if (uid === exceptUid || d.owners[uid]) return; o.clients.forEach((c0, i) => { const c = adm(d, uid, c0); if (c) out.push(Object.assign({ id: uid.slice(0, 8) + ':b' + i, oid: uid, company: o.company, updatedAt: o.updatedAt }, c, { ph: undefined, dh: undefined })); }); });
  out.sort((a, b) => (b.blacklisted - a.blacklisted) || (b.debt - a.debt) || String(b.lastAt || '').localeCompare(String(a.lastAt || '')));
  return out.slice(0, opts.limit || 2000);
}
// долги клиента перед другими прокатами (точное совпадение по хэшу телефона/паспорта)
function debtOthers(hashes, exceptUid) {
  const d = read(); const hs = new Set((hashes || []).filter(hex)); if (!hs.size) return { amount: 0, count: 0 };
  let amount = 0; const owners = new Set();
  const scan = (uid, o) => o.clients.forEach((c0) => {
    const c = adm(d, uid, c0); if (!c || !c.debt) return;
    if (!((c.ph && hs.has(c.ph)) || (c.dh && hs.has(c.dh)))) return;
    if (owners.has(uid)) return; owners.add(uid); amount += Number(c.debtAmount) || 0;
  });
  Object.entries(d.owners).forEach(([uid, o]) => { if (uid !== exceptUid) scan(uid, o); });
  Object.entries(d.bl).forEach(([uid, o]) => { if (uid !== exceptUid && !owners.has(uid)) scan(uid, o); });
  return { amount: Math.round(amount), count: owners.size };
}
function blStatus(uid) { const o = read().bl[uid]; return o ? { count: o.clients.length, updatedAt: o.updatedAt } : { count: 0 }; }
// ---- администратор ----
function adminList(q, opts) {
  opts = opts || {}; const d = read(); const nq = norm(q); const qd = String(q || '').replace(/\D/g, '');
  const out = []; let total = 0, hidden = 0;
  const add = (uid, o, kind) => o.clients.forEach((c0) => {
    const k = akey(uid, c0); const isHidden = !!d.adm.hide[k]; if (isHidden) hidden++; else total++;
    if (isHidden && !opts.hidden) return; if (!isHidden && opts.hidden) return;
    const c = Object.assign({}, c0, d.adm.edit[k] || {});
    if (opts.blOnly && !c.blacklisted) return;
    if (nq && !(norm(c.name + ' ' + c.reason + ' ' + o.company).includes(nq) || (qd.length >= 4 && String(c.phone || '').replace(/\D/g, '').includes(qd)))) return;
    if (out.length < 3000) out.push({ id: aid(k), ownerId: uid, company: o.company, kind, updatedAt: o.updatedAt, name: c.name, phone: c.phone, doc: c.doc, reason: c.reason, blacklisted: !!c.blacklisted, debt: !!c.debt, rentals: c.rentals, rating: c.rating, lastAt: c.lastAt, edited: !!d.adm.edit[k], hidden: isHidden });
  });
  Object.entries(d.owners).forEach(([uid, o]) => add(uid, o, 'share'));
  Object.entries(d.bl).forEach(([uid, o]) => { if (!d.owners[uid]) add(uid, o, 'bl'); });
  out.sort((a, b) => (b.blacklisted - a.blacklisted) || String(a.name).localeCompare(String(b.name)));
  return { items: out, total, hidden, owners: Object.keys(d.owners).length + Object.keys(d.bl).filter((u) => !d.owners[u]).length };
}
const unid = (id) => { try { return Buffer.from(String(id), 'base64url').toString(); } catch (e) { return ''; } };
function adminEdit(id, patch) {
  const k = unid(id); if (!k.includes('|')) return false; const d = read();
  const e = Object.assign({}, d.adm.edit[k] || {});
  if (patch.name !== undefined) e.name = s(patch.name, 120);
  if (patch.phone !== undefined) e.phone = s(patch.phone, 40);
  if (patch.reason !== undefined) e.reason = s(patch.reason, 1000);
  if (patch.blacklisted !== undefined) e.blacklisted = !!patch.blacklisted;
  d.adm.edit[k] = e; write(d); return true;
}
function adminHide(id, on) { const k = unid(id); if (!k.includes('|')) return false; const d = read(); if (on) d.adm.hide[k] = new Date().toISOString(); else delete d.adm.hide[k]; write(d); return true; }
function adminReset(id) { const k = unid(id); const d = read(); delete d.adm.edit[k]; write(d); return true; }
module.exports = { debtOthers, adminList, adminEdit, adminHide, adminReset, setShare, removeShare, status, stats, search, setBlacklist, blStatus, list };
