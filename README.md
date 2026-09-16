# Specs

Guess how many times the professor takes off his glasses this lecture. A moderator counts live, everyone watches the histogram move, and an Elo-style leaderboard keeps score across the term. Mobile-first, no money, free to host.

## Stack and why

| Piece | Choice | Why |
|---|---|---|
| Server | Node 20+, Express, `ws` | One process holds every phone's WebSocket. 300 clients is trivial; a tap fans out in well under 100 ms. |
| Client | React + Vite, plain CSS | Small bundle, fast to build, no design system to fight. The histogram is CSS bars with spring transitions. |
| Database | Postgres via `pg` in production, PGlite (embedded Postgres) locally | Same SQL everywhere. Locally there is nothing to install: `npm run dev` just works. In production point `DATABASE_URL` at a free Neon database. |
| Hosting | Render free web service + Neon free Postgres | Both deploy from a git repo, both have a real free tier, and Render supports WebSockets. `render.yaml` is included. |

Game math (bar coloring, projection, statistics, Elo) lives in one pure module, `src/shared/algorithms.ts`, with unit tests. Scoring is idempotent (guarded by `scored_at`) and covered by an integration test.

## Run locally

```bash
npm install
npm run seed      # 3 moderators, 40 students, one finished lecture. Password for all: specs-demo-2026
npm run dev       # API on :3000, Vite dev server on :5173
```

Open http://localhost:5173. Log in as `max` (a moderator) and visit `/mod`, or just guess as a new student.

Other commands:

```bash
npm test               # unit + integration tests
npm run build          # client -> dist/client, server -> dist/server
npm start              # run the production build on :3000
npm run seed -- --force   # wipe and reseed
npm run simulate       # fake lecture on a compressed timeline, see SIMULATE.md
```

Configuration is by environment variables; see `.env.example`. Everything has a default except `SESSION_SECRET` in production.

## Deploy (Render + Neon, both free)

1. Create a free Postgres database at https://neon.tech and copy its connection string.
2. Push this repo to GitHub.
3. On https://render.com choose **New → Blueprint**, pick the repo. `render.yaml` defines the web service.
4. Set the environment variables it asks for: `DATABASE_URL` (from Neon) and `SESSION_SECRET` (any long random string). `NODE_ENV=production` is set by the blueprint.
5. After the first deploy, seed from your machine against production (optional; you probably only want moderators, not fake students):
   ```bash
   DATABASE_URL="postgres://..." SEED_PASSWORD="choose-a-real-password" npm run seed
   ```
   Or skip the seed and create your moderator accounts by signing up in the app, then flip the flag as below.

Render's free tier sleeps after 15 minutes of inactivity and takes about a minute to wake. Open `/mod` a few minutes before lecture so the first student is not the one waiting.

Any other Node host works the same way: build with `npm run build`, start with `npm start`, provide `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, and `PORT`.

## Make a user a moderator

There is no admin UI on purpose. Run this against the database (Neon has a SQL editor in its dashboard):

```sql
UPDATE users SET is_moderator = true WHERE lower(username) = 'max';
```

Moderators see `/mod`; everyone else gets a 404 there. To rename an offensive username:

```sql
UPDATE users SET username = 'renamed_123' WHERE lower(username) = 'badname';
```

## Layout

```
src/shared/      algorithms.ts (pure game math + tests), types.ts (wire types)
src/server/      Express API, WebSocket hub, session state machine, scoring, seed
src/client/      React app: pages (/, /signup, /login, /live, /leaderboard, /me, /mod), components
scripts/         simulate.ts (fake lecture)
```
