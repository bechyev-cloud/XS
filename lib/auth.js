const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const SECRET_FILE = path.join(__dirname, '..', 'data', '.jwt-secret');
const TOKEN_TTL = '30d';

function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
    return process.env.JWT_SECRET.trim();
  }
  try {
    if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch (e) {
    // игнорируем — сгенерируем новый ниже
  }
  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, generated);
    console.log('JWT_SECRET не задан (Environment / server.env) — сгенерирован и сохранён в data/.jwt-secret');
  } catch (e) {
    console.warn('Не удалось сохранить сгенерированный JWT_SECRET на диск:', e.message);
  }
  return generated;
}

const JWT_SECRET = getJwtSecret();
const ADMIN_TOKEN_TTL = '12h'; // админ-сессия короче обычной — панель мощная, лишний риск ни к чему

function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}
function comparePassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}
function signToken(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
function signAdminToken() {
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: ADMIN_TOKEN_TTL });
}

// Раздел 20: проверка req.userId сделана async и дополнительно смотрит в
// users.json — раньше middleware только проверял подпись JWT и никогда не
// трогал диск, поэтому у администратора не было способа "выключить" уже
// выданный токен раньше, чем истекут его 30 дней. Теперь при каждом
// запросе (после проверки подписи) читаем актуальную запись пользователя и
// отклоняем её, если администратор пометил аккаунт заблокированным —
// именно так блокировка "заблокировать приложение клиента" вступает в силу
// сразу, а не только для новых входов.
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const payload = verifyToken(token);
    const { getUserLite } = require('./store');
    const user = await getUserLite(payload.uid);
    if (!user) return res.status(401).json({ error: 'Аккаунт не найден' });
    if (user.blocked) {
      return res.status(403).json({ error: 'Ваш аккаунт заблокирован администратором', blocked: true });
    }
    req.userId = payload.uid;
    try { require('./control/messages').touchPresence(payload.uid); } catch (e) {}
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Сессия истекла, войдите снова' });
  }
}

// Отдельный middleware для панели администратора: токен должен быть подписан
// именно как admin-токен (signAdminToken), обычный пользовательский токен сюда не подходит.
function adminAuthMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация администратора' });
  try {
    const payload = verifyToken(token);
    // Старая панель /admin (role:'admin') или XCAR CONTROL с ролью Owner/Admin
    // (payload.ctl). Роли ниже (Manager, Finance…) работают только через
    // /api/control, где права проверяются по каждому действию.
    const legacy = payload.role === 'admin' && !payload.ctl;
    const control = payload.ctl && (payload.role === 'owner' || payload.role === 'admin');
    if (!legacy && !control) return res.status(403).json({ error: 'Недостаточно прав' });
    req.adminInfo = { name: control ? (payload.aid === 'owner' ? 'Владелец' : payload.aid) : 'Admin (старая панель)', role: payload.role };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Сессия администратора истекла, войдите снова' });
  }
}

function JWT_SECRET_FOR_CONTROL() { return JWT_SECRET; }

module.exports = {
  JWT_SECRET_FOR_CONTROL,
  hashPassword, comparePassword, signToken, verifyToken, authMiddleware,
  signAdminToken, adminAuthMiddleware
};
