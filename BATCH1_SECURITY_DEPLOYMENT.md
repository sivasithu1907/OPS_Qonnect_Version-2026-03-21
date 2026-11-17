# Batch 1 security release — deployment guide (STAGING FIRST)

Status: prepared for review. Nothing in this guide has been run against production.
Source baseline: server commit `1afd2db6fed38f633bc5063b1a676896acd4c193` (identity taken from the ZIP comment; unverified against GitHub).

Do the steps one at a time, in order. Stop at the first surprise and report it.

---

## 0. Before anything else

1. Confirm the commit on the server: `cd /opt/qonnect && git rev-parse HEAD` — it must be `1afd2db6…`. If it is different, stop: this package has not been integrated with that code.
2. Take a database backup and **prove it restores** into a throw-away database (see section 6). A backup file that has never been restored is not a backup.
3. Deploy to a separate **staging** copy first (own folder, own database volume, own port/domain). Never test this release against the production database.

## 1. Read-only production checks (run only after approval; none of these change anything)

Run from `/opt/qonnect` on the server.

```bash
# 1. Which code is deployed, and is the working tree clean?
git rev-parse HEAD && git status --short | head

# 2. Is the backend port reachable from outside? (run the 2nd command from ANOTHER machine/phone)
ss -ltnp | grep -E ':(8080|3000|80|443)\b'
curl -s -m 5 -o /dev/null -w "%{http_code}\n" http://<server-public-ip>:8080/api/health   # 000/timeout = closed, 200 = exposed

# 3. Required secrets: print LENGTHS only, never values
awk -F= '/^(DB_PASSWORD|JWT_SECRET|TV_TOKEN|API_KEY|CORS_ORIGIN|INITIAL_ADMIN_EMAIL)=/{print $1, "length=" length($2)}' .env

# 4. Reverse-proxy chain in front of the API (decides TRUST_PROXY_HOPS)
docker compose ps
sudo systemctl status caddy --no-pager | head -5
sudo grep -nE 'reverse_proxy|handle|:3000|:8080|:80|header_up|trusted_proxies|^[a-zA-Z0-9.-]+ *\{' /etc/caddy/Caddyfile   # routing lines only (a Caddyfile can hold credentials, so do not paste it whole)

# 5. Database: required columns exist?
docker compose exec -T db psql -U fieldops -d fieldops -At -c "
SELECT table_name||'.'||column_name FROM information_schema.columns
WHERE (table_name,column_name) IN (('customers','updated_at'),('customers','created_at'),('activities','visit_history'),('activities','started_at'),('activities','completed_at'),('activities','details'),('tickets','photos'),('users','password'),('sales_appointment_requests','linked_activity_id'))
ORDER BY 1;"
# expect all 9 lines (activity photos live inside activities.details); customers.updated_at comes from DATABASE_MIGRATION.sql, not from the server start-up code.

# 6. Photos already replaced by the placeholder (read-only transaction, prints ids and counts only)
docker compose exec -T db psql -U fieldops -d fieldops -v ON_ERROR_STOP=1 < scripts/readonly_check_photo_placeholders.sql

# 7. Accounts still using well-known passwords (read-only, prints account e-mail and which default matched; no hashes)
docker compose exec -T backend node --input-type=module < scripts/readonly_check_default_passwords.mjs

# 8. Administrators
docker compose exec -T db psql -U fieldops -d fieldops -c "SELECT id,email,role,status FROM users WHERE role='ADMIN' ORDER BY email;"
```

Send the outputs back for review. These commands print no secret values (check 3 prints lengths only; check 4 prints routing lines only).

## 2. Values the new configuration requires (`.env` next to `docker-compose.yml`)

| Variable | Required | Notes |
| --- | --- | --- |
| `DB_PASSWORD` | Yes — compose refuses to start without it | Must equal the password the existing database volume was created with. An existing volume keeps its old password; changing `.env` alone does not change it. |
| `JWT_SECRET` | Yes — compose refuses to start without it | `openssl rand -hex 32`. Changing it signs every user out once. |
| `TV_TOKEN` | Only if the TV page is used | At least 24 characters: `openssl rand -hex 24`. Empty = `/api/tv-data` is switched off. |
| `TV_ALLOW_QUERY_TOKEN` | No (default `false`) | `true` only while old TV screens still send the token in the URL. |
| `TRUST_PROXY_HOPS` | No (default `1`) | Number of reverse proxies between the internet and the API. Frontend nginx = 1; nginx **plus** a host proxy such as Caddy = 2. Wrong value = every user shares one IP for login throttling. Decide it from check 4. |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` | Fresh install only | Used only when no enabled ADMIN exists. Never modifies existing users. Remove after first start. |
| `CORS_ORIGIN`, `API_KEY`, `WA_*`, `N8N_WEBHOOK_URL` | As before | Unchanged. |

The backend container now listens on `127.0.0.1:8080` of the host only (nginx reaches it over the Docker network). A host-level proxy that targets `localhost:8080` keeps working; anything that used `http://<public-ip>:8080` stops working by design.

