// Доступ к базе Telegram в «Проверке клиента»: пользователь приложения подаёт
// заявку (ФИО, телефоны, фото прав и паспорта), администратор в XCAR CONTROL
// проверяет её и открывает доступ. Только после одобрения поиск и просмотр
// базы Telegram работают для этого аккаунта.
//   data/tg-access.json — { req: { uid: { status, fio, phone, wa, tg, files:[{i,name,kind,type,size}], createdAt, decidedAt, decidedBy, note } } }
//   data/tg-access/<uid>-<i>.bin — сами файлы
const fs = require('fs');
const { jsonFile, dataPath, ensureDir } = require('./jsonfile');

const db = jsonFile('tg-access.json', () => ({ req: {} }));
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const MAX_FILE = 8 * 1024 * 1024;

async function get(uid) { const d = await db.read(); return (d.req || {})[uid] || null; }
function pub(r) { if (!r) return { status: 'none' }; const o = Object.assign({}, r); o.files = (r.files || []).map((f) => ({ i: f.i, name: f.name, kind: f.kind, type: f.type, size: f.size })); return o; }
async function submit(uid, body) {
  const fio = s(body.fio, 160), phone = s(body.phone, 40), wa = s(body.wa, 40), tg = s(body.tg, 60);
  if (fio.length < 5) throw new Error('Укажите фамилию, имя и отчество');
  if (phone.replace(/\D/g, '').length < 7) throw new Error('Укажите номер телефона');
  const cur = await get(uid);
  if (cur && cur.status === 'approved') throw new Error('Доступ уже открыт');
  ensureDir(dataPath('tg-access'));
  const files = [];
  (Array.isArray(body.files) ? body.files : []).slice(0, 6).forEach((f, i) => {
    const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(f.dataUrl || '')); if (!m) return;
    const buf = Buffer.from(m[2], 'base64'); if (!buf.length || buf.length > MAX_FILE) throw new Error('Файл слишком большой (до 8 МБ)');
    if (!/^(image\/|application\/pdf)/.test(m[1])) throw new Error('Можно прикрепить фото или PDF');
    fs.writeFileSync(dataPath('tg-access', uid + '-' + i + '.bin'), buf);
    files.push({ i, name: s(f.name, 120) || ('файл ' + (i + 1)), kind: f.kind === 'license' ? 'license' : f.kind === 'passport' ? 'passport' : 'other', type: m[1], size: buf.length });
  });
  if (!files.length) throw new Error('Прикрепите фото прав или паспорта');
  return db.update((d) => { d.req = d.req || {}; d.req[uid] = { status: 'pending', fio, phone, wa, tg, files, createdAt: new Date().toISOString() }; return pub(d.req[uid]); });
}
async function decide(uid, action, adminName, note) {
  return db.update((d) => {
    const r = (d.req || {})[uid]; if (!r) throw new Error('Заявка не найдена');
    r.status = action === 'approve' ? 'approved' : action === 'revoke' ? 'revoked' : 'rejected';
    r.decidedAt = new Date().toISOString(); r.decidedBy = s(adminName, 80); r.note = s(note, 500);
    return pub(r);
  });
}
async function list() { const d = await db.read(); return Object.entries(d.req || {}).map(([uid, r]) => Object.assign({ uid }, pub(r))).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || String(b.createdAt).localeCompare(String(a.createdAt))); }
async function file(uid, i) { const r = await get(uid); const f = r && (r.files || []).find((x) => String(x.i) === String(i)); if (!f) return null; const p = dataPath('tg-access', uid + '-' + f.i + '.bin'); return fs.existsSync(p) ? { path: p, meta: f } : null; }
async function approved(uid) { const r = await get(uid); return !!(r && r.status === 'approved'); }
module.exports = { get: async (uid) => pub(await get(uid)), submit, decide, list, file, approved };
