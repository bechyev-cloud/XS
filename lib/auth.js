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
    console.log('JWT_SECRET не задан в .env — сгенерирован и сохранён в data/.jwt-secret');
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

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const payload = verifyToken(token);
    req.userId = payload.uid;
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
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Сессия администратора истекла, войдите снова' });
  }
}

module.exports = {
  hashPassword, comparePassword, signToken, verifyToken, authMiddleware,
  signAdminToken, adminAuthMiddleware
};
