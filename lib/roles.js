// Звания пользователей XCAR и ограничения, которые выдают админы прямо в приложении.
//   data/roles.json — {
//     roles: { uid: { role: 'dev'|'admin', by: uid|'control', at, lvl } },
//     restr: { uid: { chat?: until, tg?: until, xcar?: until, by, at } }   until = ISO | 'forever'
//   }
// Правила:
//   • Разработчиков не больше 2. Назначает только XCAR CONTROL (владелец сервера).
//   • Разработчик назначает админов (lvl 1) без ограничения и может снять любого админа.
//   • Админ, назначенный разработчиком (lvl 1), может назначить до 3 админов (lvl 2) и снять только их.
//   • Админ lvl 2 назначать не может.
//   • Разработчик и админ ограничивают пользователей: чаты (писать), Telegram-база, базы XCAR — на время или навсегда.
//     Админ не может ограничить разработчика или другого админа; разработчик может ограничить админа.
const { jsonFile } = require('./control/jsonfile');
const chatmod = require('./control/chatmod');

const MAX_DEV = 2, MAX_SUB = 3;
const base = () => ({ roles: {}, restr: {} });
const db = jsonFile('roles.json', base);
const norm = (d) => { d = d || {}; if (!d.roles || typeof d.roles !== 'object') d.roles = {}; if (!d.restr || typeof d.restr !== 'object') d.restr = {}; return d; };
let memo = null, memoAt = 0;
async function get() { if (memo && Date.now() - memoAt < 3000) return memo; memo = norm(await db.read()); memoAt = Date.now(); return memo; }
async function upd(fn) { const r = await db.update((d0) => fn(norm(d0))); memo = null; return r; }

function roleOf(d, uid) { return (d.roles[uid] || {}).role || ''; }
async function role(uid) { return roleOf(await get(), uid); }
async function map() { const d = await get(); const out = {}; Object.entries(d.roles).forEach(([u, r]) => { out[u] = r.role; }); return out; }

function active(until) { if (!until) return null; if (until === 'forever') return 'forever'; return Date.parse(until) > Date.now() ? until : null; }
async function restrOf(uid) { const r = (await get()).restr[uid] || {}; return { chat: active(r.chat), tg: active(r.tg), xcar: active(r.xcar) }; }

// что может пользователь uid (для приложения)
async function me(uid) {
  const d = await get(); const r = d.roles[uid];
  if (!r) return { role: '', canAppoint: false, left: 0 };
  if (r.role === 'dev') return { role: 'dev', canAppoint: true, left: null };
  const mine = Object.values(d.roles).filter((x) => x.by === uid && x.role === 'admin').length;
  const can = r.role === 'admin' && (r.lvl || 1) === 1;
  return { role: 'admin', lvl: r.lvl || 1, canAppoint: can, left: can ? Math.max(0, MAX_SUB - mine) : 0 };
}
// разработчик — только из XCAR CONTROL
async function setDev(uid, on) {
  return upd((d) => {
    if (!on) { if (roleOf(d, uid) === 'dev') delete d.roles[uid]; return { ok: true }; }
    const devs = Object.entries(d.roles).filter(([u, r]) => r.role === 'dev' && u !== uid).length;
    if (devs >= MAX_DEV) throw new Error('Разработчиков уже ' + MAX_DEV + ' — сначала снимите звание с одного из них');
    d.roles[uid] = { role: 'dev', by: 'control', at: new Date().toISOString() };
    delete d.restr[uid]; return { ok: true };
  });
}
async function setAdmin(by, uid, on) {
  if (by === uid) throw new Error('Нельзя менять своё звание');
  return upd((d) => {
    const me = d.roles[by]; if (!me) throw new Error('Нет прав');
    const cur = d.roles[uid];
    if (!on) {
      if (!cur || cur.role !== 'admin') return { ok: true };
      if (me.role === 'dev' || cur.by === by) { delete d.roles[uid]; Object.entries(d.roles).forEach(([u, r]) => { if (r.by === uid && r.role === 'admin') delete d.roles[u]; }); return { ok: true }; }
      throw new Error('Снять звание может только тот, кто его выдал, или разработчик');
    }
    if (cur && cur.role === 'dev') throw new Error('Пользователь — разработчик');
    if (cur && cur.role === 'admin') return { ok: true };
    if (me.role === 'dev') { d.roles[uid] = { role: 'admin', by, at: new Date().toISOString(), lvl: 1 }; return { ok: true }; }
    if (me.role === 'admin' && (me.lvl || 1) === 1) {
      const n = Object.values(d.roles).filter((x) => x.by === by && x.role === 'admin').length;
      if (n >= MAX_SUB) throw new Error('Вы уже назначили ' + MAX_SUB + ' админов — это максимум');
      d.roles[uid] = { role: 'admin', by, at: new Date().toISOString(), lvl: 2 }; return { ok: true };
    }
    throw new Error('Назначать админов могут разработчики и админы, которых назначил разработчик');
  });
}
// kind: chat | tg | xcar; hours: число | 'forever' | 0 (снять)
async function restrict(by, uid, kind, hours) {
  if (!['chat', 'tg', 'xcar'].includes(kind)) throw new Error('Неизвестное ограничение');
  if (by === uid) throw new Error('Нельзя ограничить себя');
  const until = !hours ? null : hours === 'forever' ? 'forever' : new Date(Date.now() + Math.min(24 * 3650, Math.max(0.25, Number(hours) || 0)) * 3600000).toISOString();
  await upd((d) => {
    const me = d.roles[by]; if (!me) throw new Error('Нет прав');
    const t = roleOf(d, uid);
    if (t === 'dev') throw new Error('Разработчика ограничить нельзя');
    if (t === 'admin' && me.role !== 'dev') throw new Error('Админа может ограничить только разработчик');
    const r = d.restr[uid] || (d.restr[uid] = {});
    if (until) r[kind] = until; else delete r[kind];
    r.by = by; r.at = new Date().toISOString();
    if (!r.chat && !r.tg && !r.xcar) delete d.restr[uid];
    return true;
  });
  // ограничение чатов работает через общую модерацию (группа, личные, поддержка)
  if (kind === 'chat') await chatmod.setMute(uid, until ? (until === 'forever' ? 'forever' : (Date.parse(until) - Date.now()) / 3600000) : 0, 'app:' + by);
  return { ok: true, until };
}
async function devCount() { return Object.values((await get()).roles).filter((r) => r.role === 'dev').length; }
module.exports = { MAX_DEV, MAX_SUB, role, map, me, restrOf, setDev, setAdmin, restrict, devCount };
