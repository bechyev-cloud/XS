// Публичная страница «Статус автопарка» (https://сервер/park/<код>).
// Шаблон — lib/parkpage.html (стили и скрипт внутри), данные — /api/public/park/<код>.
const fs = require('fs');
const path = require('path');
let tpl = null;
function render(token) {
  if (!tpl || process.env.NODE_ENV === 'development') tpl = fs.readFileSync(path.join(__dirname, 'parkpage.html'), 'utf8');
  const t = /^[a-z0-9-]{0,48}$/.test(String(token || '')) ? String(token || '') : '';
  return tpl.replace('__TOKEN__', t);
}
module.exports = { render };
