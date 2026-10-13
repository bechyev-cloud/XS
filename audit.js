// Журнал действий администраторов (Audit Log): кто, когда, что сделал, с каким
// объектом, результат и IP. Хранится в data/control-audit.json (до 20 000 записей).
const crypto = require('crypto');
const { jsonFile } = require('./jsonfile');

const db = jsonFile('control-audit.json', () => ({ entries: [] }));
const MAX = 20000;

function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.ip || (req.socket && req.socket.remoteAddress) || '').replace('::ffff:', '');
}
async function log(req, action, object, result, details) {
  const a = (req && req.admin) || (req && req.adminInfo) || {};
  const e = {
    id: crypto.randomUUID(), at: new Date().toISOString(),
    admin: a.name || a.login || 'system', adminId: a.id || null, role: a.role || null,
    action: String(action || ''), object: object || null, result: result || 'ok',
    details: details == null ? null : String(details).slice(0, 500), ip: req ? clientIp(req) : '',
  };
  await db.update((d) => { d.entries.push(e); if (d.entries.length > MAX) d.entries = d.entries.slice(-MAX); });
  return e;
}
async function list({ q, adminId, objectId, limit = 300, offset = 0 } = {}) {
  const d = await db.read();
  let list = d.entries.slice().reverse();
  if (adminId) list = list.filter((e) => e.adminId === adminId);
  if (objectId) list = list.filter((e) => e.object && (e.object.id === objectId || e.object.userId === objectId));
  if (q) { const s = String(q).toLowerCase(); list = list.filter((e) => JSON.stringify(e).toLowerCase().includes(s)); }
  return { total: list.length, entries: list.slice(offset, offset + limit) };
}
module.exports = { log, list, clientIp };
