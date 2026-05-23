# Server Setup Guide

Panduan ini dipakai untuk setup `ducktivy` di VPS Ubuntu setelah repository sudah di-clone.

## 1. Masuk ke Folder Project

```bash
cd ~/ducktivy
```

Sesuaikan path di atas dengan lokasi clone di VPS.

## 2. Install Dependency Sistem

Gunakan Node.js 20+ atau 22+.

```bash
sudo apt update
sudo apt install -y curl git nginx
```

Install Node.js via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Cek versi:

```bash
node -v
npm -v
```

## 3. Install Dependency Project

```bash
npm ci
```

Jika `npm ci` gagal karena lockfile berbeda, gunakan:

```bash
npm install
```

## 4. Buat File Environment

```bash
cp .env.example .env
nano .env
```

Isi minimal:

```env
VITE_SUPABASE_URL=https://PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_DASHBOARD_API_URL=https://DOMAIN_KAMU

SUPABASE_URL=https://PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY

DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN
DISCORD_APPLICATION_ID=YOUR_DISCORD_APPLICATION_ID
DISCORD_PUBLIC_KEY=YOUR_DISCORD_PUBLIC_KEY
DISCORD_TEST_CHANNEL_ID=YOUR_DEFAULT_CHANNEL_ID
DISCORD_GUILD_ID=YOUR_DISCORD_SERVER_ID

REMINDER_WORKER_POLL_MS=30000
DASHBOARD_API_PORT=8787
DASHBOARD_ORIGIN=https://DOMAIN_KAMU
APP_TIME_ZONE=Asia/Jakarta
APP_TIME_ZONE_OFFSET_MINUTES=420
```

Catatan penting:

- Jangan commit file `.env`.
- `SUPABASE_SERVICE_ROLE_KEY` hanya boleh dipakai di server.
- `VITE_DASHBOARD_API_URL` harus mengarah ke domain dashboard, contoh `https://bot.domain.com`.
- Isi `DISCORD_GUILD_ID` saat testing agar slash command cepat muncul.
- `APP_TIME_ZONE_OFFSET_MINUTES=420` berarti UTC+7 atau WIB. Ini mencegah gap 7 jam saat VPS memakai timezone UTC.

## 5. Setup Database Supabase

Buka Supabase Dashboard, lalu masuk ke SQL Editor dan jalankan isi file:

```txt
supabase/migrations/001_initial_schema.sql
```

File ini membuat tabel:

- `reminders`
- `reminder_logs`

Karena aplikasi server memakai `SUPABASE_SERVICE_ROLE_KEY`, Row Level Security yang aktif tetap bisa dilewati dari proses server.

Jika database sudah pernah dibuat sebelum fitur snooze/reschedule, jalankan migration tambahan:

```txt
supabase/migrations/002_reschedule_actions.sql
```

## 6. Setup Supabase Auth Discord

Dashboard memakai Supabase Auth dengan Discord provider agar data reminder bersifat personal.

Di Discord Developer Portal:

1. Buka application yang sama dengan bot.
2. Masuk ke OAuth2.
3. Pada bagian Redirects, tambahkan redirect URL Supabase Auth.

```txt
https://PROJECT_ID.supabase.co/auth/v1/callback
```

Penting: yang dimasukkan ke Discord Redirects adalah URL callback Supabase, bukan domain dashboard. Jika Discord menampilkan `Invalid OAuth2 redirect_uri`, berarti URL callback ini belum ada, salah project ID, ada typo, atau beda trailing slash.

Di Supabase Dashboard:

1. Buka Authentication > Providers.
2. Enable Discord.
3. Isi Discord Client ID dan Client Secret.
4. Buka Authentication > URL Configuration.
5. Set Site URL ke domain dashboard:

```txt
https://DOMAIN_KAMU
```

6. Tambahkan Redirect URLs:

```txt
https://DOMAIN_KAMU
http://localhost:5173
```

Dashboard API akan membaca user dari token Supabase, lalu memakai Discord user ID dari identity Discord. Karena itu semua data dashboard otomatis difilter untuk user yang sedang login.

## 7. Register Discord Slash Commands

Pastikan `.env` sudah berisi:

```env
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=
```

Lalu jalankan:

```bash
npm run discord:register
```

