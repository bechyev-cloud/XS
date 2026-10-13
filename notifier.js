// Периодическая проверка на просроченные аренды и напоминания о ТО, плюс
// отправка push-уведомлений владельцу аккаунта. Работает, пока процесс
// сервера жив — на бесплатных тарифах некоторых хостингов (например,
// Render Free) процесс может "засыпать" при отсутствии запросов; тогда
// таймер тоже не сработает, пока кто-нибудь не откроет приложение и не
// разбудит сервер обычным запросом. Для надёжной доставки по расписанию на
// таком тарифе стоит настроить внешний "будильник" (uptime-пингер), который
// раз в несколько минут дёргает GET /api/health.
const fs = require('fs');
const path = require('path');
const { readStore } = require('./store');
const push = require('./push');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_DIR = path.join(DATA_DIR, 'notify-state');

function ensureDirs() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}
function stateFile(userId) {
  return path.join(STATE_DIR, userId + '.json');
}
function readState(userId) {
  try {
    const f = stateFile(userId);
    if (!fs.existsSync(f)) return { overdue: {}, oil: {} };
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { overdue: st.overdue || {}, oil: st.oil || {} };
  } catch (e) {
    return { overdue: {}, oil: {} };
  }
}
function writeState(userId, state) {
  ensureDirs();
  fs.writeFileSync(stateFile(userId), JSON.stringify(state, null, 2));
}

const RENOTIFY_MS = 24 * 3600 * 1000; // не напоминать чаще раза в сутки по одному и тому же поводу

async function checkUser(userId) {
  const store = await readStore(userId);
  const cars = store.cars || [];
  const contracts = store.contracts || [];
  const state = readState(userId);
  const now = Date.now();
  let changed = false;

  // Просроченные аренды — активный договор аренды, у которого плановое
  // время возврата (end) уже прошло. Та же проверка, что и на клиенте
  // (значок "Просрочено" — timeLeftLabel()), но здесь она обязана
  // выполняться на сервере, чтобы прийти в закрытое приложение.
  for (const ct of contracts) {
    if ((ct.type && ct.type !== 'rental') || ct.status !== 'active' || !ct.end) continue;
    if (new Date(ct.end).getTime() >= now) continue;
    const last = state.overdue[ct.id];
    if (last && now - last < RENOTIFY_MS) continue;
    const car = cars.find(c => c.id === ct.carId);
    const label = car ? `${car.make} ${car.model}${car.plate ? ' · ' + car.plate : ''}` : 'машина';
    await push.sendToUser(userId, {
      title: '⏰ Просрочен возврат аренды',
      body: `${label} — аренда должна была закончиться ${new Date(ct.end).toLocaleString('ru-RU')}, машина ещё не сдана.`,
      tag: 'overdue-' + ct.id,
    });
    state.overdue[ct.id] = now;
    changed = true;
  }
  // Убираем из состояния договоры, которые уже не активны — чтобы файл не
  // рос бесконечно и чтобы повторная просрочка той же машины (новый
  // договор) снова уведомляла.
  Object.keys(state.overdue).forEach(id => {
    const ct = contracts.find(c => c.id === id);
    if (!ct || ct.status !== 'active') delete state.overdue[id];
  });

  // Напоминания о ТО/замене масла — car.oilReminderDate, та же проверка,
  // что и клиентская (openCarForm: todayISO() >= car.oilReminderDate).
  const todayISO = new Date().toISOString().slice(0, 10);
  for (const car of cars) {
    if (!car.oilReminderDate || car.oilReminderDate > todayISO) continue;
    const last = state.oil[car.id];
    if (last && now - last < RENOTIFY_MS) continue;
    await push.sendToUser(userId, {
      title: '🔔 Пора менять масло',
      body: `${car.make} ${car.model}${car.plate ? ' · ' + car.plate : ''} — подошёл срок планового ТО.`,
      tag: 'oil-' + car.id,
    });
    state.oil[car.id] = now;
    changed = true;
  }
  Object.keys(state.oil).forEach(id => {
    const car = cars.find(c => c.id === id);
    if (!car || !car.oilReminderDate || car.oilReminderDate > todayISO) delete state.oil[id];
  });

  if (changed) writeState(userId, state);
}

async function checkAllUsers() {
  const userIds = push.allUserIdsWithSubs();
  for (const userId of userIds) {
    try {
      await checkUser(userId);
    } catch (e) {
      console.error('notifier: ошибка проверки пользователя', userId, e && e.message);
    }
  }
}

function startNotifier(intervalMs) {
  checkAllUsers().catch(e => console.error('notifier: ошибка первого прогона', e && e.message));
  return setInterval(() => {
    checkAllUsers().catch(e => console.error('notifier: ошибка прогона', e && e.message));
  }, intervalMs);
}

module.exports = { startNotifier, checkAllUsers };
