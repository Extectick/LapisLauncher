# Production API

Production API runs in Docker on the VDS and is exposed only through Nginx at `https://api.lapis-mc.ru`. PostgreSQL has no published host port and stores data in the named volume `lapis-api_lapis_postgres_data`.

## Files

- `apps/api/Dockerfile` — multi-stage Node.js 22 image, Prisma generation and runtime migrations.
- `compose.prod.yml` — API, PostgreSQL, health checks, restart policy, read-only API filesystem and bounded logs.
- `deploy/nginx/lapis-api-*.conf` — rate limits, reverse proxy and HTTP/HTTPS virtual hosts.
- `.env.production.example` — variable names only; the real `.env.production` must remain outside Git with mode `0600`.

## Deploy

```bash
cd /opt/lapis-api/source
docker compose -f compose.prod.yml --env-file /opt/lapis-api/.env.production up -d --build
curl --fail http://127.0.0.1:3000/healthz
```

Nginx proxies only to `127.0.0.1:3000`. On the current VDS HAProxy owns public port 443 and forwards TLS by SNI to Nginx at `127.0.0.1:8443`, so the API HTTPS virtual host must not bind public port 443 directly.

Before issuing the certificate, all authoritative DNS servers for `lapis-mc.ru` must return `147.45.133.170` for the A record `api.lapis-mc.ru`. Then use webroot validation:

```bash
certbot certonly --webroot -w /var/www/letsencrypt -d api.lapis-mc.ru
nginx -t && systemctl reload nginx
```

## Data and rollback

Never run `docker compose down -v` in production. Before a deployment, create a PostgreSQL custom-format dump and retain the previous source/config directory. A code rollback reuses the same named volume; database downgrade is not automatic and must be assessed per migration.

The launcher production default is `https://api.lapis-mc.ru`. `LAPIS_API_URL` remains available only as a development/testing override.
