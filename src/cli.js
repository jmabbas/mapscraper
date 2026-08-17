const { Command } = require('commander');
const ScraperEngine = require('./scraperEngine');
const QueueManager = require('./queue');
const config = require('./config');

function createCli() {
  const program = new Command();

  program
    .name('mapscraper')
    .description('Google Maps Store Scraper with Category x City queue, rate-limiting safeguards, and JSON/CSV output')
    .version('1.0.0');

  // Command: Run Next Combos
  program
    .command('run')
    .description('Run the scraper on the next batch of combinations from the queue')
    .option('-c, --combos <number>', 'Number of combinations to process in this run', (v) => parseInt(v, 10), config.combosPerRun)
    .option('-t, --target <number>', 'Target stores to scrape per combination', (v) => parseInt(v, 10), config.targetPerCombo)
    .option('--no-headless', 'Run browser in visible (non-headless) mode for debugging')
    .action(async (options) => {
      try {
        const engine = new ScraperEngine({
          combosPerRun: options.combos,
          targetPerCombo: options.target,
          headless: options.headless !== false,
        });

        const result = await engine.runNext({
          combosCount: options.combos,
          targetPerCombo: options.target,
        });

        if (result.blocked) {
          console.error(`\n[ALERT] Scraper stopped early due to Google rate limit / block detection.`);
          process.exit(1);
        } else {
          console.log(`\n[SUCCESS] ${result.message}`);
          process.exit(0);
        }
      } catch (err) {
        console.error(`\n[ERROR] Scraper failed:`, err);
        process.exit(1);
      }
    });

  // Command: Single Ad-hoc Scrape
  program
    .command('single')
    .description('Scrape a single specific city and category without advancing the queue cursor')
    .requiredOption('--city <name>', 'City name (e.g. "New York")')
    .requiredOption('--category <name>', 'Category name (e.g. "Jewelry")')
    .option('-t, --target <number>', 'Target stores to scrape', (v) => parseInt(v, 10), 10)
    .option('--no-headless', 'Run browser in visible (non-headless) mode')
    .action(async (options) => {
      try {
        console.log(`Running single scrape for: "${options.category}" in "${options.city}" (target: ${options.target})...`);
        const engine = new ScraperEngine({
          targetPerCombo: options.target,
          headless: options.headless !== false,
        });

        const result = await engine.scrapeSingle(options.city, options.category, options.target);
        if (result.blocked) {
          console.error(`\n[ALERT] Scraper stopped: Google block detected.`);
          process.exit(1);
        } else {
          console.log(`\n[SUCCESS] Collected ${result.count} stores in ${Math.round(result.durationMs / 1000)}s.`);
          process.exit(0);
        }
      } catch (err) {
        console.error(`\n[ERROR] Single scrape failed:`, err);
        process.exit(1);
      }
    });

  // Command: Status
  program
    .command('status')
    .description('Show current queue progress, cursor position, and statistics')
    .action(() => {
      try {
        const qm = new QueueManager();
        const status = qm.getStatus();
        console.log('\n===== Google Maps Scraper Queue Status =====');
        console.log(`Current Index:          ${status.currentIndex}`);
        console.log(`Total Combinations:     ${status.totalCombos}`);
        console.log(`Completed Combinations: ${status.completedCombos}`);
        console.log(`Remaining Combinations: ${status.remainingCombos}`);
        console.log(`Progress:               ${status.progressPercent}`);
        console.log(`Total Stores Scraped:   ${status.totalStoresCollected}`);
        console.log(`Last Run At:            ${status.lastRunAt || 'Never'}`);
        if (status.lastCompletedCombo) {
          console.log(`Last Completed Combo:   "${status.lastCompletedCombo.category}" in "${status.lastCompletedCombo.city}"`);
        }
        if (status.nextCombo) {
          console.log(`Next Combo to Run:      "${status.nextCombo.category}" in "${status.nextCombo.city}"`);
          console.log(`Next Combo URL:         ${status.nextCombo.url}`);
        } else {
          console.log(`Status:                 ALL COMBINATIONS COMPLETED!`);
        }
        console.log('============================================\n');
      } catch (err) {
        console.error('Failed to get status:', err.message);
        process.exit(1);
      }
    });

  // Command: Reset
  program
    .command('reset')
    .description('Reset the queue cursor to a specific index (default: 0)')
    .option('-i, --index <number>', 'Index to reset cursor to', (v) => parseInt(v, 10), 0)
    .action((options) => {
      try {
        const qm = new QueueManager();
        qm.reset(options.index);
        console.log(`\n[RESET] Queue cursor reset to index ${options.index}.`);
        const status = qm.getStatus();
        if (status.nextCombo) {
          console.log(`Next combo is now: "${status.nextCombo.category}" in "${status.nextCombo.city}"`);
        }
      } catch (err) {
        console.error('Failed to reset queue:', err.message);
        process.exit(1);
      }
    });

  return program;
}

module.exports = { createCli };
