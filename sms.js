// Отправка SMS через smsc.ru (используется для кода восстановления пароля
// по номеру телефона). Настройки — в /admin → Настройки (notify.sms).
// smsc.ru выбран как простой и популярный в РФ шлюз с HTTP API без
// дополнительных npm-зависимостей (обычный fetch); при желании можно
// заменить на другого провайдера, поменяв только этот файл.
// Пока логин/пароль smsc.ru не заданы, SMS не отправляется — код при этом
// выводится в лог сервера, чтобы можно было проверить восстановление
// пароля локально без реального SMS-шлюза.
async function sendResetSms(cfg, toPhone, code) {
  const sms = (cfg && cfg.notify && cfg.notify.sms) || {};
  if (!sms.login || !sms.password) {
    console.warn(`[sms] SMSC не настроен (/admin → Настройки) — SMS на ${toPhone} не отправлено. Код восстановления: ${code}`);
    return false;
  }
  try {
    const params = new URLSearchParams({
      login: sms.login,
      psw: sms.password,
      phones: toPhone,
      mes: `XCAR: код восстановления пароля ${code}`,
      fmt: '3' // JSON-ответ
    });
    if (sms.sender) params.set('sender', sms.sender);
    const res = await fetch('https://smsc.ru/sys/send.php?' + params.toString());
    const data = await res.json().catch(() => null);
    if (!data || data.error) {
      console.error('[sms] Ошибка отправки SMS через smsc.ru:', data && data.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[sms] Не удалось отправить SMS:', e.message);
    return false;
  }
}

module.exports = { sendResetSms };
