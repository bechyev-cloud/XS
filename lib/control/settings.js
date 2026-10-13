// Настройки самой панели XCAR CONTROL (название, логотип, язык, часовой пояс,
// список серверов для мониторинга, расписание бэкапов, уведомления, быстрые ответы).
const { jsonFile } = require('./jsonfile');

const DEFAULTS = () => ({
  general: { name: 'XCAR CONTROL', logo: '', language: 'ru', timezone: 'Europe/Moscow', currency: '₽' },
  notifications: { critical: true, important: true, info: true, success: true, sound: false },
  servers: [
    { id: 'primary', name: 'Основной', role: 'primary', url: '' },
    { id: 'backup', name: 'Backup', role: 'backup', url: '' },
    { id: 'dev', name: 'Development', role: 'dev', url: '' },
  ],
  backup: { auto: true, everyHours: 24, keep: 14 },
  // настройки пользовательского приложения, которыми управляет панель
  app: { hideServerSettings: false },
  quickReplies: [
    'Здравствуйте! Чем можем помочь?',
    'Спасибо за обращение, мы уже разбираемся.',
    'Оплата получена, подписка продлена. Спасибо!',
    'Пожалуйста, обновите приложение: Настройки → кнопка обновления вверху.',
  ],
});
const db = jsonFile('control-settings.json', DEFAULTS);

function merge(s) {
  const d = DEFAULTS();
  const out = Object.assign({}, d, s || {});
  out.general = Object.assign({}, d.general, (s && s.general) || {});
  out.notifications = Object.assign({}, d.notifications, (s && s.notifications) || {});
  out.backup = Object.assign({}, d.backup, (s && s.backup) || {});
  out.app = Object.assign({}, d.app, (s && s.app) || {});
  if (!Array.isArray(out.servers) || !out.servers.length) out.servers = d.servers;
  if (!Array.isArray(out.quickReplies)) out.quickReplies = d.quickReplies;
  return out;
}
async function get() { return merge(await db.read()); }
async function patch(section, value) {
  return db.update((s) => {
    const cur = merge(s);
    if (section === 'servers') {
      if (!Array.isArray(value)) throw new Error('Неверный список серверов');
      cur.servers = value.slice(0, 10).map((x, i) => ({
        id: String(x.id || 's' + i).slice(0, 40), name: String(x.name || 'Сервер').slice(0, 40),
        role: ['primary', 'backup', 'dev', 'other'].includes(x.role) ? x.role : 'other',
        url: String(x.url || '').trim().replace(/\/+$/, '').slice(0, 300),
      }));
    } else if (section === 'quickReplies') {
      cur.quickReplies = (Array.isArray(value) ? value : []).map((x) => String(x).slice(0, 500)).filter(Boolean).slice(0, 30);
    } else if (['general', 'notifications', 'backup', 'app'].includes(section)) {
      cur[section] = Object.assign({}, cur[section], value || {});
      if (section === 'backup') {
        cur.backup.everyHours = Math.min(168, Math.max(1, Number(cur.backup.everyHours) || 24));
        cur.backup.keep = Math.min(100, Math.max(1, Number(cur.backup.keep) || 14));
        cur.backup.auto = !!cur.backup.auto;
      }
      if (section === 'app') cur.app = { hideServerSettings: !!cur.app.hideServerSettings };
      if (section === 'general' && cur.general.logo && cur.general.logo.length > 400000) throw new Error('Логотип слишком большой (до 300 КБ)');
    } else throw new Error('Неизвестный раздел настроек');
    Object.keys(s).forEach((k) => delete s[k]); Object.assign(s, cur);
    return cur;
  });
}
module.exports = { get, patch };
