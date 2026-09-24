require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const adminRoutes = require('./routes/admin');
const billingRoutes = require('./routes/billing');
const pushRoutes = require('./routes/push');
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

// Супер-админ панель — отдаётся прямо этим сервером, без отдельного хостинга.
// Откройте https://ваш-сервер/admin в браузере.
app.get(['/admin', '/admin.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

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
app.listen(PORT, () => {
  console.log(`XCAR server запущен на порту ${PORT}`);
});

// Проверка просроченных аренд и напоминаний о ТО для push-уведомлений — раз
// в 5 минут, пока процесс сервера жив (см. комментарий в lib/notifier.js
// про "засыпание" на бесплатных тарифах хостинга).
startNotifier(5 * 60 * 1000);