Jika `DISCORD_GUILD_ID` diisi, command biasanya muncul cepat di server Discord. Jika tidak diisi, command global bisa butuh waktu lebih lama.

## 8. Test Bot dan Worker Manual

Test bot Discord:

```bash
npm run bot:dev
```

Di Discord, coba:

```txt
/remind test
```

Buka terminal kedua dan test worker:

```bash
npm run worker:dev
```

Kalau dua proses ini berjalan, hentikan dulu dengan `Ctrl+C`, lalu lanjut setup process manager.

## 9. Jalankan dengan PM2

Install PM2:

```bash
sudo npm install -g pm2
```

Jalankan proses server:

```bash
pm2 start scripts/local-discord-bot.mjs --name ducktivy-bot
pm2 start scripts/local-reminder-worker.mjs --name ducktivy-worker
pm2 start scripts/local-dashboard-api.mjs --name ducktivy-api
```

Cek status:

```bash
pm2 status
pm2 logs ducktivy-bot
pm2 logs ducktivy-worker
pm2 logs ducktivy-api
```

Aktifkan auto-start saat VPS reboot:

```bash
pm2 save
pm2 startup
```

PM2 akan menampilkan satu command `sudo ...`. Copy dan jalankan command tersebut.

## 10. Build Dashboard

Pastikan `VITE_DASHBOARD_API_URL` di `.env` sudah memakai domain public.

```bash
npm run build
```

Hasil build ada di:

```txt
dist/
```

## 11. Setup Nginx

Buat config Nginx:

```bash
sudo nano /etc/nginx/sites-available/ducktivy
```

Isi contoh config:

```nginx
server {
    listen 80;
    server_name domain.com;

    root /var/www/html/ducktivy/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Ganti:

- `DOMAIN_KAMU` dengan domain/subdomain VPS.
- `/home/USER/ducktivy/dist` dengan path asli project.

Aktifkan site:

```bash
sudo ln -s /etc/nginx/sites-available/ducktivy /etc/nginx/sites-enabled/ducktivy
sudo nginx -t
sudo systemctl reload nginx
```

## 12. Setup HTTPS

Install Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
```

Generate SSL:

```bash
sudo certbot --nginx -d domain.com
```

Setelah SSL aktif, update `.env`:

```env
VITE_DASHBOARD_API_URL=https://DOMAIN_KAMU
DASHBOARD_ORIGIN=https://DOMAIN_KAMU
```

Build ulang dashboard:

```bash
npm run build
```

Reload Nginx:

```bash
sudo systemctl reload nginx
```

Restart API:

```bash
pm2 restart ducktivy-api
```

## 13. Verifikasi Akhir

Cek proses:

```bash
pm2 status
```

Cek API:

```bash
curl https://domain.com/api/overview
```

Cek dashboard:

```txt
https://domain.com
```

Cek Discord:

```txt
/remind test
/remind add task:"Belajar Laravel 30 menit" date:"2026-05-23" time:"21:00"
/remind list
/remind snooze id:"REMINDER_ID" minutes:10
/remind reschedule id:"REMINDER_ID" date:"2026-05-24" time:"21:30"
```

## 14. Update Aplikasi

Saat ada perubahan baru dari Git:

```bash
cd ~/ducktivy
git pull
npm ci
npm run build
pm2 restart ducktivy-bot ducktivy-worker ducktivy-api
sudo systemctl reload nginx
```

## Troubleshooting

Jika slash command belum muncul:

```bash
npm run discord:register
```

Pastikan `DISCORD_GUILD_ID` benar untuk testing cepat.

Jika reminder tidak terkirim:

```bash
pm2 logs ducktivy-worker
```

Cek juga:

- `DISCORD_BOT_TOKEN` benar.
- Bot sudah masuk ke server Discord.
- Bot punya permission mengirim pesan di channel target.
- `DISCORD_TEST_CHANNEL_ID` atau `channel_id` reminder benar.

Jika dashboard tidak bisa load data:

```bash
pm2 logs ducktivy-api
curl http://127.0.0.1:8787/api/overview
```

Cek juga:

- `SUPABASE_URL` benar.
- `SUPABASE_SERVICE_ROLE_KEY` benar.
- Nginx proxy `/api/` mengarah ke port `8787`.
