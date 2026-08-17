const config = require('./config');
const QueueManager = require('./queue');
const BrowserManager = require('./browser');
const MapsScraper = require('./mapsScraper');
const EmailExtractor = require('./emailExtractor');
const Exporter = require('./exporter');

class ScraperEngine {
  constructor(customConfig = {}) {
    this.config = { ...config, ...customConfig };
    this.queueManager = new QueueManager(this.config);
    this.browserManager = new BrowserManager(this.config);
    this.mapsScraper = new MapsScraper(this.browserManager, this.config);
    this.exporter = new Exporter(this.config);
  }

  static sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Scrapes a single combo { city, category, url }
   */
  async processCombo(combo, targetPerCombo = this.config.targetPerCombo, deadline = null) {
    const startTime = Date.now();
    const comboDeadline = startTime + (this.config.perComboMaxDurationMs || 240000);
    const effectiveDeadline = deadline ? Math.min(deadline, comboDeadline) : comboDeadline;

    console.log(`\n======================================================`);
    console.log(`[Combo Start] "${combo.category}" in "${combo.city}"`);
    console.log(`URL: ${combo.url}`);
    console.log(`Target: up to ${targetPerCombo} stores`);
    console.log(`======================================================`);

    const mapsPage = await this.browserManager.getMapsPage();

    // 1. Navigate to Maps Search URL
    console.log(`[1/3] Navigating to Maps search page...`);
    const navResult = await this.mapsScraper.navigateToSearch(mapsPage, combo.url);
    if (navResult.blocked) {
      console.warn(`[BLOCKED] Google detected unusual traffic on search page.`);
      return {
        blocked: true,
        complete: false,
        stores: [],
        error: 'Google unusual traffic block detected',
      };
    }

    // 2. Collect listing URLs from results feed
    console.log(`[2/3] Scrolling feed to find up to ${targetPerCombo} store listings...`);
    const listings = await this.mapsScraper.collectListingLinks(mapsPage, targetPerCombo);
    console.log(`Found ${listings.length} listings for "${combo.category} in ${combo.city}"`);

    if (listings.length === 0) {
      return {
        blocked: false,
        complete: true,
        stores: [],
      };
    }

    // 3. Process listings in batches with pacing & tab reuse
    const collectedStores = [];
    const batchSize = this.config.batchSize || 5;
    const batchPauseMs = this.config.batchPauseMs || 3000;

    const externalPage = await this.browserManager.getExternalPage();

    for (let i = 0; i < listings.length; i += batchSize) {
      // Check timebox cutoff
      if (Date.now() >= effectiveDeadline) {
        console.warn(`[TIMEBOX] Per-combo time limit reached. Returning partial results (${collectedStores.length} stores).`);
        await this.browserManager.closeExternalPage();
        return {
          blocked: false,
          complete: false,
          stores: collectedStores,
          timeboxExceeded: true,
        };
      }

      const batch = listings.slice(i, i + batchSize);
      console.log(`\n--- Processing Batch ${Math.floor(i / batchSize) + 1} (${batch.length} stores) ---`);

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const overallIndex = i + j + 1;
        console.log(`[${overallIndex}/${listings.length}] Extracting details for: "${item.name}"`);

        // Scrape place details
        const details = await this.mapsScraper.scrapePlaceDetails(mapsPage, item.url, item.name);
        if (details.blocked) {
          console.warn(`[BLOCKED] Google block detected while scraping store: ${item.name}`);
          await this.browserManager.closeExternalPage();
          return {
            blocked: true,
            complete: false,
            stores: collectedStores,
            error: 'Google block detected during place details',
          };
        }

        // Email extraction from website
        let email = 'Not found';
        if (details.website && details.website !== 'Not found' && details.website.startsWith('http')) {
          console.log(`  -> Visiting website: ${details.website}`);
          email = await EmailExtractor.extractEmails(
            externalPage,
            details.website,
            this.config.websiteTimeoutMs || 12000
          );
          if (email !== 'Not found') {
            console.log(`  ✓ Email found: ${email}`);
          }
        }

        const storeRecord = {
          city: combo.city,
          category: combo.category,
          name: details.name || item.name || 'Not found',
          url: item.url,
          address: details.address || 'Not found',
          website: details.website || 'Not found',
          email,
          scrapedAt: new Date().toISOString(),
        };

        collectedStores.push(storeRecord);
      }

      // Pause between batches if more listings remain in this combo
      if (i + batchSize < listings.length) {
        console.log(`[Pacing] Pausing ${batchPauseMs}ms before next batch...`);
        await ScraperEngine.sleep(batchPauseMs);
      }
    }

    await this.browserManager.closeExternalPage();

