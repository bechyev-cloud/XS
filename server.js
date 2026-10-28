// Настройки сервера берутся из переменных окружения (на Render — Environment).
// Для запуска на своём компьютере/Ubuntu можно положить рядом файл server.env
// (имя без точки в начале — такой файл нормально загружается на GitHub и виден
// в Windows). Старый вариант с файлом .env тоже поддерживается. Уже заданные
// переменные окружения файлами не перезаписываются.
{
  const dotenv = require('dotenv');
  const p = require('path');
  dotenv.config({ path: p.join(__dirname, 'server.env') });
  dotenv.config({ path: p.join(__dirname, '.env') });
}
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const adminRoutes = require('./routes/admin');
const billingRoutes = require('./routes/billing');
const pushRoutes = require('./routes/push');
const supportRoutes = require('./routes/support');
const communityRoutes = require('./routes/community');
const checkRoutes = require('./routes/check');
const control = require('./routes/control');
const monitor = require('./lib/control/monitor');
const { startNotifier } = require('./lib/notifier');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(monitor.middleware);
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
// Лимит побольше стандартного: в данных бывают фото машин / документов в base64.
app.use(express.json({ limit: '130mb' }));
// Сквозное шифрование: рукопожатие + расшифровка запросов / шифрование ответов (lib/e2e.js)
const e2e = require('./lib/e2e');
app.post('/api/e2e/hello', e2e.hello);
app.get('/api/e2e/info', (req, res) => { const s = e2e.status(); res.json({ ok: true, fingerprint: s.fingerprint, alg: s.alg }); });
app.use(e2e.middleware);

app.get('/api/health', async (req, res) => {
  // app — настройки пользовательского приложения из панели (например, скрыть раздел «Серверы»)
  let appCfg = { hideServerSettings: false, e2eForce: false };
  try { appCfg = (await require('./lib/control/settings').get()).app; } catch (e) { /* по умолчанию */ }
  res.json({ ok: true, app: appCfg, name: 'xcar-server', time: new Date().toISOString(), version: monitor.VERSION, uptime: Math.round((Date.now() - monitor.STARTED) / 1000) });
});
// Краткие метрики нагрузки (без секретов) — для мониторинга из XCAR CONTROL другого сервера
app.get('/api/health/metrics', (req, res) => { res.json(monitor.publicMetrics()); });

