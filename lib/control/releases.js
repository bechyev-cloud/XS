// Установочные файлы приложения XCAR для Android (APK) и Windows (EXE).
// Администратор загружает их в XCAR CONTROL → Настройки → Application,
// приложения пользователей по кнопке «Обновить» скачивают и устанавливают их.
//   data/releases.json — { android:{version,name,size,sha256,notes,uploadedAt,by}, windows:{...} }
//   data/releases/android.apk, data/releases/windows.exe
const fs = require('fs');
const crypto = require('crypto');
const { jsonFile, dataPath, ensureDir } = require('./jsonfile');

const db = jsonFile('releases.json', () => ({}));
const EXT = { android: 'apk', windows: 'exe' };
const MIME = { android: 'application/vnd.android.package-archive', windows: 'application/vnd.microsoft.portable-executable' };
const MAX = 300 * 1024 * 1024;
const fileOf = (p) => dataPath('releases', p + '.' + EXT[p]);
function valid(p) { return Object.prototype.hasOwnProperty.call(EXT, p); }
async function info() {
  const d = await db.read(); const out = {};
  Object.keys(EXT).forEach((p) => { const r = d[p]; if (r && fs.existsSync(fileOf(p))) out[p] = r; });
  return out;
}
async function save(p, buf, meta) {
  if (!valid(p)) throw new Error('Неизвестная платформа');
  if (!buf || !buf.length) throw new Error('Пустой файл');
  if (buf.length > MAX) throw new Error('Файл больше 300 МБ');
  if (p === 'android' && !(buf[0] === 0x50 && buf[1] === 0x4b)) throw new Error('Это не APK-файл');
  if (p === 'windows' && !(buf[0] === 0x4d && buf[1] === 0x5a)) throw new Error('Это не EXE-файл Windows');
  const version = String(meta.version || '').trim().slice(0, 30);
  if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error('Укажите версию, например 3.1.8');
  ensureDir(dataPath('releases'));
  const tmp = fileOf(p) + '.tmp'; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, fileOf(p));
  const rec = { version, name: String(meta.name || ('XCAR.' + EXT[p])).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120), size: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), notes: String(meta.notes || '').slice(0, 2000), uploadedAt: new Date().toISOString(), by: String(meta.by || '').slice(0, 80) };
  await db.update((d) => { d[p] = rec; });
  return rec;
}
async function remove(p) { if (!valid(p)) return false; try { fs.unlinkSync(fileOf(p)); } catch (e) {} await db.update((d) => { delete d[p]; }); return true; }
module.exports = { info, save, remove, fileOf, valid, MIME };
