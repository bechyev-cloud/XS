// Настройки тарифов и платёжных реквизитов — редактируются из супер-админ
// панели (/admin → Настройки) и хранятся в одном JSON-файле на диске.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  trialDays: 14,
  plans: [
    { id: 'start', name: 'Старт', price: 1500, carLimit: 3 },
    { id: 'standard', name: 'Стандарт', price: 2500, carLimit: 8 },
    { id: 'business', name: 'Бизнес', price: 4500, carLimit: 15 }
  ],
  // Реквизиты для перевода — то, что увидит клиент при выборе/продлении тарифа.
  // Заполните свои данные в /admin → Настройки перед реальным использованием.
  payment: {
    holder: '',       // получатель, например "Иванов Иван Иванович"
    bank: '',         // банк, например "Т-Банк"
    cardNumber: '',   // номер карты
    phone: '',        // телефон для перевода по СБП
    comment: '',      // произвольный комментарий/инструкция
    qrCodeImage: ''   // QR-код для оплаты (СБП/банк) — data:image/...;base64,..., загружается в /admin → Настройки
  },
  // Настройки отправки кода восстановления пароля — заполняются в
  // /admin → Настройки. Пока не заполнены, соответствующий способ
  // восстановления (почта/SMS) просто не отправляет сообщение (см.
  // server/lib/mailer.js, server/lib/sms.js).
  notify: {
    smtp: {
      host: '',       // например smtp.yandex.ru
      port: 587,
      secure: false,  // true для порта 465 (SSL), false для 587/25 (STARTTLS)
      user: '',        // логин почтового ящика, от имени которого отправляются письма
      pass: '',        // пароль или пароль приложения
      from: ''         // адрес в поле "От кого" — если пусто, используется user
    },
    sms: {
      login: '',       // логин в smsc.ru
      password: '',    // пароль или API-ключ smsc.ru
      sender: ''        // имя отправителя SMS (если подключено у вас в smsc.ru), необязательно
    }
  }
};

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Ошибка чтения конфигурации', filePath, e);
    return fallback;
  }
}
function writeJsonAtomic(filePath, data) {
  ensureDirs();
  const tmp = filePath + '.tmp' + process.pid + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

let queue = Promise.resolve();
function withLock(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

function mergeDefaults(cfg) {
  const merged = Object.assign({}, DEFAULT_CONFIG, cfg || {});
  merged.plans = Array.isArray(cfg && cfg.plans) && cfg.plans.length ? cfg.plans : DEFAULT_CONFIG.plans;
  merged.payment = Object.assign({}, DEFAULT_CONFIG.payment, (cfg && cfg.payment) || {});
  merged.notify = {
    smtp: Object.assign({}, DEFAULT_CONFIG.notify.smtp, (cfg && cfg.notify && cfg.notify.smtp) || {}),
    sms: Object.assign({}, DEFAULT_CONFIG.notify.sms, (cfg && cfg.notify && cfg.notify.sms) || {})
  };
  if (typeof merged.trialDays !== 'number' || merged.trialDays < 0) merged.trialDays = DEFAULT_CONFIG.trialDays;
  return merged;
}

async function readConfig() {
  return withLock(() => mergeDefaults(readJsonSafe(CONFIG_FILE, DEFAULT_CONFIG)));
}
async function writeConfig(cfg) {
  const merged = mergeDefaults(cfg);
  return withLock(() => { writeJsonAtomic(CONFIG_FILE, merged); return merged; });
}
function getPlanById(cfg, planId) {
  return (cfg.plans || []).find(p => p.id === planId) || null;
}

// Скидки за предоплату на несколько месяцев вперёд — 1 месяц без скидки,
// 3 месяца -10%, 6 месяцев -15%, 12 месяцев -20%. Используется и при расчёте
// суммы заявки (routes/billing.js), и при показе уже созданных заявок в
// админке (routes/admin.js) — единая точка правды, чтобы сумма нигде не
// разъехалась. Клиент (xcarapp/index.html) держит точно такую же таблицу
// только для отображения — реальная сумма всегда пересчитывается и
// проверяется здесь, на сервере, независимо от того, что прислал клиент.
const TARIFF_DISCOUNTS = { 1: 0, 3: 0.10, 6: 0.15, 12: 0.20 };
function computeTariffAmount(price, months) {
  const discount = TARIFF_DISCOUNTS[months] || 0;
  return Math.round((price || 0) * months * (1 - discount));
}

module.exports = { readConfig, writeConfig, getPlanById, DEFAULT_CONFIG, TARIFF_DISCOUNTS, computeTariffAmount };