## 3. Deployment sequence (staging, then — only with approval — production)

1. `git fetch` and check out the integration commit; `git log --oneline -4` should show the Batch 1 commits on top of `1afd2db`.
2. Create/extend `.env` with the values from section 2. Run `docker compose config -q` — it must print nothing (an error here is the safety net working).
3. `docker compose up -d --build`, then `docker compose ps` — all three services `healthy`/`running`.
4. `docker compose logs --tail 80 backend` — look for the line that the database is ready and for **no** line that prints a password or token.
5. Run the smoke tests in section 4 before anyone else is told the release is live.

## 4. Smoke tests after start-up

| Check | Expected |
| --- | --- |
| `curl -s localhost:8080/api/health` on the server | `{"status":"ok",…}` |
| `curl -s -m5 http://<public-ip>:8080/api/health` from outside | no answer |
| `curl -s -o /dev/null -w "%{http_code}" https://<site>/api/tv-data` | `503` (TV off) or `401` (no token) — never `200` |
| `curl -s -H "X-TV-Token: <token>" https://<site>/api/tv-data` | `200`, activities without phone numbers |
| Log in as Admin → User Management → create a user without a password | the form refuses |
| Log in as a field engineer → open another engineer's job and try to edit/delete | refused (403) |
| Open a job with photos, change its status, reopen it | the photos are still there |
| System Data Tools → Import | shows as disabled; Export still works |
| TV screen: open `https://<site>/#tv:<token>` once | TV dashboard loads; the address bar changes to `#tv` and the token is kept in that browser |

## 5. Rollback

Code only (no schema change is made by this release):

```bash
cd /opt/qonnect
git checkout 1afd2db6fed38f633bc5063b1a676896acd4c193   # or the previous deployed commit
docker compose up -d --build
```

Notes: the old code ignores the new variables, so `.env` can stay. Rolling back **re-opens** the audited vulnerabilities, so roll back only to buy time to fix a blocking problem. Photos saved by the new code are normal data and stay valid. Sessions signed before a password change (`pwv`) remain valid under the old code.

If the database is damaged (it should not be — no migration runs), restore the verified backup from section 6 into a new volume and point `DB_NAME`/volume at it; never overwrite the live volume first.

## 6. Backup and restore proof (before deploying)

```bash
mkdir -p ~/backups && docker compose exec -T db pg_dump -U fieldops -d fieldops -Fc > ~/backups/fieldops_$(date +%F_%H%M).dump
ls -l ~/backups/*.dump                                  # size must be plausible (not a few bytes)
# restore proof into a THROW-AWAY database (not the live one):
docker compose exec -T db psql -U fieldops -d postgres -c "CREATE DATABASE restore_proof"
docker compose exec -T db pg_restore -U fieldops -d restore_proof --no-owner < ~/backups/fieldops_<file>.dump
docker compose exec -T db psql -U fieldops -d restore_proof -At -c "select count(*) from users; select count(*) from customers; select count(*) from activities;"
docker compose exec -T db psql -U fieldops -d postgres -c "DROP DATABASE restore_proof"
```

Compare the three counts with the live database before treating the backup as verified.

## 7. Credential rotation (separate approval; not part of this release)

Only after the check in section 1 (#7) and with explicit approval:

1. Sign in as an administrator you trust. Do **not** delete administrator accounts.
2. For each account that matched a default password: User Management → edit the user → enter a new unique password (8+ characters). The user's open sessions stop working immediately. Hand the new password over through a private channel.
3. For your own administrator account: use the Change Password option for your own account (it asks for the current password and works for your own account only).
4. Re-run check #7 and confirm it reports no matches.
5. If `JWT_SECRET` or `DB_PASSWORD` must change: schedule it as its own change (JWT change = everyone signs in again; DB password change = `ALTER USER fieldops PASSWORD '…'` and the `.env` value updated in the same maintenance window).

## 8. Known issues

This candidate also contains the Phase 2 fixes **QA-08** (every activity update answered HTTP 500 after saving — the SAR sync helper is now declared at file level) and **QA-09** (cancel / reschedule failed with `multiple assignments to same column`; the technician portal referenced an undefined `setViewJob`). The activity update now runs in one transaction under a row lock; there is **no schema change and no data migration**. Code-only rollback (section 5) is unchanged. See `PHASE2_QA08_QA09_DOCS/` in the delivery ZIP for the evidence and the remaining risks.

Still deliberately not part of this release: the remaining audit items (Batch 2 or later), and the concurrency findings logged as QA-23-class observations (last-write-wins on a stale full-record update).
