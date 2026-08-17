const express = require('express');
const config = require('./config');
const ScraperEngine = require('./scraperEngine');
const QueueManager = require('./queue');

const app = express();
app.use(express.json());

// Global lock to prevent overlapping concurrent scrape runs
let isScrapingInProgress = false;

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), isScrapingInProgress });
});

/**
 * Queue status endpoint
 */
app.get('/queue-status', (req, res) => {
  try {
    const qm = new QueueManager();
    const status = qm.getStatus();
    res.json({
      ok: true,
      isScrapingInProgress,
      ...status,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Reset queue cursor endpoint
 */
app.post('/queue-reset', (req, res) => {
  if (isScrapingInProgress) {
    return res.status(409).json({ ok: false, error: 'Cannot reset queue while a scrape run is in progress.' });
  }

  const { index = 0 } = req.body || {};
  try {
    const qm = new QueueManager();
    const updatedState = qm.reset(parseInt(index, 10) || 0);
    res.json({
      ok: true,
      message: `Queue cursor reset to index ${updatedState.currentIndex}`,
      status: qm.getStatus(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Scrape Next combinations endpoint (for n8n / cron orchestrators)
 */
app.post('/scrape-next', async (req, res) => {
  if (isScrapingInProgress) {
    return res.status(409).json({
      ok: false,
      error: 'A scrape run is already in progress. Please wait for it to complete.',
    });
  }

  const { combos, target } = req.body || {};
  const combosCount = combos ? parseInt(combos, 10) : config.combosPerRun;
  const targetPerCombo = target ? parseInt(target, 10) : config.targetPerCombo;

  isScrapingInProgress = true;
  console.log(`[API] Received POST /scrape-next (combos: ${combosCount}, target: ${targetPerCombo})`);

  try {
    const engine = new ScraperEngine({
      combosPerRun: combosCount,
      targetPerCombo: targetPerCombo,
    });

    const result = await engine.runNext({
      combosCount,
      targetPerCombo,
    });

    res.json({
      ok: !result.blocked,
      ...result,
    });
  } catch (err) {
    console.error('[API] Scrape-next failed with error:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  } finally {
    isScrapingInProgress = false;
  }
});

/**
 * Ad-hoc scrape endpoint for single combo or custom search
 */
app.post('/scrape', async (req, res) => {
  if (isScrapingInProgress) {
    return res.status(409).json({
      ok: false,
      error: 'A scrape run is already in progress. Please wait for it to complete.',
    });
  }

  const { city, category, target = 10 } = req.body || {};
  if (!city || !category) {
    return res.status(400).json({
      ok: false,
      error: 'Missing required parameters: "city" and "category" are both required.',
    });
  }

  isScrapingInProgress = true;
  console.log(`[API] Received POST /scrape for "${category}" in "${city}" (target: ${target})`);

  try {
    const engine = new ScraperEngine({ targetPerCombo: parseInt(target, 10) });
    const result = await engine.scrapeSingle(city, category, parseInt(target, 10));

    res.json({
      ok: !result.blocked,
      city,
      category,
      ...result,
    });
  } catch (err) {
    console.error('[API] Scrape failed with error:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  } finally {
    isScrapingInProgress = false;
  }
});

const PORT = config.port || 3000;
const server = app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`Google Maps Scraper Service running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  - POST /scrape-next  (trigger daily/periodic batch)`);
  console.log(`  - POST /scrape       (ad-hoc single search)`);
  console.log(`  - GET  /queue-status (inspect progress & next combo)`);
  console.log(`  - POST /queue-reset  (reset cursor to index)`);
  console.log(`  - GET  /health       (health status)`);
  console.log(`======================================================\n`);
});

module.exports = { app, server };
