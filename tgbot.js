// Telegram-бот для базы «Проверка клиента».
// Администратор вставляет токен бота (от @BotFather) в XCAR CONTROL → Проверка клиента → Telegram-бот.
// Сервер сам опрашивает Telegram (getUpdates, без вебхука и без открытых портов).
// Разрешённые пользователи пишут/пересылают боту сообщения — каждое становится карточкой
// в файле «Telegram-бот.txt». Если добавить бота администратором в канал — посты канала
// тоже попадают в базу (переключатель «Посты каналов»).
// Команды: /start /help /id — ваш ID, /find текст — поиск, /count — сколько записей, /undo — удалить свою последнюю запись.
const { jsonFile } = require('./jsonfile');
const bl = require('./blacklist');

const db = jsonFile('tgbot.json', () => ({ enabled: false, token: '', allowed: [], channels: true, fileId: null, offset: 0, bot: null, lastError: '', lastOkAt: null, added: 0, recent: [] }));
let started = false, wakeUp = null;
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); wakeUp = () => { clearTimeout(t); r(); }; });

async function tg(token, method, body, timeoutMs) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ac.signal });
    return await r.json();
  } finally { clearTimeout(t); }
}
const pub = (s) => ({ enabled: !!s.enabled, hasToken: !!s.token, tokenTail: s.token ? '…' + s.token.slice(-6) : '', allowed: s.allowed || [], channels: s.channels !== false, fileId: s.fileId, bot: s.bot, lastError: s.lastError || '', lastOkAt: s.lastOkAt, added: s.added || 0, recent: (s.recent || []).slice(-15).reverse() });
async function get() { return pub(await db.read()); }
async function set(p) {
  let check = null;
  if (p.token !== undefined && String(p.token).trim()) {
    const token = String(p.token).trim();
    const r = await tg(token, 'getMe', {}).catch((e) => ({ ok: false, description: e.message }));
    if (!r.ok) throw new Error('Telegram не принял токен: ' + (r.description || 'нет связи с api.telegram.org'));
    check = { id: r.result.id, username: r.result.username, name: r.result.first_name };
    await tg(token, 'deleteWebhook', {}).catch(() => {});
  }
  const s = await db.update((d) => {
    if (check) { d.token = String(p.token).trim(); d.bot = check; d.offset = 0; d.lastError = ''; }
    if (p.token !== undefined && !String(p.token).trim() && p.clearToken) { d.token = ''; d.bot = null; d.enabled = false; }
    if (p.enabled !== undefined) d.enabled = !!p.enabled && !!d.token;
    if (p.channels !== undefined) d.channels = !!p.channels;
    if (Array.isArray(p.allowed)) d.allowed = p.allowed.map((x) => String(x).trim()).filter((x) => /^-?\d{3,15}$/.test(x)).slice(0, 100);
    return d;
  });
  if (wakeUp) wakeUp();
  return pub(s);
}
const fmtNow = () => new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
async function reply(token, chatId, text) { try { await tg(token, 'sendMessage', { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }); } catch (e) {} }
async function addRecord(s, text, by) {
  const r = await bl.appendRecord(s.fileId, text);
  await db.update((d) => { d.fileId = r.fileId; d.added = (d.added || 0) + 1; d.recent = (d.recent || []).concat([{ by: by.name, byId: by.id, text: text.slice(0, 300), full: text.slice(0, 8000), at: new Date().toISOString() }]).slice(-50); });
  return r;
}
async function handle(s, u) {
  const post = u.channel_post || u.edited_channel_post;
  if (post) {
    if (s.channels === false) return;
    const text = (post.text || post.caption || '').trim(); if (!text) return;
    await addRecord(s, text, { id: String(post.chat.id), name: 'Канал «' + (post.chat.title || '') + '»' });
    return;
  }
  const m = u.message; if (!m || !m.chat || m.chat.type !== 'private') return;
  const uid = String(m.from.id); const allowed = (s.allowed || []).includes(uid);
  const who = [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || m.from.username || uid;
  const text = (m.text || m.caption || '').trim();
  const cmd = /^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/.exec(text);
  if (cmd) {
    const c = cmd[1].toLowerCase(), arg = cmd[2].trim();
    if (c === 'start' || c === 'help' || c === 'id') return reply(s.token, m.chat.id, `🛡 Бот базы «Проверка клиента» XCAR\n\nВаш ID: ${uid}\n${allowed ? '✅ Вам разрешено добавлять записи.\n\nОтправьте или перешлите сюда сообщение — оно станет карточкой в базе.\n/find текст — поиск по базе\n/count — сколько записей\n/undo — удалить вашу последнюю запись' : '🔒 Добавлять записи нельзя. Передайте ваш ID администратору: XCAR CONTROL → Проверка клиента → Telegram-бот → «Кому можно писать».'}`);
    if (!allowed) return reply(s.token, m.chat.id, `🔒 Нет доступа. Ваш ID: ${uid}`);
    if (c === 'count') { const i = await bl.info(); return reply(s.token, m.chat.id, `📚 В базе ${i.total} записей в ${i.files.length} файлах.\nОбновлена: ${i.updatedAt ? new Date(i.updatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—'}`); }
    if (c === 'find') {
      if (arg.length < 2) return reply(s.token, m.chat.id, 'Напишите: /find Иванов или /find 79001234567');
      const r = await bl.search(arg, []);
      if (!r.length) return reply(s.token, m.chat.id, '✅ Совпадений не найдено.');
      return reply(s.token, m.chat.id, `⛔ Найдено: ${r.length}\n\n` + r.slice(0, 5).map((x, i) => `${i + 1}. ${x.text.slice(0, 600)}`).join('\n\n———\n\n'));
    }
    if (c === 'undo') {
      const last = [...(s.recent || [])].reverse().find((x) => x.byId === uid);
      if (!last || !(await bl.removeRecord(s.fileId, last.full || last.text))) return reply(s.token, m.chat.id, 'Нечего удалять.');
      await db.update((d) => { const i = d.recent.lastIndexOf(d.recent.slice().reverse().find((x) => x.byId === uid)); if (i >= 0) d.recent.splice(i, 1); });
      return reply(s.token, m.chat.id, '🗑 Последняя запись удалена из базы.');
    }
    return reply(s.token, m.chat.id, 'Неизвестная команда. /help — справка');
  }
  if (!allowed) return reply(s.token, m.chat.id, `🔒 Добавлять записи может только администратор.\nВаш ID: ${uid} — передайте его администратору XCAR.`);
  if (!text) return reply(s.token, m.chat.id, 'Пришлите текст (можно фото с подписью) — без текста запись не создаётся.');
  const fwd = m.forward_from_chat ? '\n(переслано из «' + (m.forward_from_chat.title || '') + '»)' : m.forward_from ? '\n(переслано от ' + [m.forward_from.first_name, m.forward_from.last_name].filter(Boolean).join(' ') + ')' : '';
  const r = await addRecord(s, text, { id: uid, name: who });
  return reply(s.token, m.chat.id, `✅ Добавлено в базу «Проверка клиента» — ${fmtNow()}${fwd}\nЗаписей в файле бота: ${r.entries}\n/undo — отменить`);
}
async function loop() {
  for (;;) {
    const s = await db.read();
    if (!s.enabled || !s.token) { await sleep(15000); continue; }
    try {
      const r = await tg(s.token, 'getUpdates', { offset: s.offset || 0, timeout: 25, allowed_updates: ['message', 'channel_post', 'edited_channel_post'] }, 35000);
      if (!r.ok) { await db.update((d) => { d.lastError = r.description || 'Ошибка Telegram'; }); await sleep(20000); continue; }
      await db.update((d) => { d.lastOkAt = new Date().toISOString(); d.lastError = ''; });
      for (const u of r.result || []) {
        try { await handle(await db.read(), u); } catch (e) { console.error('Telegram-бот:', e.message); }
        await db.update((d) => { d.offset = u.update_id + 1; });
      }
    } catch (e) {
      await db.update((d) => { d.lastError = 'Нет связи с Telegram: ' + e.message; });
      await sleep(20000);
    }
  }
}
function start() { if (started) return; started = true; loop().catch((e) => console.error('Telegram-бот остановлен:', e.message)); }
module.exports = { get, set, start };
