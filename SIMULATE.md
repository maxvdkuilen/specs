# Simulating a lecture

Use this to demo Specs before the first real lecture, or to rehearse the moderator flow.

## 1. Start the server with a compressed clock

The lock normally happens 10 minutes after Start. For a 3-minute fake lecture, make it 30 seconds. The projection arrow normally waits 2 minutes; make it 20 seconds. Run this in one terminal:

```bash
LOCK_AFTER_SEC=30 PROJECTION_MIN_ELAPSED_SEC=20 npm run dev
```

On Windows PowerShell:

```powershell
$env:LOCK_AFTER_SEC=30; $env:PROJECTION_MIN_ELAPSED_SEC=20; npm run dev
```

Seed the database first if you have not: `npm run seed`. The seeded accounts (moderators `max`, `alex_mod`, `sam_mod` and 40 students) all use the password `specs-demo-2026`.

## 2. Run the simulation

In a second terminal:

```bash
npm run simulate
```

What it does, all through the public API:

1. Logs in as moderator `max`.
2. Creates a draft session with a 3-minute duration.
3. Logs in 25 seeded students and submits a guess for each, roughly normal around the target count.
4. Waits 5 seconds, then starts the lecture.
5. Fires 11 `+1` count events spread over the lecture, including one mis-tap that is undone with a `-1` two seconds later.
6. When the timer runs out, ends the lecture. Scoring runs, the results modal appears on every connected phone.

Options:

```bash
npm run simulate -- --minutes=5 --count=14 --students=40
npm run simulate -- --no-students          # only the moderator side; you and friends guess for real
npm run simulate -- --base=https://your-app.onrender.com --password=the-mod-password
```

## 3. Watch it

- Open http://localhost:5173 on your phone (same wifi, use your computer's LAN IP instead of localhost) or in a browser at 360 px wide.
- Guess as a new student before the 5-second countdown ends, or log in as any seeded student who has not guessed yet.
- On `/live` you should see: cyan bars while the session is a draft; the magenta marker and green→yellow→red coloring once it starts; the violet projection arrow after 20 seconds; the countdown chip flipping to Locked at 30 seconds; the results modal when it ends.
- Open `/mod` in another tab as `alex_mod` to see the counter screen mirror the scripted taps in real time. You can tap `+` yourself too; every tap is one event row.

## 4. Reset

`npm run seed -- --force` wipes everything and reseeds. Or just create a new session from `/mod`; finished sessions stay in the history and the leaderboard.

## Rehearsing on the real deployment

Point the script at production with `--base` and a moderator password. Use `--no-students` so fake accounts do not pollute the real leaderboard. A finished simulated session will count toward ratings for anyone who guessed, so rehearse before real students have accounts, or with a throwaway database.
