# Configuració HTTPS per test.bertran.info — Oracle Free Tier

## Resum

Exposem el dashboard Next.js (port 3000, fins ara únicament intern) a Internet via `https://test.bertran.info` amb nginx com a reverse proxy i certificat Let's Encrypt.

**Data de configuració:** 2026-04-08
**Certificat expira:** 2026-07-07

---

## Arquitectura resultant

```
Internet
   │
   ▼
https://test.bertran.info (port 443)
   │
   ▼
nginx (Oracle Linux) — /etc/nginx/conf.d/test.bertran.info.conf
   │  Redirigeix HTTP→HTTPS
   │  Proxy SSL → localhost:3000
   ▼
Next.js (PM2: crypto-app) — port 3000
```

El port 3000 segueix **sense exposar-se directament**. nginx actua de gateway SSL.

---

## Que s'ha instal·lat al servidor Oracle

### Paquets
```bash
sudo dnf install -y epel-release nginx python3-pip augeas-libs
sudo python3 -m pip install certbot certbot-nginx
```

> Oracle Linux 8 no té `apt-get`, `snap` ni `snapd`. certbot s'instal·la via pip3.
> Binari resultant: `/usr/local/bin/certbot`

### SELinux
Cal permetre que nginx es connecti a ports locals (per defecte SELinux ho bloqueja):
```bash
sudo setsebool -P httpd_can_network_connect 1
```
Sense això nginx retorna **502 Bad Gateway** malgrat que Next.js estigui operatiu.

### Firewall (firewalld)
```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

---

## Fitxers de configuració

### `/etc/nginx/conf.d/test.bertran.info.conf`
```nginx
server {
    listen 80;
    server_name test.bertran.info;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name test.bertran.info;

    ssl_certificate     /etc/letsencrypt/live/test.bertran.info/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/test.bertran.info/privkey.pem;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

> Oracle Linux usa `/etc/nginx/conf.d/` (no `sites-available/sites-enabled/` com Ubuntu/Debian).

### Certificat Let's Encrypt
```bash
sudo /usr/local/bin/certbot --nginx -d test.bertran.info --non-interactive --agree-tos -m admin@bertran.info
```
Fitxers generats:
- `/etc/letsencrypt/live/test.bertran.info/fullchain.pem`
- `/etc/letsencrypt/live/test.bertran.info/privkey.pem`

---

## Renovació automàtica del certificat

El certificat caduca cada 90 dies. Cron job configurat:
```bash
echo "0 3 * * * root /usr/local/bin/certbot renew --quiet --post-hook 'systemctl reload nginx'" | sudo tee /etc/cron.d/certbot-renew
```
S'executa cada dia a les 3:00 AM. Renovarà el cert quan quedi menys de 30 dies.

Per provar la renovació manualment:
```bash
sudo /usr/local/bin/certbot renew --dry-run
```

---

## Troubleshooting

| Símptoma | Causa probable | Solució |
|----------|---------------|---------|
| `502 Bad Gateway` | SELinux bloqueja nginx→localhost | `sudo setsebool -P httpd_can_network_connect 1` |
| `curl: SSL certificate problem` | Cert no obtingut o path incorrecte | Verificar `/etc/letsencrypt/live/test.bertran.info/` |
| `Connection refused` porta 443 | Firewall Oracle Cloud no obert | Oracle Console → VCN → Security Lists → ports 80/443 |
| nginx no arrenca | Config invàlida | `sudo nginx -t` per veure l'error |

---

## Verificació

```bash
# Des de qualsevol lloc
curl -I https://test.bertran.info/api/status
# Esperat: HTTP/1.1 401 Unauthorized (Next.js respon, requereix login)

# Des del servidor
sudo nginx -t
pm2 status
```
