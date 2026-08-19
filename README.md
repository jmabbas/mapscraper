# Google Maps Store & Lead Scraper

A robust, production-grade Google Maps scraper designed to cross-join business categories and cities, systematically collect store details (**name, address, website, email, and Google Maps URL**), and export structured data into both **JSON** and **CSV** spreadsheets.

Built with rate-limiting safeguards, batch pacing, Google CAPTCHA/block detection, sequential tab reuse, and stateful cursor persistence.

---

## Features

- **Category × City Queue**: Cross-joins input lists (`categories.json` × `cities.json`, 17 × 101 = 1,717 combinations) with city as the outer loop.
- **Stateful Cursor Persistence**: Automatically tracks progress across runs in `data/state.json`. Safe for append-only additions to input lists.
- **Active Block & CAPTCHA Detection**: Halts the run immediately upon encountering Google's "unusual traffic" / CAPTCHA warnings, surfaces `blocked: true`, and retains the cursor so blocked combinations are retried rather than skipped.
- **Batch Pacing & Time-Boxing**:
  - Batched processing (e.g. 5 stores per batch with 3s pause)
  - Pacing between combinations (5s pause)
  - Per-combination time budget (4 min cutoff) and per-run time budget (18 min cutoff)
- **DOM-Based Resilient Scraping**: Uses `div[role="feed"]` direct scrolling, primary `a.hfpxzc` selector with semantic fallback `a[href*="/maps/place/"]`, and URL deduplication.
- **Deep Email Extraction**: Visits store websites sequentially with resource blocking (aborts images/fonts/media for high throughput), searches `mailto:` links, applies regex scanning across page text, strips trailing punctuation, and filters out asset noise.
- **Dual Export**: Generates timestamped run files (`output/runs/scrape_*.json`, `output/runs/scrape_*.csv`) and automatically appends to cumulative outputs (`output/results.json`, `output/results.csv`).
- **Dual Execution Modes**:
  1. **Standalone CLI** for local execution and manual triggers (`npm run scrape`, status, reset, single-combo search).
  2. **Express HTTP Microservice** (`npm start`) with endpoints (`/scrape-next`, `/queue-status`, `/queue-reset`, `/scrape`) ready for n8n or Docker.

---

## Directory Structure

```
mapscraper/
├── bin/
│   └── mapscraper.js              # Executable CLI binary
├── input/
│   ├── categories.json            # Business categories list
│   └── cities.json                # Target cities list
├── data/
│   └── state.json                 # Persisted queue cursor & stats
├── output/
│   ├── results.json               # Cumulative JSON store database
│   ├── results.csv                # Cumulative CSV spreadsheet
│   └── runs/                      # Individual timestamped run exports
├── src/
│   ├── config.js                  # Central configuration
│   ├── queue.js                   # Queue builder & cursor manager
│   ├── browser.js                 # Puppeteer manager & stealth setup
│   ├── mapsScraper.js             # Maps DOM search & place extractor
│   ├── emailExtractor.js          # Website email regex & sanitizer
│   ├── exporter.js                # RFC 4180 CSV & JSON writer
│   ├── scraperEngine.js           # Core scraping orchestrator
│   ├── cli.js                     # CLI command definitions
│   └── server.js                  # Express API microservice
├── test/                          # Unit & integration test suite
├── Dockerfile                     # Container definition
├── docker-compose.yml             # Scraper + n8n multi-container setup
├── google-maps-scraper-workflow.json # Importable n8n workflow
└── package.json
```

---

## Installation & Setup

### Prerequisites
- Node.js 18+ (Node 20+ recommended)
- npm 9+

### Install Dependencies
```bash
npm install
```

---

## CLI Usage

### 1. Run the Next Scheduled Combinations
Scrapes the next N combinations (default: 3 combinations, 25 stores each) and advances the cursor:
```bash
npm run scrape
# or with custom limits:
node bin/mapscraper.js run --combos 3 --target 25
```

log 

tail -f /Users/USER_NAME/Sites/mapscraper/cron.log

auto run

