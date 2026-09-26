require('dotenv').config();
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
const { startNotifier } = require('./lib/notifier');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
// Лимит побольше стандартного: в данных бывают фото машин / документов в base64.
app.use(express.json({ limit: '30mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'xcar-server', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/community', communityRoutes);

// Супер-админ панель — отдаётся прямо этим сервером, без отдельного хостинга.
// Откройте https://ваш-сервер/admin в браузере.
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