// Установочные файлы для обновления приложения (Android / Windows) — загружает администратор в XCAR CONTROL
const releases = require('./lib/control/releases');
app.get('/api/app/release', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true, releases: await releases.info() }); });
// Публичные ссылки для клиентов: страница загрузки и прямые ссылки на файлы
//   /download — страница с кнопками Android и Windows (сама подсвечивает нужную)
//   /download/android, /download/windows — сразу скачивание файла
app.get(['/download/android', '/download/windows'], async (req, res) => { const p = req.path.split('/').pop(); const r = (await releases.info())[p]; res.redirect(302, r ? '/api/app/download/' + p : '/download'); });
app.get('/download', async (req, res) => {
  const r = await releases.info(); const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace('.', ',') + ' МБ';
  const card = (p, title, sub, ic) => { const x = r[p]; return `<a class="dl ${x ? '' : 'off'}" id="dl-${p}" ${x ? `href="/download/${p}"` : ''}><span class="ic">${ic}</span><span class="t"><b>${title}</b><small>${x ? `версия ${esc(x.version)} · ${mb(x.size)}` : 'скоро будет доступно'}</small><em>${sub}</em></span><span class="go">${x ? 'Скачать' : '—'}</span></a>`; };
  const android = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>';
  const win = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Скачать XCAR</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:radial-gradient(900px 500px at 20% 0%,#fff1d8,transparent 60%),radial-gradient(800px 500px at 100% 100%,#dff7ec,transparent 60%),#f6f7f9;color:#16181d;display:flex;align-items:center;justify-content:center;padding:24px}
.w{width:100%;max-width:440px;text-align:center}.logo{width:84px;height:84px;border-radius:24px;margin:0 auto 14px;box-shadow:0 14px 30px rgba(242,169,59,.35)}h1{margin:0;font-size:30px;letter-spacing:-.5px}p.s{color:#6b7280;margin:6px 0 24px;font-size:15px;line-height:1.5}
.dl{display:flex;align-items:center;gap:14px;text-align:left;text-decoration:none;color:inherit;background:#fff;border:1px solid #eceef1;border-radius:20px;padding:16px;margin-bottom:12px;box-shadow:0 6px 18px rgba(20,30,50,.06);transition:transform .15s,box-shadow .15s}
.dl:hover{transform:translateY(-2px);box-shadow:0 12px 26px rgba(20,30,50,.1)}.dl.mine{border:2px solid #13a46c;box-shadow:0 12px 28px rgba(19,164,108,.2)}.dl.off{opacity:.55;pointer-events:none}
.ic{width:50px;height:50px;border-radius:15px;background:#e8f8f0;color:#13a46c;display:flex;align-items:center;justify-content:center;flex-shrink:0}.ic svg{width:26px;height:26px}
.t{flex:1;min-width:0}.t b{display:block;font-size:17px}.t small{display:block;color:#6b7280;font-size:13px;margin-top:2px}.t em{display:block;font-style:normal;color:#9ca3af;font-size:12px;margin-top:2px}
.go{background:linear-gradient(155deg,#3fd69c,#13a46c);color:#fff;font-weight:800;font-size:14px;border-radius:12px;padding:10px 14px;white-space:nowrap}
.n{margin-top:18px;font-size:12.5px;color:#9ca3af;line-height:1.6}.n b{color:#6b7280}</style></head><body><div class="w">
<img class="logo" src="/icon-512.png" alt="XCAR"><h1>XCAR</h1><p class="s">Учёт автопроката: машины, клиенты, договоры и отчёты.<br>Скачайте приложение для своего устройства.</p>
${card('android', 'Android', 'для телефона и планшета', android)}${card('windows', 'Windows', 'для компьютера и ноутбука', win)}
<div class="n"><b>Android:</b> после загрузки откройте файл и разрешите установку из этого источника.<br><b>Windows:</b> запустите скачанный файл — программа установится и откроется.</div></div>
<script>var u=navigator.userAgent;var m=/Android/i.test(u)?'android':/Windows/i.test(u)?'windows':'';if(m){var e=document.getElementById('dl-'+m);if(e){e.classList.add('mine');e.parentNode.insertBefore(e,e.parentNode.querySelector('.dl'));}}</script></body></html>`);
});
app.get('/api/app/download/:platform', async (req, res) => {
  const p = req.params.platform; const r = (await releases.info())[p];
  if (!r) return res.status(404).json({ error: 'Файл обновления не загружен' });
  res.setHeader('Content-Type', releases.MIME[p]);
  res.setHeader('Content-Length', r.size);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(r.name)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');
  require('fs').createReadStream(releases.fileOf(p)).pipe(res);
});
// Статистика проката: общая (все пользователи XCAR) или своя
app.get('/api/market/stats', require('./lib/auth').authMiddleware, async (req, res) => {
  try { res.json(await require('./lib/market').compute({ period: req.query.period, scope: req.query.scope, userId: req.userId })); }
  catch (e) { console.error('Статистика проката:', e); res.status(500).json({ error: 'Не удалось посчитать статистику: ' + (e && e.message || 'ошибка') }); }
});
// Готовые машины от администратора — приложение забирает их при запуске
app.get('/api/presets/cars', require('./lib/auth').authMiddleware, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ cars: await require('./lib/control/carpresets').forUser(req.userId) });
});
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/check', checkRoutes);
app.use('/api/service', require('./routes/service'));
app.use('/api/control', control.router);
// «Статус автопарка»: ссылка для клиентов (Машины → Статус в приложении)
const parkRoutes = require('./routes/park');
app.use('/api/park', parkRoutes.owner);
app.use('/api/public', parkRoutes.pub);
app.use('/', parkRoutes.html);
const userPage = require('./routes/userpage');
app.use('/api/public', userPage.pub);
app.use('/', userPage.html);

// Супер-админ панель — отдаётся прямо этим сервером, без отдельного хостинга.
// Откройте https://ваш-сервер/admin в браузере.
// XCAR CONTROL — новая панель управления (PWA), папка ../xcar-control рядом с server/
const CONTROL_DIR = [process.env.CONTROL_DIR, path.join(__dirname, '..', 'xcar-control'), path.join(__dirname, 'control-public')]
  .filter(Boolean).find((d) => fs.existsSync(path.join(d, 'index.html')));
if (CONTROL_DIR) {
  // /control → /control/ (относительные пути PWA). Express по умолчанию не различает
  // хвостовой слэш, поэтому проверяем исходный URL, иначе будет бесконечный редирект.
  app.get('/control', (req, res, next) => (req.originalUrl.split('?')[0] === '/control' ? res.redirect(301, '/control/') : next()));
  app.use('/control', express.static(CONTROL_DIR, { index: 'index.html', setHeaders(res, fp) { if (/(index\.html|sw\.js|manifest\.json)$/.test(fp)) res.setHeader('Cache-Control', 'no-cache'); } }));
}
app.get(['/admin', '/admin.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Само приложение XCAR тоже раздаётся этим сервером (если рядом лежит папка
// xcarapp или server/public). Это нужно для работы в домашнем Wi-Fi по IP:
// откройте на телефоне http://192.168.x.x:8080 — приложение и API будут на
// одном адресе, и браузер не заблокирует запросы (с https-страницы на
// http://192.168... браузеры запросы не пускают). Отключить: SERVE_APP=false.
const APP_DIR = [process.env.APP_DIR, path.join(__dirname, '..', 'xcarapp'), path.join(__dirname, 'public')]
  .filter(Boolean)
  .find((d) => fs.existsSync(path.join(d, 'index.html')));
if (APP_DIR && process.env.SERVE_APP !== 'false') {
  app.use(express.static(APP_DIR, {
    index: 'index.html',
    setHeaders(res, filePath) {
      if (/(index\.html|sw\.js|manifest\.json)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
}

app.use((req, res) => res.status(404).json({ error: 'Не найдено' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой объём данных' });
  }
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const PORT = process.env.PORT || 8080;
function lanAddresses() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach((list) => (list || []).forEach((a) => {
    if (a && (a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
  }));
  return out;
}
app.listen(PORT, () => {
  console.log(`XCAR server запущен на порту ${PORT}`);
  if (APP_DIR && process.env.SERVE_APP !== 'false') {
    const ips = lanAddresses();
    if (ips.length) {
      console.log('Приложение в домашнем Wi-Fi (откройте на телефоне):');
      ips.forEach((ip) => console.log(`   http://${ip}:${PORT}`));
    }
  }
});

// Проверка просроченных аренд и напоминаний о ТО для push-уведомлений — раз
// в 5 минут, пока процесс сервера жив (см. комментарий в lib/notifier.js
// про "засыпание" на бесплатных тарифах хостинга).
startNotifier(5 * 60 * 1000);
control.startJobs();