0 */2 * * * cd /Users/USER_NAME/Sites/mapscraper && /Users/USER_NAME/.nvm/versions/node/v22.23.1/bin/node bin/mapscraper.js run --combos 3 --target 25 >> /Users/USER_NAME/Sites/mapscraper/cron.log 2>&1

### 2. Inspect Queue Progress & Status
```bash
npm run status
# or
node bin/mapscraper.js status
```
Output:
```
===== Google Maps Scraper Queue Status =====
Current Index:          1
Total Combinations:     1717
Completed Combinations: 1
Remaining Combinations: 1716
Progress:               0.06%
Total Stores Scraped:   2
Last Run At:            2026-08-16T17:45:55.800Z
Last Completed Combo:   "Fashion & Apparel" in "New York"
Next Combo to Run:      "Jewelry" in "New York"
Next Combo URL:         https://www.google.com/maps/search/Jewelry+in+New+York/
============================================
```

### 3. Reset Queue Cursor
Reset progress back to the beginning (or a specific combo index):
```bash
npm run reset
# or to a specific index:
node bin/mapscraper.js reset --index 0
```

### 4. Ad-hoc Single Search (Without Advancing Queue)
```bash
node bin/mapscraper.js single --city "Austin" --category "Florist" --target 10
```

---

## HTTP Microservice & Orchestration (n8n)

### Start the Server
```bash
npm start
# Service listening on port 3000
```

### API Endpoints

#### 1. `POST /scrape-next`
Triggers the next batch of combinations from the queue:
```bash
curl -X POST http://localhost:3000/scrape-next \
  -H "Content-Type: application/json" \
  -d '{"combos": 3, "target": 25}'
```

#### 2. `GET /queue-status`
Returns status, completion percentage, and the next combination in line:
```bash
curl http://localhost:3000/queue-status
```

#### 3. `POST /queue-reset`
Resets the queue cursor:
```bash
curl -X POST http://localhost:3000/queue-reset \
  -H "Content-Type: application/json" \
  -d '{"index": 0}'
```

#### 4. `POST /scrape`
Ad-hoc single scrape:
```bash
curl -X POST http://localhost:3000/scrape \
  -H "Content-Type: application/json" \
  -d '{"city": "Chicago", "category": "Electronics", "target": 10}'
```

---

## Docker & n8n Deployment

1. Start both the scraper container and n8n:
   ```bash
   docker compose up -d --build
   ```
2. Open n8n at `http://localhost:5678`.
3. Import `google-maps-scraper-workflow.json` via **Workflows → Import from File**.
4. Activate the daily 8am schedule trigger.

---

## Configuration Reference

All settings can be customized via `.env` or system environment variables:

| Variable | Default | Description |
|---|---|---|
| `COMBOS_PER_RUN` | `3` | Number of category+city combos to scrape per run |
| `TARGET_PER_COMBO` | `25` | Max stores to collect per combination |
| `BATCH_SIZE` | `5` | Stores processed per sub-batch |
| `BATCH_PAUSE_MS` | `3000` | Milliseconds pause between sub-batches |
| `COMBO_PAUSE_MS` | `5000` | Milliseconds pause between combinations |
| `PER_COMBO_MAX_DURATION_MS` | `240000` | Max duration per combo before returning partial results (4 min) |
| `TOTAL_MAX_DURATION_MS` | `1080000` | Max duration for an entire run (18 min) |
| `HEADLESS` | `true` | Run browser in headless mode (`false` for visible debugging) |
| `PORT` | `3000` | Microservice HTTP port |
| `PROXY_SERVER` | `null` | Optional HTTP/SOCKS proxy (e.g. `http://proxy.example.com:8080`) |

---

## Running Tests

Run the built-in automated test suite:
```bash
npm test
```

Includes test suites for:
- Queue cross-join & URL encoding logic (1,717 items)
- Email extractor regex, sanitization, and invalid domain filtering
- RFC 4180 compliant CSV formatting & dual JSON/CSV export
- Google CAPTCHA / unusual traffic block detector
