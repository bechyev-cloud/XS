// Отправка писем по SMTP (используется для кода восстановления пароля).
// Настройки — в /admin → Настройки (server/lib/config.js, notify.smtp).
// Пока SMTP не настроен, письмо просто не отправляется — код при этом
// всё равно выводится в лог сервера, чтобы разработчик мог проверить
// восстановление пароля локально без настоящей почты.
const nodemailer = require('nodemailer');

let cachedTransport = null;
let cachedKey = null;

function getTransport(smtp) {
  const key = JSON.stringify(smtp);
  if (cachedTransport && cachedKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: !!smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
  });
  cachedKey = key;
  return cachedTransport;
}

// Возвращает true, если письмо реально отправлено (SMTP настроен и запрос
// не упал). false — если SMTP не настроен или отправка не удалась (в обоих
// случаях вызывающий код всё равно должен ответить клиенту одинаково,
// чтобы не палить, существует ли такой e-mail в базе).
async function sendResetEmail(cfg, toEmail, code) {
  const smtp = (cfg && cfg.notify && cfg.notify.smtp) || {};
  if (!smtp.host || !smtp.user) {
    console.warn(`[mailer] SMTP не настроен (/admin → Настройки) — письмо на ${toEmail} не отправлено. Код восстановления: ${code}`);
    return false;
  }
  try {
    const transport = getTransport(smtp);
    await transport.sendMail({
      from: smtp.from || smtp.user,
      to: toEmail,
      subject: 'Код для восстановления пароля XCAR',
      text: `Код для восстановления пароля: ${code}\n\nКод действует 15 минут. Если вы не запрашивали восстановление пароля — просто проигнорируйте это письмо.`
    });
    return true;
  } catch (e) {
    console.error('[mailer] Не удалось отправить письмо:', e.message);
    return false;
  }
}

module.exports = { sendResetEmail };
