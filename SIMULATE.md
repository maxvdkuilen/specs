# Simulating a lecture

Use this to demo Specs before the first real lecture, or to rehearse the moderator flow. The simulation invents its own students, gives them random guesses, and fires a random number of glasses removals automatically. Nothing needs to be seeded first.

## Against your live site

In a terminal in the project folder:

```powershell
npm run simulate -- --base https://YOUR-APP.onrender.com --mod YOUR_USERNAME --password YOUR_PASSWORD
```

What happens:

1. Logs in as your moderator account, creates a lecture (3 minutes by default) and starts it straight away. Every phone on the site flips to the guess screen, timer running.
2. Brings in 40 simulated students, named like `sim_eager_otter_07`, who each sign up (first time) or log in and guess while the clock runs. Bars spring up one by one. Real people can guess too; guessing stays open for the lock period.
3. A few simulated students change their guess.
4. Fires a random number of removals (5 to 18, or `--count 12`) at random moments, including one mis-tap that is undone.
5. Ends the lecture 4 seconds after the last removal. Results popup everywhere, leaderboard updates.

Options (write them as `--name value` or `--name=value`):

| Option | Default | Meaning |
|---|---|---|
| `--base` | `http://localhost:3000` | server URL |
| `--mod` / `--password` | `max` / `specs-demo-2026` | moderator login |
| `--students` | 40 | simulated students |
| `--minutes` | 3 | lecture length (minimum 1) |
| `--count` | random 5..18 | glasses removals |
| `--wait` | 0 | seconds between Start and the first simulated guess |
| `--no-students` | | only you and your friends guess |

If a session is already active the script refuses; end it from `/mod` first.

## Locally, with a compressed clock

The lock normally happens 10 minutes after Start and the projection arrow waits 2 minutes. `npm run dev:sim` starts the app with those set to 30 and 20 seconds and a matching shorter prior for the projection (preset in `.env.sim`):

```powershell
npm run dev:sim
```

Then in a second terminal, `npm run simulate`. Log in as a moderator locally with `max` / `specs-demo-2026` after `npm run seed`. Open http://localhost:5173 in a browser at 360 px wide to watch; on `/live` you should see cyan bars while the session is a draft, the magenta marker and green-to-red coloring once it starts, the violet projection arrow after 20 seconds, the chip flipping to Locked at 30 seconds, and the results modal at the end.

## Cleaning up before the first real lecture

Simulated students are real accounts with real ratings. Point the seed script at the live database and remove them, then reset the season so everyone starts at 1000. Get the connection string from Neon (or from Render's Environment tab).

```powershell
$env:DATABASE_URL = "postgresql://...your Neon string..."
npm run seed -- --remove-students     # deletes every sim_* account and the seeded fake students, with their guesses and history
npm run seed -- --reset-season        # deletes all sessions and resets every rating to 1000; keeps real accounts
Remove-Item Env:DATABASE_URL
```

Do the reset before class: every finished session, including simulations, feeds the projection prior and the leaderboard until then.

## How the projection arrow works

Projected final = current count + expected removals in the time left. The rate is what has been observed so far (count / elapsed), blended with a prior from past finished lectures whose weight grows with how many there are: none gives no prior, one a third of full weight, two a half, many the full 10-minute-equivalent. Before any lecture has finished, the crowd's median guess acts as a weak stabiliser worth about one minute of evidence (`PROJECTION_CROWD_TAU_SEC`, 0 disables). Prior weights scale with lecture length, so a 3-minute simulation behaves like a 75-minute lecture. The arrow is hidden for the first 2 minutes and never shown below the live count.
