// База «Чёрный список»: загрузка TXT/HTML-файлов (несколько сразу), разбиение
// на записи, поиск по содержимому (ФИО, телефон, любая информация).
// Дополнительно в поиск попадают клиенты, отмеченные «Чёрный список» в
// приложениях пользователей XCAR.
//   data/blacklist/index.json — { files:[{id,name,size,entries,uploadedAt}], updatedAt }
//   data/blacklist/<id>.json  — { entries:[{title, text}] }
const fs = require('fs');
const crypto = require('crypto');
const { jsonFile, dataPath, ensureDir, readJsonSafe, writeJsonAtomic } = require('./jsonfile');

const idx = jsonFile('blacklist/index.json', () => ({ files: [], updatedAt: null }));
let memo = null; // кэш записей всех файлов

function decodeEntities(s) {
  const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', numero: '№' };
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return map[e.toLowerCase()] != null ? map[e.toLowerCase()] : m;
  });
}
function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section|article|table|blockquote)>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<hr[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]*\|[ \t]*$/gm, '').replace(/[ \t]{2,}/g, ' ').replace(/\r/g, '');
}
const NAME_RE = /([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/;
function titleOf(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of lines.slice(0, 3)) { const m = NAME_RE.exec(l); if (m) return m[1]; }
  return (lines[0] || 'Запись').replace(/^[\d.)\-\s№#]+/, '').slice(0, 80) || 'Запись';
}
function splitEntries(text) {
  const clean = text.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  let parts = clean.split(/\n\s*(?:[-=_*]{3,})?\s*\n|\n[-=_*]{3,}\n/).map((x) => x.trim()).filter(Boolean);
  // файл «одна строка — одна запись»
  if (parts.length === 1 && clean.split('\n').length > 3) parts = clean.split('\n').map((x) => x.trim()).filter((x) => x.length > 3);
  return parts.slice(0, 50000).map((p) => ({ title: titleOf(p), text: p.slice(0, 4000) }));
}
async function addFile({ name, content, dataUrl }) {
  let raw = content;
  if (raw == null && dataUrl) { const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(dataUrl); if (!m) throw new Error('Неверный файл'); raw = m[1] ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2]); }
  raw = String(raw || '');
  if (!raw.trim()) throw new Error('Файл пустой');
  if (raw.length > 20 * 1024 * 1024) throw new Error('Файл больше 20 МБ');
  const isHtml = /\.html?$/i.test(name || '') || /<(html|body|table|p|div|br)\b/i.test(raw.slice(0, 5000));
  const text = isHtml ? htmlToText(raw) : raw.replace(/\r/g, '');
  const entries = splitEntries(text);
  if (!entries.length) throw new Error('В файле не найдено записей');
  const id = crypto.randomUUID();
  ensureDir(dataPath('blacklist'));
  writeJsonAtomic(dataPath('blacklist', id + '.json'), { entries });
  const meta = { id, name: String(name || 'файл').slice(0, 120), size: raw.length, entries: entries.length, uploadedAt: new Date().toISOString(), format: isHtml ? 'HTML' : 'TXT' };
  await idx.update((d) => { d.files.push(meta); d.updatedAt = meta.uploadedAt; });
  memo = null;
  return meta;
}
async function removeFile(id) {
  const ok = await idx.update((d) => { const n = d.files.length; d.files = d.files.filter((f) => f.id !== id); d.updatedAt = new Date().toISOString(); return n !== d.files.length; });
  try { fs.unlinkSync(dataPath('blacklist', id + '.json')); } catch (e) {}
  memo = null; return ok;
}
async function info() { const d = await idx.read(); return { files: d.files, updatedAt: d.updatedAt, total: d.files.reduce((s, f) => s + f.entries, 0) }; }
async function allEntries() {
  if (memo) return memo;
  const d = await idx.read(); const out = [];
  d.files.forEach((f) => { const x = readJsonSafe(dataPath('blacklist', f.id + '.json'), { entries: [] }); x.entries.forEach((e, i) => out.push({ id: f.id + ':' + i, title: e.title, text: e.text, addedAt: f.uploadedAt })); });
  memo = out; return out;
}
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const digits = (s) => String(s || '').replace(/\D/g, '');
function matches(q, hay) {
  const nq = norm(q).trim(); if (!nq) return false;
  const h = norm(hay);
  const qd = digits(q);
  if (qd.length >= 6 && qd.length >= nq.replace(/[^0-9]/g, '').length && /^[\d\s()+\-]+$/.test(q.trim())) {
    const hd = digits(hay); const tail = qd.slice(-10);
    return hd.includes(tail);
  }
  return nq.split(' ').filter(Boolean).every((tok) => h.includes(tok));
}
async function search(q, appClients) {
  const out = [];
  if (String(q || '').trim().length < 2) return out;
  // одна и та же запись может встречаться в нескольких загруженных файлах — показываем один раз
  const seen = new Set();
  for (const e of await allEntries()) {
    if (!matches(q, e.title + '\n' + e.text)) continue;
    const key = (e.title + '\n' + e.text).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue; seen.add(key);
    out.push({ id: e.id, title: e.title, text: e.text, source: 'base', addedAt: e.addedAt });
    if (out.length >= 200) break;
  }
  (appClients || []).forEach((c) => {
    const hay = [c.name, c.phone, c.doc, c.licenseNum, c.notes].filter(Boolean).join('\n');
    if (matches(q, hay)) out.push({ id: 'client:' + c.uid, title: c.name, text: [c.phone && 'Телефон: ' + c.phone, c.doc && 'Документ: ' + c.doc, c.licenseNum && 'ВУ: ' + c.licenseNum, c.notes && 'Заметка: ' + c.notes, 'Отмечен «Чёрный список» у пользователя: ' + c.account].filter(Boolean).join('\n'), source: 'app', clientUid: c.uid });
  });
  return out;
}
module.exports = { addFile, removeFile, info, search, htmlToText, splitEntries };
