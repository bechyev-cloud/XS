// Резервные копии всего сервера XCAR: ручные, автоматические (по расписанию),
// «страховочные» перед восстановлением. Формат — .json.gz: { meta, files:{путь: base64} }.
// Секреты (JWT, VAPID), активные сессии и сами копии в архив не попадают.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { DATA_DIR, dataPath, ensureDir, jsonFile, writeJsonAtomic, readJsonSafe } = require('./jsonfile');

const BK_DIR = dataPath('backups');
const state = jsonFile('control-backup-state.json', () => ({ lastAuto: null, lastResult: null, lastError: null, lastAt: null }));
const EXCLUDE = [/^backups\//, /^\.jwt-secret$/, /^vapid\.json$/, /^control-sessions\.json$/, /\.tmp/, /^\.health-check$/, /^control-backup-state\.json$/];

function walk(dir, base = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (EXCLUDE.some((re) => re.test(rel))) continue;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel)); else out.push(rel);
  }
  return out;
}
function listFiles() { ensureDir(BK_DIR); return fs.readdirSync(BK_DIR).filter((f) => /^xcar-backup-.*\.json\.gz$/.test(f)); }
function metaPath(file) { return path.join(BK_DIR, file.replace(/\.json\.gz$/, '.meta.json')); }

async function create(kind, adminName) {
  const t0 = Date.now();
  try {
    const files = {};
    for (const rel of walk(DATA_DIR)) files[rel] = fs.readFileSync(path.join(DATA_DIR, rel)).toString('base64');
    const users = readJsonSafe(dataPath('users.json'), { users: [] }).users || [];
    const at = new Date();
    const id = at.toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
    const meta = { id, file: `xcar-backup-${id}.json.gz`, kind: kind || 'manual', createdAt: at.toISOString(), usersCount: users.length,
      filesCount: Object.keys(files).length, by: adminName || 'system', version: require('./monitor').VERSION };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ meta, files })));
    ensureDir(BK_DIR);
    fs.writeFileSync(path.join(BK_DIR, meta.file), gz);
    meta.size = gz.length; meta.ms = Date.now() - t0;
    fs.writeFileSync(metaPath(meta.file), JSON.stringify(meta));
    await state.update((s) => { s.lastResult = 'ok'; s.lastError = null; s.lastAt = meta.createdAt; if (kind === 'auto') s.lastAuto = meta.createdAt; });
    return meta;
  } catch (e) {
    await state.update((s) => { s.lastResult = 'error'; s.lastError = e.message; s.lastAt = new Date().toISOString(); if (kind === 'auto') s.lastAuto = new Date().toISOString(); });
    throw e;
  }
}
function list() {
  return listFiles().map((f) => { const m = readJsonSafe(metaPath(f), null); if (m) return m; const st = fs.statSync(path.join(BK_DIR, f)); return { id: f, file: f, createdAt: st.mtime.toISOString(), size: st.size, kind: 'imported' }; })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
function findFile(id) { const m = list().find((x) => x.id === id); return m ? path.join(BK_DIR, m.file) : null; }
function load(id) { const f = findFile(id); if (!f) return null; return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); }
function remove(id) { const m = list().find((x) => x.id === id); if (!m) return false; try { fs.unlinkSync(path.join(BK_DIR, m.file)); } catch (e) {} try { fs.unlinkSync(metaPath(m.file)); } catch (e) {} return true; }
function prune(keep) { const l = list().filter((m) => m.kind === 'auto'); l.slice(keep).forEach((m) => remove(m.id)); }

