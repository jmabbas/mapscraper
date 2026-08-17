require('dotenv').config();
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const config = {
  // Directory paths
  rootDir: ROOT_DIR,
  inputDir: process.env.INPUT_DIR ? path.resolve(ROOT_DIR, process.env.INPUT_DIR) : path.resolve(ROOT_DIR, 'input'),
  dataDir: process.env.DATA_DIR ? path.resolve(ROOT_DIR, process.env.DATA_DIR) : path.resolve(ROOT_DIR, 'data'),
  outputDir: process.env.OUTPUT_DIR ? path.resolve(ROOT_DIR, process.env.OUTPUT_DIR) : path.resolve(ROOT_DIR, 'output'),

  // Filenames
  categoriesFile: process.env.CATEGORIES_FILE || 'categories.json',
  citiesFile: process.env.CITIES_FILE || 'cities.json',
  stateFile: process.env.STATE_FILE || 'state.json',
  resultsJsonFile: 'results.json',
  resultsCsvFile: 'results.csv',

  // Scraping pacing & limit defaults
  combosPerRun: parseInt(process.env.COMBOS_PER_RUN || process.env.COMBOS_PER_DAY || '3', 10),
  targetPerCombo: parseInt(process.env.TARGET_PER_COMBO || process.env.TARGET_PER_DAY || '25', 10),
  batchSize: parseInt(process.env.BATCH_SIZE || '5', 10),
  batchPauseMs: parseInt(process.env.BATCH_PAUSE_MS || '3000', 10),
  comboPauseMs: parseInt(process.env.COMBO_PAUSE_MS || '5000', 10),

  // Time-boxing safety cutoffs (ms)
  perComboMaxDurationMs: parseInt(process.env.PER_COMBO_MAX_DURATION_MS || '240000', 10), // 4 minutes per combo
  totalMaxDurationMs: parseInt(process.env.TOTAL_MAX_DURATION_MS || '1080000', 10),      // 18 minutes total per run
  pageTimeoutMs: parseInt(process.env.PAGE_TIMEOUT_MS || '30000', 10),                   // 30 seconds page load timeout
  websiteTimeoutMs: parseInt(process.env.WEBSITE_TIMEOUT_MS || '12000', 10),              // 12 seconds store website timeout

  // Browser configuration
  headless: process.env.HEADLESS !== 'false',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: {
    width: parseInt(process.env.VIEWPORT_WIDTH || '1440', 10),
    height: parseInt(process.env.VIEWPORT_HEIGHT || '900', 10),
  },
  proxyServer: process.env.PROXY_SERVER || null,

  // Server configuration
  port: parseInt(process.env.PORT || '3000', 10),
};

module.exports = config;
