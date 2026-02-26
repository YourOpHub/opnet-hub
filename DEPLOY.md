# Deploy OPNet Hub to VPS + Cloudflare

## vibecode.finance/apps/ и свой сайт

На vibecode в сабмите ты указываешь **Live URL** — адрес, где открывается твоё приложение. Они не хостят твой фронт: каталог `vibecode.finance/apps/` просто ссылается на твой URL. Поэтому свой сайт (VPS, Vercel и т.д.) нужен — его и вставляешь в форму. Подробнее и текст для сабмита: **[SUBMISSION.md](./SUBMISSION.md)**.

---

## 1. Build локально

```bash
npm install
npm run build
```

The output is in `dist/` (static files: `index.html`, `assets/*`).

## 2. Upload to VPS

Copy the contents of `dist/` to your server, e.g.:

```bash
scp -r dist/* user@YOUR_VPS_IP:/var/www/opnet-hub/
```

Or use rsync:

```bash
rsync -avz --delete dist/ user@YOUR_VPS_IP:/var/www/opnet-hub/
```

## 3. Nginx on VPS

Create a server block (e.g. `/etc/nginx/sites-available/opnet-hub`):

```nginx
server {
    listen 80;
    server_name your-domain.com;   # or IP for now
    root /var/www/opnet-hub;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000";
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/opnet-hub /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 4. (Optional) Node serve instead of Nginx

If you prefer Node:

```bash
npx serve dist -l 3000
```

Run under PM2 or systemd so it restarts on reboot.

## 5. Cloudflare in front

1. Add your site in [Cloudflare Dashboard](https://dash.cloudflare.com): Add site → enter your domain (or use a subdomain like `hub.yourdomain.com`).
2. Change nameservers at your registrar to Cloudflare’s (or add a CNAME if the domain is already on Cloudflare).
3. In Cloudflare: **DNS** → Add record: **A** (or **CNAME**) pointing to your VPS IP (or hostname).
4. **SSL/TLS** → set to **Full** or **Full (strict)** if you have a certificate on the VPS.
5. **Proxy status** = Proxied (orange cloud) for DDoS protection and caching.

You don’t have to buy a new domain: you can use a subdomain of a domain you already own, or a free option like a subdomain from a free DNS provider.

**API:** Use an **API Token** (My Profile → API Tokens), not the Global API Key. Zone Read + DNS Edit is enough. **Origin Certificate** (SSL/TLS → Origin Server) is installed on the VPS for HTTPS; it is not an API key.

## 6. Автодеплой (без паления ключей)

Скопируй `.env.example` в `.env`, заполни `VPS_HOST`, `VPS_USER`, `VPS_PATH` (и при необходимости `SSH_KEY_PATH`). Затем:

```bash
npm run deploy
```

Скрипт соберёт проект и зальёт `dist/` на VPS через rsync (или scp, если rsync недоступен). Секреты только в `.env`, в репозиторий не коммитятся. На Windows без rsync можно выполнить вручную шаги из пунктов 1–2 или использовать WSL/Git Bash.

## 7. Домен или IP

- **With domain**: Point A/CNAME to VPS, then put Cloudflare in front as above.
- **Without domain**: Use the VPS IP directly: `http://YOUR_VPS_IP`. You can still put Cloudflare in front by adding the site as “example.com” and using a CNAME from a subdomain you own to the IP (Cloudflare can proxy to an IP with a CNAME to a root domain in some setups; for a single app, IP + port is enough for testing).

For vibecode.finance submission, a live URL (domain or IP) is recommended.
