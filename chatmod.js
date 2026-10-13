// Модерация чатов XCAR (XCAR CONTROL → Сообщения → Модерация):
//   pmClosed       — личные сообщения между пользователями выключены для всех
//   supportClosed  — техподдержка временно не принимает новые сообщения
//   supportBans    — кому запрещено писать в техподдержку
//   mutes          — { uid: { until: iso|'forever', by, at } } — ограничение писать во всех чатах
const { jsonFile } = require('./jsonfile');

// retention: { group, pm, support } — автоудаление через N дней (0 — хранить всегда); fileMb — лимит вложения (0 — без ограничения, до 80 МБ)
const base = () => ({ pmClosed: false, supportClosed: false, supportBans: [], mutes: {}, retention: { group: 0, pm: 0, support: 0 }, fileMb: 10 });
const HARD_MB = 80;
const db = jsonFile('chatmod.json', base);
const norm = (d) => { const b = base(); d = Object.assign(b, d || {}); if (!Array.isArray(d.supportBans)) d.supportBans = []; if (!d.mutes || typeof d.mutes !== 'object') d.mutes = {}; d.retention = Object.assign({ group: 0, pm: 0, support: 0 }, d.retention || {}); if (d.fileMb === undefined || d.fileMb === null || isNaN(Number(d.fileMb))) d.fileMb = 10; return d; };

function activeMute(d, uid) {
  const m = d.mutes[uid]; if (!m) return null;
  if (m.until === 'forever') return 'forever';
  return new Date(m.until).getTime() > Date.now() ? m.until : null;
}
async function get() { return norm(await db.read()); }
async function status(uid) {
  const d = await get();
  return { pmClosed: d.pmClosed, supportClosed: d.supportClosed, supportBanned: d.supportBans.includes(uid), mutedUntil: activeMute(d, uid), fileMb: Number(d.fileMb) || 0 };
}
function muteText(until) {
  if (!until) return '';
  if (until === 'forever') return 'Администратор заблокировал вам отправку сообщений';
  return 'Администратор ограничил вам отправку сообщений до ' + new Date(until).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
}
// проверка перед отправкой: scope = group | pm | support. Возвращает текст ошибки или ''.
async function denyReason(uid, scope) {
  const s = await status(uid);
  if (s.mutedUntil) return muteText(s.mutedUntil);
  if (scope === 'pm' && s.pmClosed) return 'Личные сообщения временно отключены администратором';
  if (scope === 'support' && s.supportBanned) return 'Администратор запретил вам писать в техподдержку';
  if (scope === 'support' && s.supportClosed) return 'Техподдержка временно не принимает сообщения';
  return '';
}
async function setFlags(f) {
  return db.update((d0) => { const d = norm(d0); Object.assign(d0, d);
    if (f.pmClosed !== undefined) d0.pmClosed = !!f.pmClosed;
    if (f.supportClosed !== undefined) d0.supportClosed = !!f.supportClosed;
    if (f.retention && typeof f.retention === 'object') ['group', 'pm', 'support'].forEach((k) => { if (f.retention[k] !== undefined) d0.retention[k] = Math.max(0, Math.min(3650, Math.round(Number(f.retention[k]) || 0))); });
    if (f.fileMb !== undefined) d0.fileMb = Math.max(0, Math.min(HARD_MB, Math.round(Number(f.fileMb) || 0)));
    return { pmClosed: d0.pmClosed, supportClosed: d0.supportClosed, retention: d0.retention, fileMb: d0.fileMb }; });
}
async function setSupportBan(uid, on) {
  return db.update((d0) => { const d = norm(d0); Object.assign(d0, d);
    d0.supportBans = d0.supportBans.filter((x) => x !== uid); if (on) d0.supportBans.push(uid); return d0.supportBans; });
}
// hours: число часов, 0 / null — снять, 'forever' — бессрочно
async function setMute(uid, hours, by) {
  return db.update((d0) => { const d = norm(d0); Object.assign(d0, d);
    if (!hours) { delete d0.mutes[uid]; return null; }
    const until = hours === 'forever' ? 'forever' : new Date(Date.now() + Number(hours) * 3600 * 1000).toISOString();
    d0.mutes[uid] = { until, by: by || null, at: new Date().toISOString() }; return until; });
}
// максимальный размер файла в байтах для saveAttachment (0 в настройке → жёсткий потолок HARD_MB)
async function maxBytes() { const d = await get(); const mb = Number(d.fileMb) || 0; return (mb > 0 ? mb : HARD_MB) * 1048576; }
function mutedMap(d) { const out = {}; Object.keys(d.mutes).forEach((u) => { const a = activeMute(d, u); if (a) out[u] = a; }); return out; }
module.exports = { HARD_MB, maxBytes, get, status, denyReason, setFlags, setSupportBan, setMute, mutedMap, activeMute };
