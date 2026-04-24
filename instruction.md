---
Деплой на чистый Linux сервер

Требования к серверу

Ubuntu 22.04+ / Debian 12+, минимум 1 CPU / 1GB RAM. Домен уже указывает на IP сервера (DNS A-запись).

---
1. Базовые пакеты

apt update && apt upgrade -y
apt install -y git python3.11 python3.11-venv python3-pip nodejs npm nginx mysql-server certbot python3-certbot-nginx

Проверьте версии:
python3.11 --version   # 3.11+
node --version         # 18+
mysql --version

---
2. MySQL — создать БД

mysql_secure_installation   # задайте пароль root
mysql -u root -p

CREATE DATABASE exchange_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'exchange'@'localhost' IDENTIFIED BY 'СИЛЬНЫЙ_ПАРОЛЬ';
GRANT ALL PRIVILEGES ON exchange_db.* TO 'exchange'@'localhost';
FLUSH PRIVILEGES;
EXIT;

---
3. Клонировать проект

cd /var/www
git clone https://github.com/ВАШ_РЕПОЗИТОРИЙ crypto-exchange
cd crypto-exchange

---
4. Бэкенд (Python / FastAPI)

cd /var/www/crypto-exchange/python_backend

# Виртуальное окружение
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

Создайте .env:
nano .env

DATABASE_URL=mysql+aiomysql://exchange:СИЛЬНЫЙ_ПАРОЛЬ@localhost:3306/exchange_db
JWT_SECRET=сгенерируйте_длинную_случайную_строку
AES_KEY_HEX=сгенерируйте_64_hex_символа

OPENAI_API_KEY=sk-...
ORDER_LOG_BOT_TOKEN=токен_бота_для_логов
OPERATOR_ALERT_BOT_TOKEN=токен_бота_алертов
MANAGER_ALERT_BOT_TOKEN=токен_бота_менеджеров
ACTIVATION_ALERT_BOT_TOKEN=токен_бота_активаций

BYBIT_API_BASE=https://api.bybit.com
KRAKEN_API_URL=https://api.kraken.com/0/public/Ticker
RAPIRA_API_URL=https://api.rapira.net/open/market/rates

PORT=8080
SLA_MINUTES=30
CRON_RATES=*/5 * * * *

Сгенерировать ключи:
# JWT_SECRET
python3 -c "import secrets; print(secrets.token_hex(32))"

# AES_KEY_HEX
python3 -c "import secrets; print(secrets.token_hex(32))"

Запустить миграции БД (SQL-файлы из папки python_backend):
mysql -u exchange -p exchange_db < migration_cashier.sql
mysql -u exchange -p exchange_db < migration_cashier_deposit.sql
# и остальные migration_*.sql файлы

Проверить что бэкенд запускается:
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8080
# Ctrl+C если всё ОК

---
5. Фронтенд (React / Vite)

cd /var/www/crypto-exchange/frontend
npm install

Создайте .env.production:
nano .env.production

VITE_API_URL=https://ВАШ_ДОМЕН/api
VITE_SOCKET_URL=https://ВАШ_ДОМЕН

Проверьте что в src/services/api.js базовый URL читается из переменной окружения. Если нет — найдите строку с baseURL и замените
на:
baseURL: import.meta.env.VITE_API_URL || '/api',

Собрать фронтенд:
npm run build
# Результат в папке dist/

---
6. Nginx — связать домен с сайтом

nano /etc/nginx/sites-available/crypto-exchange

server {
    listen 80;
    server_name ВАШ_ДОМЕН www.ВАШ_ДОМЕН;

    # Фронтенд (статика)
    root /var/www/crypto-exchange/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Бэкенд API
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
    }

    # Socket.IO
    location /socket.io/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # Загрузки (чеки и т.д.)
    location /uploads/ {
        proxy_pass http://127.0.0.1:8080;
    }
}

ln -s /etc/nginx/sites-available/crypto-exchange /etc/nginx/sites-enabled/
nginx -t          # проверка конфига
systemctl reload nginx

---
7. SSL (HTTPS) — Let's Encrypt

certbot --nginx -d ВАШ_ДОМЕН -d www.ВАШ_ДОМЕН
# Выбрать "2" — redirect HTTP→HTTPS

После этого certbot сам обновит nginx конфиг и добавит SSL. Автообновление уже настроено в системе.

---
8. Systemd — бэкенд как сервис (автозапуск)

nano /etc/systemd/system/crypto-backend.service

[Unit]
Description=Crypto Exchange Backend
After=network.target mysql.service

[Service]
User=www-data
WorkingDirectory=/var/www/crypto-exchange/python_backend
EnvironmentFile=/var/www/crypto-exchange/python_backend/.env
ExecStart=/var/www/crypto-exchange/python_backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers 1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target

chown -R www-data:www-data /var/www/crypto-exchange
systemctl daemon-reload
systemctl enable crypto-backend
systemctl start crypto-backend
systemctl status crypto-backend   # должен быть active (running)

---
9. Проверка

# Логи бэкенда
journalctl -u crypto-backend -f

# Проверить API
curl https://ВАШ_ДОМЕН/api/health   # или любой публичный endpoint

# Статус nginx
systemctl status nginx

Откройте браузер: https://ВАШ_ДОМЕН — должен открыться фронтенд.

---
Частые проблемы

┌──────────────────────────┬────────────────────────────────────────────────────────────────┐
│         Проблема         │                            Решение                             │
├──────────────────────────┼────────────────────────────────────────────────────────────────┤
│ 502 Bad Gateway          │ Бэкенд не запущен: systemctl status crypto-backend             │
├──────────────────────────┼────────────────────────────────────────────────────────────────┤
│ Белый экран фронтенда    │ Проверьте VITE_API_URL в .env.production и пересоберите        │
├──────────────────────────┼────────────────────────────────────────────────────────────────┤
│ Бот не запускается       │ Проверьте токены в .env, смотрите journalctl -u crypto-backend │
├──────────────────────────┼────────────────────────────────────────────────────────────────┤
│ MySQL connection refused │ systemctl start mysql                                          │
├──────────────────────────┼────────────────────────────────────────────────────────────────┤
│ Порт 8080 занят          │ lsof -i :8080, убить процесс                                   │
└──────────────────────────┴────────────────────────────────────────────────────────────────┘

Обновление кода

cd /var/www/crypto-exchange
git pull

# Если изменился бэкенд:
systemctl restart crypto-backend

# Если изменился фронтенд:
cd frontend && npm run build
