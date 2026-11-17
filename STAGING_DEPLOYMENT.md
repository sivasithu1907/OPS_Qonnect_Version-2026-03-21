# Isolated staging stack — start-up, checks and rollback

Project `qonnect-fieldops-staging` · frontend `127.0.0.1:3001` only · WhatsApp / TV / n8n / external notifications OFF.
**Nothing here touches the production Compose project.** Run everything from a **separate checkout directory** of the
`staging/fieldops-security-update` branch (never from the directory that holds production's `.env` and volumes).

## 0. Read first — production impact of these code changes

The four switches default to **disabled** when unset. The production `docker-compose.yml` does **not** pass them through,
so a production container built from this code would have WhatsApp, TV and n8n **off** until
`ENABLE_WHATSAPP`, `ENABLE_TV`, `ENABLE_N8N`, `ENABLE_EXTERNAL_NOTIFICATIONS` are set to `true` for it
(add them to production's `.env` **and** to the `backend.environment` block). Do this in the production release
change, not in staging. This update deliberately does not edit `docker-compose.yml`.

## 1. One-time preparation (staging checkout)

```bash
cd /srv/qonnect-fieldops-staging            # a NEW directory, not the production one
git clone https://github.com/sivasithu1907/OPS_Qonnect_Version-2026-03-21.git .
git checkout <the-branch-you-pushed>         # see GITHUB_UPLOAD_INSTRUCTIONS.md
cp .env.staging.example .env.staging
chmod 600 .env.staging
# fill STAGING_DB_PASSWORD and STAGING_JWT_SECRET with NEW random values (never the production ones):
#   openssl rand -hex 24      (password)      openssl rand -hex 32      (JWT secret)
# optional first admin for the empty staging database: STAGING_INITIAL_ADMIN_EMAIL / _PASSWORD
```

## 2. Preflight (starts nothing)

```bash
scripts/staging.sh preflight        # must print: PREFLIGHT: OK
```

It renders the Compose file and refuses anything that could reach production: a published backend/DB port, a frontend
not on `127.0.0.1`, a non-staging volume or network name, a routable (non-`internal`) data network, any `ENABLE_*` not
`"false"`, integration credentials set, `external` networks/volumes, host mounts, `network_mode: host`, `privileged`, and
any variable name that belongs to production. If it fails, nothing is started.

## 3. Build and start

Check free memory first (`free -m`); the frontend build is the memory spike. Build one image at a time:

```bash
scripts/staging.sh build            # runs the preflight, then builds backend, then frontend
scripts/staging.sh up               # runs the preflight again, then docker compose up -d
scripts/staging.sh status
```

Reach the UI only through the loopback port, e.g. from your PC: `ssh -L 3001:127.0.0.1:3001 <server>` → `http://127.0.0.1:3001`.

## 4. Post-start checks (read-only)

```bash
scripts/staging.sh status                                   # only 127.0.0.1:3001 is published
docker compose -p qonnect-fieldops-staging -f docker-compose.staging.yml --env-file .env.staging logs backend | grep -E 'staging_isolation_ok|integration_switches'
#   expect  "type":"staging_isolation_ok"  and all four switches false
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/tv-data          # expect 404 (TV_DISABLED)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/health           # expect 200
ss -ltnp | grep -E ':(3001|8080|5432)\b'                    # 3001 on 127.0.0.1 only; 8080/5432 not published by staging
docker network inspect qonnect-fieldops-staging_internal --format '{{.Internal}}'   # expect true
docker volume ls | grep qonnect-fieldops-staging            # only qonnect-fieldops-staging_pgdata
```

The backend exits with code 78 and a `staging_isolation_violation` log line if the environment is unsafe (switch on,
integration credential set, DB host/name/user not the staging ones, production CORS host, weak secret). Treat that as a
stop sign, fix `.env.staging`, do not work around it.

## 5. Stop / rollback

| Goal | Command | Effect |
|---|---|---|
| Pause staging, keep its data | `scripts/staging.sh stop` | containers stopped; staging DB volume kept |
| Restart | `scripts/staging.sh up` | |
| Remove staging completely | `scripts/staging.sh destroy` (type the project name) | containers, staging networks, the two staging images and the **staging** DB volume are removed |
| Roll back the code only | `git checkout <previous-commit>` in the staging checkout, then `build` + `up` | staging DB kept (schema changes are additive, see BATCH1_SECURITY_DEPLOYMENT.md) |

Production is not part of any of these commands: the wrapper pins `-p qonnect-fieldops-staging -f docker-compose.staging.yml`
on every call and `destroy` never removes `postgres:16-alpine` (production uses it).

## 6. Memory / CPU budget (2 cores, 3.7 GB)

Limits: PostgreSQL 0.50 CPU / 384 MB, backend 0.50 CPU / 400 MB, frontend 0.25 CPU / 64 MB — ≈ 850 MB ceiling,
`cpu_shares: 256` so production wins under contention. Reservations total 272 MB.
Not measured on the real server: observe `docker stats --no-stream` and `free -m` after start; production workloads
were not measured by this update.

## 7. Not done by this update

No container was built or started, no push or deployment was made, production was not accessed. See TEST_RESULTS.md
for what was and was not executed.
