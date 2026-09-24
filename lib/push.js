// Web Push — уведомления в системный центр уведомлений телефона (Android,
// любой браузер на Chromium; iPhone — только если приложение добавлено на
// экран «Домой» через Safari, iOS 16.4 и новее), приходят даже когда
// приложение закрыто.
//
// VAPID-ключи генерируются автоматически при первом запуске и сохраняются в
// data/vapid.json (тот же приём, что JWT_SECRET в lib/auth.js — чтобы при
// следующем перезапуске сервера уже выданные подписки браузеров не
// "отвязались" из-за нового ключа). Можно задать свои через переменные
// окружения VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT — тогда файл не
// используется.
//
// Подписки браузера хранятся по одному JSON-файлу на пользователя в
// data/push/<userId>.json (массив объектов подписки, как их отдаёт
// PushSubscription.toJSON() в браузере).
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PUSH_DIR = path.join(DATA_DIR, 'push');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PUSH_DIR)) fs.mkdirSync(PUSH_DIR, { recursive: true });
}
ensureDirs();

function loadVapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  if (fs.existsSync(VAPID_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
      if (saved && saved.publicKey && saved.privateKey) return saved;
    } catch (e) { /* повреждённый файл — сгенерируем новый ниже */ }
  }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
  return keys;
}
const VAPID = loadVapid();
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@xcar.local';
webpush.setVapidDetails(VAPID_SUBJECT, VAPID.publicKey, VAPID.privateKey);

function subsFile(userId) {
  return path.join(PUSH_DIR, userId + '.json');
}
function readSubs(userId) {
  try {
    const f = subsFile(userId);
    if (!fs.existsSync(f)) return [];
    const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}
function writeSubs(userId, subs) {
  ensureDirs();
  if (!subs.length) {
    // Пустой список подписок — просто удаляем файл, чтобы он не попадал в
    // allUserIdsWithSubs() и уведомитель не проверял этого пользователя зря.
    try { if (fs.existsSync(subsFile(userId))) fs.unlinkSync(subsFile(userId)); } catch (e) {}
    return;
  }
  fs.writeFileSync(subsFile(userId), JSON.stringify(subs, null, 2));
}
function addSubscription(userId, subscription) {
  const subs = readSubs(userId).filter(s => s.endpoint !== subscription.endpoint);
  subs.push(Object.assign({ addedAt: new Date().toISOString() }, subscription));
  writeSubs(userId, subs);
}
function removeSubscription(userId, endpoint) {
  const subs = readSubs(userId).filter(s => s.endpoint !== endpoint);
  writeSubs(userId, subs);
}
// Отправляет уведомление всем подпискам пользователя (обычно несколько
// устройств). Подписки, которые браузер/сервер пушей считает более
// недействительными (404/410 — например, приложение удалено), тихо
// удаляются из хранилища.
async function sendToUser(userId, payload) {
  const subs = readSubs(userId);
  if (!subs.length) return { sent: 0 };
  let sent = 0;
  const alive = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent++;
      alive.push(sub);
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        // подписка больше не действительна — не сохраняем её обратно
      } else {
        alive.push(sub);
        console.error('push: не удалось отправить уведомление', userId, e && e.message);
      }
    }
  }
  if (alive.length !== subs.length) writeSubs(userId, alive);
  return { sent };
}
function allUserIdsWithSubs() {
  ensureDirs();
  return fs.readdirSync(PUSH_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5));
}

module.exports = {
  getPublicKey: () => VAPID.publicKey,
  addSubscription,
  removeSubscription,
  sendToUser,
  allUserIdsWithSubs,
  readSubs,
};