// Предпросмотр: какие пользователи и сколько данных у каждого в копии
function preview(id) {
  const b = load(id); if (!b) return null;
  const users = JSON.parse(Buffer.from(b.files['users.json'] || Buffer.from('{"users":[]}').toString('base64'), 'base64').toString('utf8')).users || [];
  const current = new Set((readJsonSafe(dataPath('users.json'), { users: [] }).users || []).map((u) => u.id));
  return { meta: b.meta, system: Object.keys(b.files).filter((k) => !k.startsWith('stores/') && k !== 'users.json'),
    users: users.map((u) => { const raw = b.files['stores/' + u.id + '.json']; let s = {}; try { s = raw ? JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) : {}; } catch (e) {}
      return { id: u.id, name: u.companyName || u.fullName, phone: u.phone, existsNow: current.has(u.id), cars: (s.cars || []).length, clients: (s.clients || []).length, contracts: (s.contracts || []).length }; }) };
}
// Восстановление (вызывается только после двухшагового подтверждения в API)
async function restore(id, { userIds, includeAccounts, includeSystem }, adminName) {
  const b = load(id); if (!b) throw new Error('Копия не найдена');
  const safety = await create('pre-restore', adminName);
  const { readUsers, writeUsers, writeStore } = require('../store');
  const bu = JSON.parse(Buffer.from(b.files['users.json'] || '', 'base64').toString('utf8') || '{"users":[]}').users || [];
  const ids = Array.isArray(userIds) && userIds.length ? userIds : bu.map((u) => u.id);
  const usersData = await readUsers();
  let restored = 0, accounts = 0;
  for (const uid of ids) {
    const raw = b.files['stores/' + uid + '.json'];
    const bUser = bu.find((u) => u.id === uid);
    const cur = usersData.users.find((u) => u.id === uid);
    if (!cur && bUser) { usersData.users.push(bUser); accounts++; }
    else if (cur && bUser && includeAccounts) { Object.assign(cur, bUser); accounts++; }
    if (raw) { await writeStore(uid, JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))); restored++; }
  }
  await writeUsers(usersData);
  let systemFiles = 0;
  if (includeSystem) {
    for (const [rel, data] of Object.entries(b.files)) {
      if (rel === 'users.json' || rel.startsWith('stores/') || rel.startsWith('control-admins')) continue;
      const p = path.join(DATA_DIR, rel); ensureDir(path.dirname(p)); fs.writeFileSync(p, Buffer.from(data, 'base64')); systemFiles++;
    }
  }
  require('./aggregate').invalidate();
  return { restored, accounts, systemFiles, safetyBackup: safety.id };
}
function importFile(buf) {
  let obj; try { obj = JSON.parse(zlib.gunzipSync(buf).toString('utf8')); } catch (e) { throw new Error('Это не файл резервной копии XCAR (.json.gz)'); }
  if (!obj || !obj.files || !obj.meta) throw new Error('Это не файл резервной копии XCAR');
  const at = new Date(); const id = 'import-' + at.toISOString().replace(/[:.]/g, '-');
  const meta = Object.assign({}, obj.meta, { id, file: `xcar-backup-${id}.json.gz`, kind: 'imported', importedAt: at.toISOString(), size: buf.length });
  ensureDir(BK_DIR); fs.writeFileSync(path.join(BK_DIR, meta.file), buf); fs.writeFileSync(metaPath(meta.file), JSON.stringify(meta));
  return meta;
}
async function health(cfg) {
  const s = await state.read(); const l = list();
  const lastAuto = s.lastAuto ? new Date(s.lastAuto).getTime() : 0;
  const next = cfg.auto ? new Date(Math.max(Date.now(), lastAuto + cfg.everyHours * 3600 * 1000)).toISOString() : null;
  return { last: l[0] || null, lastResult: s.lastResult, lastError: s.lastError, lastAt: s.lastAt, next, auto: cfg.auto, everyHours: cfg.everyHours, keep: cfg.keep, count: l.length, totalSize: l.reduce((x, m) => x + (m.size || 0), 0) };
}
async function autoTick(cfg) {
  if (!cfg.auto) return null;
  const s = await state.read(); const lastAuto = s.lastAuto ? new Date(s.lastAuto).getTime() : 0;
  if (Date.now() - lastAuto < cfg.everyHours * 3600 * 1000) return null;
  try { const m = await create('auto', 'Автоматически'); prune(cfg.keep); return m; } catch (e) { console.error('Авто-бэкап не удался:', e.message); return null; }
}

/* ---------- история настроек пользователя (для «Восстановления настроек») ---------- */
const HIST_DIR = dataPath('settings-history');
function recordSettings(userId, prevSettings) {
  if (!prevSettings || typeof prevSettings !== 'object' || !Object.keys(prevSettings).length) return;
  if (!/^[0-9a-f-]{36}$/.test(userId)) return;
  const f = path.join(HIST_DIR, userId + '.json');
  const h = readJsonSafe(f, { versions: [] });
  const json = JSON.stringify(prevSettings);
  const last = h.versions[h.versions.length - 1];
  if (last && JSON.stringify(last.settings) === json) return;
  // не чаще раза в 10 минут — чтобы серия мелких правок не вытеснила историю
  if (last && Date.now() - new Date(last.at).getTime() < 10 * 60 * 1000) { last.settings = prevSettings; last.at = new Date().toISOString(); }
  else h.versions.push({ at: new Date().toISOString(), settings: prevSettings });
  if (h.versions.length > 30) h.versions = h.versions.slice(-30);
  ensureDir(HIST_DIR); writeJsonAtomic(f, h);
}
function settingsVersions(userId) {
  const out = [];
  const h = readJsonSafe(path.join(HIST_DIR, userId + '.json'), { versions: [] });
  h.versions.forEach((v, i) => out.push({ id: 'h' + i, source: 'history', at: v.at, settings: v.settings }));
  for (const m of list().slice(0, 20)) {
    try { const b = load(m.id); const raw = b && b.files['stores/' + userId + '.json']; if (!raw) continue; const s = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')).settings; if (s && Object.keys(s).length) out.push({ id: 'b:' + m.id, source: 'backup', at: m.createdAt, settings: s }); } catch (e) {}
  }
  out.sort((a, b) => (a.at < b.at ? 1 : -1));
  const seen = new Set();
  return out.filter((v) => { const k = JSON.stringify(v.settings); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((v, i, arr) => Object.assign(v, { version: arr.length - i }));
}
module.exports = { create, list, load, remove, preview, restore, importFile, health, autoTick, findFile, recordSettings, settingsVersions };
