// База «Проверка клиента» (Telegram-база): загрузка TXT / HTML / JSON-файлов
// (несколько сразу, в т.ч. экспорт чатов Telegram), разбиение на записи-карточки,
// поиск по содержимому (ФИО, телефон, любая информация). Файлы можно править,
// удалять и пополнять через Telegram-бота. Приложения получают базу с сервера.
//   data/blacklist/index.json — { files:[meta], updatedAt, settings:{ split, cardMode } }
//   data/blacklist/<id>.json  — { entries:[{title, text, date}] }
//   data/blacklist/<id>.raw   — исходный текст файла (для правки и пересборки)
// split: { mode:'auto'|'markers'|'line', start:'', end:'' }
//   auto    — пустая строка / сообщение Telegram = одна карточка
//   markers — карточка начинается со строки с текстом «start» и заканчивается строкой с «end»
//   line    — одна строка = одна карточка
// cardMode: 'whole' — показывать карточку целиком, 'fromMatch' — от совпадения до конца записи
const fs = require('fs');
const crypto = require('crypto');
const { jsonFile, dataPath, ensureDir, readJsonSafe, writeJsonAtomic } = require('./jsonfile');

const DEF_SETTINGS = () => ({ split: { mode: 'auto', start: '', end: '' }, cardMode: 'whole' });
const idx = jsonFile('blacklist/index.json', () => ({ files: [], updatedAt: null, settings: DEF_SETTINGS() }));
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
  for (const l of lines.slice(0, 4)) { const m = NAME_RE.exec(l); if (m) return m[1]; }
  return (lines[0] || 'Запись').replace(/^[\d.)\-\s№#]+/, '').slice(0, 80) || 'Запись';
}
const mkEntry = (t, date) => ({ title: titleOf(t), text: t.slice(0, 8000), date: date || undefined });
function splitAuto(text) {
  const clean = text.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  let parts = clean.split(/\n\s*(?:[-=_*]{3,})?\s*\n|\n[-=_*]{3,}\n/).map((x) => x.trim()).filter(Boolean);
  // файл «одна строка — одна запись»
  if (parts.length === 1 && clean.split('\n').length > 3) parts = clean.split('\n').map((x) => x.trim()).filter((x) => x.length > 3);
  return parts;
}
function splitEntries(text) { return splitAuto(text).slice(0, 50000).map((p) => mkEntry(p)); }
// карточки по маркерам начала / конца
function splitMarkers(text, start, end) {
  const sm = String(start || '').trim().toLowerCase(), em = String(end || '').trim().toLowerCase();
  if (!sm && !em) return splitAuto(text);
  const out = []; let cur = sm ? null : [];
  const push = () => { if (cur) { const t = cur.join('\n').trim(); if (t) out.push(t); } };
  for (const line of text.split('\n')) {
    const l = line.toLowerCase(); const lt = l.trim();
    if (sm && l.includes(sm)) { push(); cur = lt === sm ? [] : [line]; if (em && lt !== sm && l.indexOf(em) > l.indexOf(sm)) { push(); cur = null; } continue; }
    if (cur === null) continue; // текст вне карточек (до первого маркера начала)
    if (em && l.includes(em)) { if (lt !== em) cur.push(line); push(); cur = sm ? null : []; continue; }
    cur.push(line);
  }
  push();
  return out;
}
// экспорт Telegram (HTML: messages*.html, JSON: result.json) → сообщения
function tgHtmlMessages(html) {
  if (!/class="message default/.test(html)) return null;
  const out = [];
  html.split(/<div class="message default[^"]*"[^>]*>/).slice(1).forEach((p) => {
    const date = (/class="pull_right date details" title="([^"]+)"/.exec(p) || [])[1] || '';
    const tm = /<div class="text">([\s\S]*?)<\/div>/.exec(p);
    const t = tm ? htmlToText(tm[1]).replace(/\n{3,}/g, '\n\n').trim() : '';
    if (t) out.push({ text: t, date: date.replace(/\s*UTC.*$/, '') });
  });
  return out;
}
function tgJsonMessages(raw) {
  let j; try { j = JSON.parse(raw); } catch (e) { return null; }
  const list = Array.isArray(j.messages) ? j.messages : (j.chats && Array.isArray(j.chats.list) ? j.chats.list.flatMap((c) => c.messages || []) : null);
  if (!list) return null;
  const txt = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : (x && x.text) || '')).join('') : String(v || ''));
  return list.map((m) => ({ text: txt(m.text).trim(), date: m.date ? new Date(m.date).toLocaleString('ru-RU') : '' })).filter((m) => m.text);
}
function detectFormat(name, raw) {
  if (/\.json$/i.test(name || '') || /^\s*\{[\s\S]*"messages"\s*:/.test(raw.slice(0, 20000))) { const m = tgJsonMessages(raw); if (m) return { format: 'Telegram JSON', messages: m }; }
  const isHtml = /\.html?$/i.test(name || '') || /<(html|body|table|p|div|br)\b/i.test(raw.slice(0, 5000));
  if (isHtml) { const m = tgHtmlMessages(raw); if (m) return { format: 'Telegram HTML', messages: m }; return { format: 'HTML', text: htmlToText(raw) }; }
  return { format: 'TXT', text: raw.replace(/\r/g, '') };
}
function buildEntries(name, raw, split) {
  split = split || { mode: 'auto' };
  const f = detectFormat(name, raw);
  let entries;
  if (f.messages && split.mode === 'auto') entries = f.messages.map((m) => mkEntry(m.text, m.date));
  else {
    const text = f.messages ? f.messages.map((m) => m.text).join('\n\n') : f.text;
    const parts = split.mode === 'markers' ? splitMarkers(text, split.start, split.end)
      : split.mode === 'line' ? text.split('\n').map((x) => x.trim()).filter((x) => x.length > 3) : splitAuto(text);
    entries = parts.map((p) => mkEntry(p));
  }
  return { format: f.format, entries: entries.slice(0, 50000) };
}
const normSplit = (s) => {
  if (!s || typeof s !== 'object') return null;
  const mode = ['auto', 'markers', 'line'].includes(s.mode) ? s.mode : 'auto';
  return { mode, start: String(s.start || '').slice(0, 200), end: String(s.end || '').slice(0, 200) };
};
async function settings() { const d = await idx.read(); return Object.assign(DEF_SETTINGS(), d.settings || {}); }
function rawPath(id) { return dataPath('blacklist', id + '.raw'); }
function readRaw(f) {
  try { if (fs.existsSync(rawPath(f.id))) return fs.readFileSync(rawPath(f.id), 'utf8'); } catch (e) {}
  // старые файлы без исходника — собираем из записей
  const x = readJsonSafe(dataPath('blacklist', f.id + '.json'), { entries: [] });
  return x.entries.map((e) => e.text).join('\n\n');
}
function decodeUpload({ content, dataUrl }) {
  let raw = content;
  if (raw == null && dataUrl) { const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(dataUrl); if (!m) throw new Error('Неверный файл'); raw = m[1] ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2]); }
  return String(raw || '').replace(/^﻿/, '');
}
function writeFileData(id, raw, entries) {
  ensureDir(dataPath('blacklist'));
  fs.writeFileSync(rawPath(id), raw);
  writeJsonAtomic(dataPath('blacklist', id + '.json'), { entries });
}
async function addFile({ name, content, dataUrl, split, source, allowEmpty }) {
  const raw = decodeUpload({ content, dataUrl });
  if (!raw.trim() && !allowEmpty) throw new Error('Файл пустой');
  if (raw.length > 50 * 1024 * 1024) throw new Error('Файл больше 50 МБ');
  const sp = normSplit(split);
  const eff = sp || (await settings()).split;
  const b = buildEntries(name, raw, eff);
  if (!b.entries.length && !allowEmpty) throw new Error('В файле не найдено записей — проверьте разделитель карточек');
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  writeFileData(id, raw, b.entries);
  const meta = { id, name: String(name || 'файл').slice(0, 120), size: raw.length, entries: b.entries.length, uploadedAt: now, updatedAt: now, format: b.format, split: sp, source: source || 'upload' };
  await idx.update((d) => { d.files.push(meta); d.updatedAt = now; });
  memo = null;
  return meta;
}
async function getFile(id) {
  const d = await idx.read(); const f = d.files.find((x) => x.id === id); if (!f) return null;
  const raw = readRaw(f);
  const editable = /HTML|JSON/.test(f.format || '') ? readJsonSafe(dataPath('blacklist', id + '.json'), { entries: [] }).entries.map((e) => (e.date ? '[' + e.date + ']\n' : '') + e.text).join('\n\n-----\n\n') : raw;
  return { file: f, content: editable.length > 3 * 1024 * 1024 ? null : editable, tooBig: editable.length > 3 * 1024 * 1024 };
}
// правка: имя, текст, разделитель карточек
async function updateFile(id, { name, content, split }) {
  const d = await idx.read(); const f = d.files.find((x) => x.id === id); if (!f) return null;
  let raw = readRaw(f), fname = f.name;
  if (content != null) { raw = String(content).replace(/^﻿/, ''); if (/HTML|JSON/.test(f.format || '')) fname = f.name.replace(/\.(html?|json)$/i, '') + '.txt'; }
  const sp = split === undefined ? f.split : normSplit(split);
  const eff = sp || (await settings()).split;
  const b = buildEntries(content != null ? fname : f.name, raw, eff);
  writeFileData(id, raw, b.entries);
  const now = new Date().toISOString();
  const r = await idx.update((dd) => { const x = dd.files.find((y) => y.id === id); if (!x) return null;
    if (name) x.name = String(name).slice(0, 120);
    x.size = raw.length; x.entries = b.entries.length; x.format = b.format; x.split = sp; x.updatedAt = now; dd.updatedAt = now; return x; });
  memo = null; return r;
}
async function preview({ name, content, dataUrl, split, fileId }) {
  let raw, nm = name;
  if (fileId) { const d = await idx.read(); const f = d.files.find((x) => x.id === fileId); if (!f) throw new Error('Файл не найден'); raw = content != null ? String(content) : readRaw(f); nm = content != null ? 'x.txt' : f.name; }
  else raw = decodeUpload({ content, dataUrl });
  const eff = normSplit(split) || (await settings()).split;
  const b = buildEntries(nm, raw, eff);
  return { format: b.format, total: b.entries.length, sample: b.entries.slice(0, 6) };
}
async function setSettings(s) {
  const cur = await settings();
  const next = { split: s.split !== undefined ? (normSplit(s.split) || DEF_SETTINGS().split) : cur.split, cardMode: s.cardMode === 'fromMatch' ? 'fromMatch' : s.cardMode === 'whole' ? 'whole' : cur.cardMode };
  await idx.update((d) => { d.settings = next; });
  // файлы без своего разделителя пересобираем с новым общим
  if (s.split !== undefined) { const d = await idx.read(); for (const f of d.files.filter((x) => !x.split)) await updateFile(f.id, {}); }
  await idx.update((d) => { d.updatedAt = new Date().toISOString(); });
  memo = null; return next;
}
async function removeFile(id) {
  const ok = await idx.update((d) => { const n = d.files.length; d.files = d.files.filter((f) => f.id !== id); d.updatedAt = new Date().toISOString(); return n !== d.files.length; });
  try { fs.unlinkSync(dataPath('blacklist', id + '.json')); } catch (e) {}
  try { fs.unlinkSync(rawPath(id)); } catch (e) {}
  memo = null; return ok;
}
// добавить запись в файл (Telegram-бот); файл создаётся при необходимости
const BOT_SEP = '-----';
async function appendRecord(fileId, text, fileName) {
  text = String(text || '').trim(); if (!text) throw new Error('Пустая запись');
  let d = await idx.read(); let f = fileId && d.files.find((x) => x.id === fileId);
  if (!f) f = await addFile({ name: fileName || 'Telegram-бот.txt', content: '', allowEmpty: true, split: { mode: 'markers', start: '', end: BOT_SEP }, source: 'bot' });
  const raw = readRaw(f);
  const next = (raw.trim() ? raw.replace(/\s+$/, '') + '\n\n' : '') + text + '\n' + BOT_SEP + '\n';
  await updateFile(f.id, { content: next });
  d = await idx.read(); const nf = d.files.find((x) => x.id === f.id);
  return { fileId: f.id, entries: nf ? nf.entries : 0 };
}
async function removeRecord(fileId, text) {
  const d = await idx.read(); const f = d.files.find((x) => x.id === fileId); if (!f) return false;
  const raw = readRaw(f); const blk = String(text).trim() + '\n' + BOT_SEP + '\n';
  const i = raw.lastIndexOf(blk); if (i < 0) return false;
  await updateFile(fileId, { content: (raw.slice(0, i) + raw.slice(i + blk.length)).replace(/\n{3,}/g, '\n\n') });
  return true;
}
async function info() { const d = await idx.read(); return { files: d.files, updatedAt: d.updatedAt, total: d.files.reduce((s, f) => s + f.entries, 0), settings: Object.assign(DEF_SETTINGS(), d.settings || {}) }; }
async function allEntries() {
  if (memo) return memo;
  const d = await idx.read(); const out = [];
  d.files.forEach((f) => { const x = readJsonSafe(dataPath('blacklist', f.id + '.json'), { entries: [] }); x.entries.forEach((e, i) => out.push({ id: f.id + ':' + i, title: e.title, text: e.text, date: e.date, addedAt: f.updatedAt || f.uploadedAt })); });
  memo = out; return out;
}
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const digits = (s) => String(s || '').replace(/\D/g, '');
const isPhoneQ = (q) => { const qd = digits(q); return qd.length >= 6 && /^[\d\s()+\-]+$/.test(String(q).trim()); };
function matches(q, hay) {
  const nq = norm(q).trim(); if (!nq) return false;
  if (isPhoneQ(q)) return digits(hay).includes(digits(q).slice(-10));
  return nq.split(' ').filter(Boolean).every((tok) => norm(hay).includes(tok));
}
// «от совпадения до конца»: обрезаем запись до строки, где впервые встретился запрос
function fromMatch(q, text) {
  const lines = text.split('\n');
  const toks = isPhoneQ(q) ? [] : norm(q).trim().split(' ').filter(Boolean);
  const tail = digits(q).slice(-10);
  const i = lines.findIndex((l) => (tail && isPhoneQ(q) ? digits(l).includes(tail.slice(-7)) : toks.some((t) => norm(l).includes(t))));
  return i > 0 ? lines.slice(i).join('\n') : text;
}
async function search(q, appClients, opts) {
  const out = [];
  if (String(q || '').trim().length < 2) return out;
  const cardMode = (opts && opts.cardMode) || (await settings()).cardMode;
  // одна и та же запись может встречаться в нескольких загруженных файлах — показываем один раз
  const seen = new Set();
  for (const e of await allEntries()) {
    if (!matches(q, e.title + '\n' + e.text)) continue;
    const key = (e.title + '\n' + e.text).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue; seen.add(key);
    const text = cardMode === 'fromMatch' ? fromMatch(q, e.text) : e.text;
    out.push({ id: e.id, title: cardMode === 'fromMatch' && text !== e.text ? titleOf(text) : e.title, text, date: e.date, source: 'base', addedAt: e.addedAt });
    if (out.length >= 200) break;
  }
  (appClients || []).forEach((c) => {
    const hay = [c.name, c.phone, c.doc, c.licenseNum, c.notes, c.blacklistReason].filter(Boolean).join('\n');
    if (matches(q, hay)) out.push({ id: 'client:' + c.uid, title: c.name, text: [c.phone && 'Телефон: ' + c.phone, c.doc && 'Документ: ' + c.doc, c.licenseNum && 'ВУ: ' + c.licenseNum, c.blacklistReason && 'Причина: ' + c.blacklistReason, c.notes && 'Заметка: ' + c.notes, 'Отмечен «Чёрный список» у пользователя: ' + c.account].filter(Boolean).join('\n'), source: 'app', clientUid: c.uid });
  });
  return out;
}
module.exports = { addFile, removeFile, getFile, updateFile, preview, settings, setSettings, appendRecord, removeRecord, info, search, allEntries, htmlToText, splitEntries, BOT_SEP };
