// Звонки между пользователями XCAR (как в WhatsApp): аудио/видео напрямую между устройствами (WebRTC),
// сервер только передаёт «рукопожатие» — offer/answer и ICE-кандидаты. Всё в памяти: звонок живёт минуты.
//   state: ringing → active → ended
const crypto = require('crypto');
const calls = new Map();
const RING_MS = 45000, MAX_MS = 4 * 3600000;
function sweep() {
  const now = Date.now();
  for (const [id, c] of calls) {
    if (c.state === 'ringing' && now - c.at > RING_MS) { c.state = 'ended'; c.reason = c.reason || 'missed'; c.endedAt = now; }
    if (c.state === 'active' && now - c.at > MAX_MS) { c.state = 'ended'; c.reason = 'limit'; c.endedAt = now; }
    if (c.state === 'ended' && now - (c.endedAt || c.at) > 120000) calls.delete(id);
  }
}
setInterval(sweep, 10000).unref();
function busy(uid) { sweep(); for (const c of calls.values()) if (c.state !== 'ended' && (c.from === uid || c.to === uid)) return c; return null; }
function start(from, to, offer, video) {
  if (from === to) throw new Error('Нельзя позвонить себе');
  const b = busy(to); if (b) { const err = new Error('Абонент сейчас разговаривает'); err.code = 'busy'; throw err; }
  const mine = busy(from); if (mine) { mine.state = 'ended'; mine.reason = 'replaced'; mine.endedAt = Date.now(); }
  const id = crypto.randomUUID();
  calls.set(id, { id, from, to, video: !!video, offer: String(offer || '').slice(0, 200000), answer: null, ice: { [from]: [], [to]: [] }, state: 'ringing', at: Date.now(), startedAt: null, reason: '' });
  return id;
}
function view(c, uid) {
  return { id: c.id, from: c.from, to: c.to, video: c.video, state: c.state, reason: c.reason, at: c.at, startedAt: c.startedAt, incoming: c.to === uid,
    offer: c.to === uid ? c.offer : undefined, answer: c.from === uid ? c.answer : undefined };
}
function get(id, uid, since) {
  sweep(); const c = calls.get(id); if (!c || (c.from !== uid && c.to !== uid)) return null;
  const other = c.from === uid ? c.to : c.from; const list = c.ice[other] || [];
  const n = Math.max(0, parseInt(since, 10) || 0);
  return Object.assign(view(c, uid), { ice: list.slice(n), iceN: list.length });
}
function incoming(uid) { sweep(); for (const c of calls.values()) if (c.to === uid && c.state === 'ringing') return view(c, uid); return null; }
function answer(id, uid, sdp) {
  const c = calls.get(id); if (!c || c.to !== uid) throw new Error('Звонок не найден');
  if (c.state !== 'ringing') throw new Error('Звонок уже завершён');
  c.answer = String(sdp || '').slice(0, 200000); c.state = 'active'; c.startedAt = Date.now(); return true;
}
function ice(id, uid, cand) {
  const c = calls.get(id); if (!c || (c.from !== uid && c.to !== uid) || c.state === 'ended') return false;
  const l = c.ice[uid]; if (l.length < 200) l.push(String(cand || '').slice(0, 3000)); return true;
}
function end(id, uid, reason) {
  const c = calls.get(id); if (!c || (c.from !== uid && c.to !== uid)) return false;
  if (c.state !== 'ended') { c.state = 'ended'; c.endedAt = Date.now(); c.reason = String(reason || (c.startedAt ? 'hangup' : (c.to === uid ? 'declined' : 'cancelled'))).slice(0, 20); }
  return true;
}
module.exports = { start, get, incoming, answer, ice, end };
