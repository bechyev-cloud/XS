#!/usr/bin/env bash
# Установка XCAR server на домашний компьютер с Ubuntu 22.04 / 24.04.
# Запуск:  cd ~/xcar-server && bash ubuntu-setup.sh
set -e
cd "$(dirname "$0")"

echo "==> 1/5 Node.js"
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1); fi
if [ "$NODE_MAJOR" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "==> 2/5 Зависимости"
npm install --omit=dev

echo "==> 3/5 Настройки (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  ADMIN_PASS=$(openssl rand -hex 10 2>/dev/null || date +%s%N | sha256sum | head -c 20)
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$ADMIN_PASS/" .env
  # Домашний сервер без reverse-proxy по умолчанию; через Cloudflare Tunnel — можно оставить true
  echo ""
  echo "   Пароль для панели /admin: $ADMIN_PASS  (сохраните его! он в файле .env)"
  echo ""
else
  echo "   .env уже есть — не трогаю"
fi
PORT=$(grep -E '^PORT=' .env | cut -d= -f2); PORT=${PORT:-8080}

if [ -f ../xcarapp/index.html ]; then echo "   Приложение найдено (../xcarapp) — сервер будет раздавать его по Wi-Fi"; else echo "   ВНИМАНИЕ: рядом нет папки xcarapp — по Wi-Fi будет работать только API. Скопируйте всю папку XCAR."; fi
if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q "Status: active"; then sudo ufw allow "$PORT"/tcp >/dev/null && echo "   Порт $PORT открыт в ufw"; fi

echo "==> 4/5 PM2 (автозапуск)"
if ! command -v pm2 >/dev/null 2>&1; then sudo npm install -g pm2; fi
pm2 describe xcar-server >/dev/null 2>&1 && pm2 restart xcar-server || pm2 start server.js --name xcar-server
pm2 save
sudo env PATH="$PATH:/usr/bin" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME" >/dev/null || true

echo "==> 5/5 Проверка"
sleep 2
if curl -fsS "http://localhost:$PORT/api/health"; then
  echo ""
  echo "Готово! Сервер работает на порту $PORT."
  echo ""
  echo "ДОМА ПО WI-FI — откройте на телефоне (тот же Wi-Fi):"
  for ip in $(hostname -I); do case "$ip" in *:*) ;; *) echo "   http://$ip:$PORT" ;; esac; done
  echo ""
  echo "ИЗ ЛЮБОГО МЕСТА — дайте серверу https-адрес (Cloudflare Tunnel):"
  echo "   cloudflared tunnel --url http://localhost:$PORT"
  echo "и вставьте полученный https://...trycloudflare.com в XCAR → Настройки → Серверы → Домашний Ubuntu."
else
  echo "Сервер не ответил. Посмотрите логи: pm2 logs xcar-server"
fi
