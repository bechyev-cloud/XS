// Мониторинг серверов: метрики этого процесса (CPU, RAM, диск, сеть, API,
// база, кэш) и проверки удалённых серверов из списка в Настройках.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_DIR } = require('./jsonfile');
const aggregate = require('./aggregate');

const VERSION = (() => { try { return require('../../package.json').version; } catch (e) { return '1.0.0'; } })();
const STARTED = Date.now();

/* ---------- счётчики запросов ---------- */
const reqLog = []; // {t, ms, status, bytes}
let bytesOut = 0, bytesIn = 0;
function middleware(req, res, next) {
  const t0 = process.hrtime.bigint();
  bytesIn += Number(req.headers['content-length'] || 0);
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const b = Number(res.getHeader('content-length') || 0); bytesOut += b;
    if (req.originalUrl.startsWith('/api/')) { reqLog.push({ t: Date.now(), ms, status: res.statusCode, bytes: b }); if (reqLog.length > 5000) reqLog.splice(0, reqLog.length - 5000); }
  });
  next();
}

/* ---------- CPU ---------- */
let lastCpu = os.cpus(), cpuPct = 0;
setInterval(() => {
  const cur = os.cpus(); let idle = 0, total = 0;
  cur.forEach((c, i) => { const p = lastCpu[i] || c; const t = (k) => c.times[k] - p.times[k]; const tt = t('user') + t('nice') + t('sys') + t('idle') + t('irq'); total += tt; idle += t('idle'); });
  cpuPct = total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0; lastCpu = cur;
}, 5000).unref();

function dirSize(dir, depth = 0) {
  let size = 0, files = 0;
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (depth < 3) { const r = dirSize(p, depth + 1); size += r.size; files += r.files; } } else { try { size += fs.statSync(p).size; files++; } catch (x) {} } } } catch (e) {}
  return { size, files };
}
function disk() {
  try { if (fs.statfsSync) { const s = fs.statfsSync(DATA_DIR); const total = s.blocks * s.bsize; const free = s.bavail * s.bsize; return { total, free, used: total - free, pct: total ? Math.round((1 - free / total) * 1000) / 10 : 0 }; } } catch (e) {}
  return null;
}
function dbCheck() {
  const t0 = Date.now();
  try { const f = path.join(DATA_DIR, '.health-check'); fs.writeFileSync(f, String(Date.now())); fs.readFileSync(f); fs.unlinkSync(f); return { ok: true, ms: Date.now() - t0 }; }
  catch (e) { return { ok: false, error: e.message }; }
}
function localMetrics() {
  const now = Date.now(); const last5 = reqLog.filter((r) => now - r.t < 5 * 60 * 1000); const last1 = last5.filter((r) => now - r.t < 60 * 1000);
  const avg = last5.length ? last5.reduce((s, r) => s + r.ms, 0) / last5.length : 0;
  const errors = last5.filter((r) => r.status >= 500).length;
  const mem = { total: os.totalmem(), free: os.freemem() }; mem.used = mem.total - mem.free; mem.pct = Math.round(mem.used / mem.total * 1000) / 10;
  const ds = dirSize(DATA_DIR); const db = dbCheck();
  const cs = aggregate.stats; const ch = cs.hits + cs.misses;
  return {
    version: VERSION, uptime: Math.round((now - STARTED) / 1000), node: process.version, platform: `${os.type()} ${os.release()}`, hostname: os.hostname(),
    cpu: { pct: cpuPct, cores: os.cpus().length, load: os.loadavg().map((x) => Math.round(x * 100) / 100) },
    ram: Object.assign(mem, { process: process.memoryUsage().rss }),
    disk: disk(),
    network: { reqPerMin: last1.length, bytesOut, bytesIn, outPerMin: last1.reduce((s, r) => s + r.bytes, 0) },
    api: { avgMs: Math.round(avg * 10) / 10, requests5m: last5.length, errors5m: errors, ok: errors === 0 || errors / Math.max(1, last5.length) < 0.05 },
    database: Object.assign({ type: 'JSON-файлы', size: ds.size, files: ds.files }, db),
    cache: { type: 'In-memory (агрегаты, 10 c)', hits: cs.hits, misses: cs.misses, hitRate: ch ? Math.round(cs.hits / ch * 100) : 0 },
    checkedAt: new Date().toISOString(),
  };
}
// Публичная краткая версия (без хостнейма и т.п.) — для /api/health/metrics
function publicMetrics() { const m = localMetrics(); return { version: m.version, uptime: m.uptime, cpu: m.cpu.pct, ram: m.ram.pct, disk: m.disk ? m.disk.pct : null, api: m.api.avgMs }; }

