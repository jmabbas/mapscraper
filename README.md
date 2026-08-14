# Daily Google Maps Store Scraper for n8n (category × city queue)

Cycles through every category+city combination automatically, one combo per
day, collecting up to 25 stores per combo — no manual URL editing needed.

## How it works
- `data/categories.json` + `data/cities.json` are cross-joined into a queue
  of `city + category` combinations at startup (city is the outer loop, so
  all categories for city 1 run before moving to city 2).
- The scraper service tracks **which combo is next** in a small state file
  (`currentIndex`), persisted in a Docker volume so it survives restarts.
- Each day's n8n run calls `POST /scrape-next` — the service scrapes
  **`COMBOS_PER_DAY` combos** (default 3) starting from the current pointer,
  advancing it after each one completes. A combo is never repeated the next
  day — the cursor only ever moves forward.
- Within one combo, scraping happens in **batches of 5** (scroll → scrape 5 →
  pause 3s → scrape next 5 …) up to 25 total, so a single request never tries
  to hammer 20+ store/website pages back-to-back — this is what was causing
  the earlier "Internal Server Error" (a request timeout under load, not an
  actual crash). There's also a short pause between combos.
- If a combo can't finish within its time budget, the service returns
  whatever it collected (`complete: false`) and still advances to the next
  combo rather than getting stuck. There's also an overall run-length cap
  (`TOTAL_MAX_DURATION_MS`, default 18 min) — if it's hit mid-run, the
  service stops before starting another combo; whatever wasn't reached that
  day just runs on the next trigger.

```
Daily Trigger → HTTP Request (POST /scrape-next) → Split Stores
                        │
                        ▼
     scraper container: queue + cursor + Puppeteer (N combos/run)
```

With 17 categories × 101 cities = **1,717 combinations** and the default of
3/day, a full cycle takes about **19 months**. Raise `COMBOS_PER_DAY` to go
faster — see the rate-limiting note below before pushing it too high.

## Will Google rate-limit or block this?
Being honest about the risk rather than promising it's safe:

- **Yes, it can happen**, regardless of pace — this is unauthorized scraping
  of Google Maps (against Google's Terms of Service), and Google doesn't
  publish the exact thresholds that trigger a block. More combos per day
  from the same IP does raise the odds of hitting a CAPTCHA wall or a
  temporary block, but there's no "safe" number I can guarantee.
- **What this setup already does to reduce risk:** batches of 5 with pauses,
  a pause between combos, and a single long-lived browser session reused
  across combos in one run (fewer cold launches) rather than firing requests
  in parallel.
- **New in this version — block detection:** before/during each combo, the
  service checks the page for Google's "unusual traffic" / CAPTCHA wording.
  If it sees that, it **stops the entire run immediately**, does **not**
  advance past that combo (so it's retried, not skipped, next run), and
  reports `blocked: true` in the response — instead of silently continuing
  and returning garbage/empty data.
- **Practical guidance:** start with the default `COMBOS_PER_DAY=3` and watch
  a few days of runs for `blocked: true`. If you don't see it, you can raise
  the number gradually. If you push it much higher (say, 10+/day) from a
  single home/server IP, blocks become meaningfully more likely — at that
  point the standard mitigation is rotating outbound IPs/proxies, which is a
  bigger architecture change I can help with if you get there.

## Files
- `data/categories.json`, `data/cities.json` — your reference lists (mounted
  read-only into the container).
- `scraper-service/server.js` — Express server: builds the queue, tracks the
  daily cursor, does the batched Puppeteer scraping.
- `scraper-service/package.json`, `scraper-service/Dockerfile` — the scraper
  container, built from the official Puppeteer base image.
- `docker-compose.yml` — runs `n8n` (untouched official image) + `scraper`,
  with volumes for `./data` (your JSON lists) and a named volume for the
  persisted cursor.
- `google-maps-scraper-workflow.json` — importable n8n workflow: Daily
  Trigger → HTTP Request → Split Stores. No Config node needed anymore — the
  service decides what to scrape each day.

## Setup steps

1. Arrange the folder like this:
   ```
   gmaps-scraper/
   ├── docker-compose.yml
   ├── google-maps-scraper-workflow.json
   ├── data/
   │   ├── categories.json
   │   └── cities.json
   └── scraper-service/
       ├── Dockerfile
       ├── package.json
       └── server.js
   ```

2. Build and start:
   ```bash
   docker compose up -d --build
   ```

3. Open n8n: `http://localhost:5678`

4. **Workflows → Import from File** → `google-maps-scraper-workflow.json`

5. Test it: click **Execute Workflow**. Check **Split Stores** output — one
   item per store, tagged with `city` and `category`:
   `{ city, category, name, url, address, website, email, scrapedAt }`.

6. Toggle the workflow **Active** to run daily at 8am (edit the hour in the
   **Daily 8am Trigger** node for a different time).

## Checking / resetting progress
- **Where you are in the queue:**
  ```bash
  curl http://localhost:3000/queue-status
  ```
  (only reachable from inside the Docker network by default — from your
  host, use `docker exec gmaps-scraper wget -qO- http://localhost:3000/queue-status`,
  or temporarily publish port 3000 in `docker-compose.yml` for host access.)
- **Jump to a specific combo / start over:**
  ```bash
  curl -X POST http://localhost:3000/queue-reset -H "Content-Type: application/json" -d '{"index": 0}'
  ```
  (same access note as above.)

## Tuning
Environment variables on the `scraper` service in `docker-compose.yml`:
- `TARGET_PER_DAY` (default 25) — stores collected per combo
- `BATCH_SIZE` (default 5) — stores scraped per batch before pausing
- `BATCH_PAUSE_MS` (default 3000) — pause between batches within a combo
- `COMBOS_PER_DAY` (default 3) — how many city+category combos to process
  per trigger
- `COMBO_PAUSE_MS` (default 5000) — pause between combos in the same run
- `PER_COMBO_MAX_DURATION_MS` (default 240000 / 4 min) — safety cutoff per
  combo; returns partial results rather than hanging
- `TOTAL_MAX_DURATION_MS` (default 1080000 / 18 min) — safety cutoff for the
  whole run; if raising `COMBOS_PER_DAY`, raise this too (and the timeout in
  the n8n HTTP Request node, currently 1,200,000 ms / 20 min)

## Notes
- Scraping Google Maps this way isn't officially sanctioned by Google — the
  daily cap and batch pacing already keep volume modest. Expect occasional
  breakage if Google changes its internal class names (e.g. `hfpxzc`).
- If a combo's city/category returns very few real results (e.g. "Bike Shop"
  in a small city), `count` will just be lower than 25 — that's expected.