    return {
      blocked: false,
      complete: true,
      stores: collectedStores,
    };
  }

  /**
   * Main entrypoint for running the next N scheduled combinations
   */
  async runNext(options = {}) {
    const combosCount = options.combosCount || this.config.combosPerRun || 3;
    const targetPerCombo = options.targetPerCombo || this.config.targetPerCombo || 25;
    const startTime = Date.now();
    const runDeadline = startTime + (this.config.totalMaxDurationMs || 1080000);

    const combos = this.queueManager.getNextBatch(combosCount);
    if (combos.length === 0) {
      return {
        done: true,
        message: 'All combinations in queue have already been processed.',
        totalCombos: this.queueManager.queue.length,
        currentIndex: this.queueManager.state.currentIndex,
        stores: [],
      };
    }

    console.log(`\n======================================================`);
    console.log(`Starting Scraper Run`);
    console.log(`Queue position: ${this.queueManager.state.currentIndex + 1} / ${this.queueManager.queue.length}`);
    console.log(`Combos to process in this run: ${combos.length}`);
    console.log(`Target stores per combo: ${targetPerCombo}`);
    console.log(`======================================================\n`);

    const allStores = [];
    let completedCombosCount = 0;
    let isBlocked = false;
    let lastProcessedCombo = null;

    try {
      for (let i = 0; i < combos.length; i++) {
        // Check overall run timebox cutoff
        if (Date.now() >= runDeadline) {
          console.warn(`[TIMEBOX] Overall run duration limit reached. Halting run.`);
          break;
        }

        const combo = combos[i];
        lastProcessedCombo = combo;

        const result = await this.processCombo(combo, targetPerCombo, runDeadline);

        if (result.blocked) {
          isBlocked = true;
          console.error(`[CRITICAL] Run halted due to Google rate limit / block detection.`);
          // Do NOT advance past this combo so it will be retried on next run!
          break;
        }

        allStores.push(...result.stores);
        completedCombosCount++;

        // Advance cursor incrementally after each successful combo
        this.queueManager.advance(1, result.stores.length, combo);

        // Pause between combos if more combos remain in this run
        if (i + 1 < combos.length) {
          const pauseMs = this.config.comboPauseMs || 5000;
          console.log(`[Pacing] Pausing ${pauseMs}ms before next combo...`);
          await ScraperEngine.sleep(pauseMs);
        }
      }
    } finally {
      await this.browserManager.close();
    }

    const durationMs = Date.now() - startTime;

    // Export results to JSON and CSV
    let exportInfo = null;
    if (allStores.length > 0) {
      exportInfo = this.exporter.exportResults(allStores, {
        durationMs,
        combosAttempted: combos.length,
        combosCompleted: completedCombosCount,
        blocked: isBlocked,
      });
      console.log(`\n======================================================`);
      console.log(`Exported ${allStores.length} stores:`);
      console.log(`  - Run JSON: ${exportInfo.runJsonPath}`);
      console.log(`  - Run CSV:  ${exportInfo.runCsvPath}`);
      console.log(`  - Cumulative JSON: ${exportInfo.cumulativeJsonPath}`);
      console.log(`  - Cumulative CSV:  ${exportInfo.cumulativeCsvPath}`);
      console.log(`======================================================\n`);
    }

    return {
      done: this.queueManager.state.currentIndex >= this.queueManager.queue.length,
      blocked: isBlocked,
      count: allStores.length,
      combosCompleted: completedCombosCount,
      combosRequested: combos.length,
      durationMs,
      status: this.queueManager.getStatus(),
      stores: allStores,
      exportInfo,
      message: isBlocked
        ? 'Run stopped: Google block/CAPTCHA detected. Cursor not advanced.'
        : `Successfully processed ${completedCombosCount} combos, collected ${allStores.length} stores.`,
    };
  }

  /**
   * Scrape an ad-hoc single combo without advancing the persistent queue cursor
   */
  async scrapeSingle(city, category, targetCount = 25) {
    const startTime = Date.now();
    const searchUrl = QueueManager.buildSearchUrl(category, city);
    const combo = { city, category, url: searchUrl };

    try {
      const result = await this.processCombo(combo, targetCount);
      const durationMs = Date.now() - startTime;

      let exportInfo = null;
      if (result.stores.length > 0) {
        exportInfo = this.exporter.exportResults(result.stores, {
          durationMs,
          singleCombo: { city, category },
          blocked: result.blocked,
        });
      }

      return {
        blocked: result.blocked,
        count: result.stores.length,
        durationMs,
        stores: result.stores,
        exportInfo,
      };
    } finally {
      await this.browserManager.close();
    }
  }
}

module.exports = ScraperEngine;