/* ---------- удалённые серверы ---------- */
const history = new Map(); // id -> [{t, ok, ms}]
const lastResult = new Map();
async function fetchJson(url, timeout) {
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), timeout || 8000);
  const t0 = Date.now();
  try { const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'XCAR-CONTROL-monitor' } }); const ms = Date.now() - t0; let b = null; try { b = await r.json(); } catch (e) {} return { ok: r.ok, status: r.status, ms, body: b }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, error: e.name === 'AbortError' ? 'Таймаут' : 'Нет соединения' }; }
  finally { clearTimeout(tm); }
}
function normApi(url) { let u = String(url || '').trim().replace(/\/+$/, ''); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; if (!/\/api$/i.test(u)) u += '/api'; return u; }
function record(id, ok, ms) { const h = history.get(id) || []; h.push({ t: Date.now(), ok, ms }); while (h.length && Date.now() - h[0].t > 24 * 3600 * 1000) h.shift(); history.set(id, h); }
function uptimePct(id) { const h = history.get(id) || []; if (!h.length) return null; return Math.round(h.filter((x) => x.ok).length / h.length * 1000) / 10; }
async function checkServer(s) {
  if (!s.url && s.role !== 'primary') { // адрес ещё не указан
    const r = { id: s.id, name: s.name, role: s.role, url: '', self: false, online: null, notConfigured: true, error: 'Адрес не указан', checkedAt: new Date().toISOString() };
    lastResult.set(s.id, r); return r;
  }
  if (!s.url) { // этот сервер
    const m = localMetrics(); record(s.id, true, 0);
    const r = { id: s.id, name: s.name, role: s.role, url: '(этот сервер)', self: true, online: true, ping: 0, version: m.version, uptime: m.uptime,
      cpu: m.cpu.pct, ram: m.ram.pct, disk: m.disk ? m.disk.pct : null, availability: uptimePct(s.id), checkedAt: m.checkedAt };
    lastResult.set(s.id, r); return r;
  }
  const api = normApi(s.url);
  const h = await fetchJson(api + '/health', 8000);
  const online = !!(h.ok && h.body && h.body.ok);
  record(s.id, online, h.ms);
  let met = null; if (online) { const mm = await fetchJson(api + '/health/metrics', 6000); if (mm.ok && mm.body) met = mm.body; }
  const r = { id: s.id, name: s.name, role: s.role, url: api, self: false, online, ping: online ? h.ms : null, error: online ? null : (h.error || ('Ответ ' + (h.status || '—'))),
    version: (h.body && h.body.version) || (met && met.version) || null, uptime: (h.body && h.body.uptime) || (met && met.uptime) || null,
    cpu: met ? met.cpu : null, ram: met ? met.ram : null, disk: met ? met.disk : null, availability: uptimePct(s.id), checkedAt: new Date().toISOString() };
  lastResult.set(s.id, r); return r;
}
async function checkAll(servers) { return Promise.all(servers.map(checkServer)); }
function last(id) { return lastResult.get(id) || null; }
module.exports = { middleware, localMetrics, publicMetrics, checkServer, checkAll, last, VERSION, STARTED, normApi };
