# Lochness WebUI

A web interface for configuring and monitoring [Lochness](https://github.com/dheshanm/lochness), a data lake builder. Provides project/site configuration management, data pull coverage monitoring, and log review.

---

## Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later
- **PostgreSQL** database populated by Lochness (tables: `subjects`, `data_pull`, `logs`, `projects`, `sites`, `data_sources`)

---

## 1. Clone and Install

```bash
git clone <repo-url>
cd lochness-webui
npm install
```

---

## 2. Configure Environment Variables

Copy the sample env file and fill in your values:

```bash
cp sample.env .env
```

Edit `.env`:

```env
# The public hostname of this app (used in links, no trailing slash)
NEXT_PUBLIC_HOSTNAME=your-server.example.com:3000

# PostgreSQL connection details
PG_host=your-postgres-host
PG_user=your-db-user
PG_password=your-db-password
PG_database=your-db-name
PG_port=5432
# PG_ssl=true   # uncomment if your DB requires SSL

# Better Auth - authentication layer
# BETTER_AUTH_SECRET: a long random string used to sign sessions. Keep this secret.
#   Generate one with: openssl rand -base64 32
BETTER_AUTH_SECRET=<generate-a-random-secret>

# BETTER_AUTH_URL: the full base URL this app is accessible at (no trailing slash)
BETTER_AUTH_URL=http://your-server.example.com:3000
```

> **Note:** `BETTER_AUTH_SECRET` is a signing key for session tokens — it is **not** a user password. Generate a secure value with `openssl rand -base64 32`.

---

## 3. Run Database Migrations (first time only)

The app uses [Better Auth](https://www.better-auth.com/) to manage user accounts. Its tables (`user`, `session`, `account`, `verification`) must be created in your Postgres database before first use.

**3a. Generate the migration SQL:**

```bash
npx @better-auth/cli generate
```

When prompted, confirm the output path (e.g. `./better-auth_migrations/<timestamp>.sql`). Review the generated file — it creates four tables and two indexes.

**3b. Apply the migration:**

```bash
PGPASSWORD="your-db-password" psql \
  --variable=ON_ERROR_STOP=1 \
  -h your-postgres-host \
  -U your-db-user \
  -d your-db-name \
  -p 5432 \
  -f better-auth_migrations/<timestamp>.sql
```

Or using env vars from your `.env`:

```bash
export $(grep -v '^#' .env | xargs)
PGPASSWORD="$PG_password" psql \
  --variable=ON_ERROR_STOP=1 \
  -h "$PG_host" -U "$PG_user" -d "$PG_database" -p "$PG_port" \
  -f better-auth_migrations/<timestamp>.sql
```

**3c. Verify the tables were created:**

```bash
PGPASSWORD="$PG_password" psql -h "$PG_host" -U "$PG_user" -d "$PG_database" -p "$PG_port" \
  -c "\dt" | grep -E 'user|session|account|verification'
```

You should see all four tables listed.

---

## 4. Start the Development Server

```bash
npm run dev
```

The server starts on port **3000** by default. If port 3000 is already in use, Next.js will automatically use the next available port (e.g. 3001) and print it in the terminal output:

```
⚠ Port 3000 is in use, using available port 3001 instead.
- Local: http://localhost:3001
```

Open the URL shown in your terminal.

---

## 5. Create Your First User Account

The app requires login. No users exist after a fresh migration, so you must register first.

1. Navigate to `http://localhost:<port>/auth/register`
2. Enter your name, email, and a password (minimum 2 characters)
3. After registering, go to `http://localhost:<port>/auth/login` and sign in

> **Tip:** To create an account non-interactively (e.g. on a server), use the API directly:
> ```bash
> curl -sS -X POST http://localhost:<port>/api/auth/sign-up/email \
>   -H 'Content-Type: application/json' \
>   -H 'Origin: http://localhost:<port>' \
>   -d '{"name":"your-name","email":"you@example.com","password":"your-password"}'
> ```

---

## 6. Using the App

After logging in you will see the sidebar with two sections:

### Monitoring → Logs (`/monitoring/logs`)

Select a project from the dropdown to view:

- **Summary** — counts of subjects with consent dates, sites with consented subjects, and subjects added last night
- **Subjects Missing Required Variables** — per-site breakdown with subject IDs and counts
- **Data Pull Coverage** — per-subject table showing which data sources have pull records, with normalized column names
- **Newly Added Subjects Last Night** — list of subjects whose consent date was yesterday
- **Pull Trend** — per-subject bar chart showing unique file pull counts by day (most recent first)
- **Warning Logs** — last 20 warning-level log entries (excluding routine missing-variable notices)

### Configurations → Projects (`/config/projects`)

- View, create, and edit projects
- Drill into a project to manage its sites and data source assignments

---

## 7. Production Build

To build and run a production-optimised server:

```bash
npm run build
npm run start
```

The production server also starts on port 3000 (or the next available port).

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login fails with "Failed to log in" | `BETTER_AUTH_URL` origin mismatch | Ensure `BETTER_AUTH_URL` in `.env` matches the URL you are accessing the app from, or add your URL to `trustedOrigins` in `src/lib/auth.ts` |
| Redirected to login after every page load | Session cookie not read by middleware | Hard-reload the page; ensure `BETTER_AUTH_SECRET` is consistent and not changed after sessions were created |
| "Missing required environment variables" on startup | `.env` not present or incomplete | Run `cp sample.env .env` and fill in all `PG_*` values |
| Port 3000 already in use | Another process is on 3000 | Use the port printed in the terminal output instead |
| Data Pull Coverage shows "N/A" for all subjects | `data_pull` table is empty or the table name differs | Verify data has been ingested by Lochness and that the table exists in your database |
