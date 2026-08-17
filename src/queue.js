const fs = require('fs');
const path = require('path');
const config = require('./config');

class QueueManager {
  constructor(customConfig = {}) {
    this.config = { ...config, ...customConfig };
    this.categories = [];
    this.cities = [];
    this.queue = [];
    this.state = {
      currentIndex: 0,
      lastCompletedCombo: null,
      lastRunAt: null,
      totalCombos: 0,
      completedCombos: 0,
      totalStoresCollected: 0,
    };
    this.init();
  }

  /**
   * Resolve input file path checking inputDir first, then dataDir, then rootDir.
   */
  resolveFilePath(filename, dirPref) {
    const candidates = [
      path.resolve(dirPref || this.config.inputDir, filename),
      path.resolve(this.config.dataDir, filename),
      path.resolve(this.config.rootDir, filename),
      path.resolve(this.config.inputDir, filename),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return candidates[0]; // fallback to default
  }

  /**
   * Initialize inputs and build queue
   */
  init() {
    this.loadInputs();
    this.buildQueue();
    this.loadState();
  }

  /**
   * Load categories.json and cities.json
   */
  loadInputs() {
    const catPath = this.resolveFilePath(this.config.categoriesFile, this.config.inputDir);
    const cityPath = this.resolveFilePath(this.config.citiesFile, this.config.inputDir);

    if (!fs.existsSync(catPath)) {
      throw new Error(`Categories file not found at: ${catPath}`);
    }
    if (!fs.existsSync(cityPath)) {
      throw new Error(`Cities file not found at: ${cityPath}`);
    }

    try {
      this.categories = JSON.parse(fs.readFileSync(catPath, 'utf8'));
      if (!Array.isArray(this.categories) || this.categories.length === 0) {
        throw new Error('Categories file must contain a non-empty array of strings.');
      }
    } catch (err) {
      throw new Error(`Failed to parse categories file (${catPath}): ${err.message}`);
    }

    try {
      this.cities = JSON.parse(fs.readFileSync(cityPath, 'utf8'));
      if (!Array.isArray(this.cities) || this.cities.length === 0) {
        throw new Error('Cities file must contain a non-empty array of strings.');
      }
    } catch (err) {
      throw new Error(`Failed to parse cities file (${cityPath}): ${err.message}`);
    }
  }

  /**
   * Builds Google Maps search URL from category and city
   * Encodes query as category + " in " + city, replaces %20 with +
   */
  static buildSearchUrl(category, city) {
    const query = `${category} in ${city}`;
    const encoded = encodeURIComponent(query).replace(/%20/g, '+');
    return `https://www.google.com/maps/search/${encoded}/`;
  }

  /**
   * Cross joins cities (outer loop) and categories (inner loop)
   */
  buildQueue() {
    this.queue = [];
    let index = 0;
    for (const city of this.cities) {
      for (const category of this.categories) {
        this.queue.push({
          index,
          city,
          category,
          url: QueueManager.buildSearchUrl(category, city),
        });
        index++;
      }
    }
    this.state.totalCombos = this.queue.length;
  }

  /**
   * Load persisted state from disk
   */
  loadState() {
    const statePath = path.resolve(this.config.dataDir, this.config.stateFile);
    if (fs.existsSync(statePath)) {
      try {
        const raw = fs.readFileSync(statePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = {
          ...this.state,
          ...parsed,
          totalCombos: this.queue.length,
        };
        // Normalize currentIndex if out of bounds
        if (typeof this.state.currentIndex !== 'number' || this.state.currentIndex < 0) {
          this.state.currentIndex = 0;
        }
      } catch (err) {
        console.warn(`Warning: Could not load state from ${statePath}: ${err.message}. Using default.`);
      }
    }
  }

  /**
   * Save state to disk
   */
  saveState() {
    const dir = this.config.dataDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const statePath = path.resolve(dir, this.config.stateFile);
    fs.writeFileSync(statePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  /**
   * Get next N combinations to process starting from current cursor
   */
  getNextBatch(count = this.config.combosPerRun) {
    if (this.state.currentIndex >= this.queue.length) {
      return [];
    }
    const start = this.state.currentIndex;
    const end = Math.min(start + count, this.queue.length);
    return this.queue.slice(start, end);
  }

  /**
   * Advance the cursor after successfully processing combos
   */
  advance(completedCount, storesCollectedCount = 0, lastCombo = null) {
    if (completedCount <= 0) return this.state;

    const newIndex = Math.min(this.state.currentIndex + completedCount, this.queue.length);
    const completedCombo = lastCombo || (newIndex > 0 ? this.queue[newIndex - 1] : null);

    this.state.currentIndex = newIndex;
    this.state.completedCombos = (this.state.completedCombos || 0) + completedCount;
    this.state.totalStoresCollected = (this.state.totalStoresCollected || 0) + storesCollectedCount;
    this.state.lastRunAt = new Date().toISOString();

    if (completedCombo) {
      this.state.lastCompletedCombo = {
        city: completedCombo.city,
        category: completedCombo.category,
      };
    }

    this.saveState();
    return this.state;
  }

  /**
   * Reset cursor to specific index
   */
  reset(index = 0) {
    this.state.currentIndex = Math.max(0, Math.min(index, this.queue.length));
    this.state.lastCompletedCombo = this.state.currentIndex > 0 ? this.queue[this.state.currentIndex - 1] : null;
    this.state.completedCombos = this.state.currentIndex;
    this.saveState();
    return this.state;
  }

  /**
   * Get comprehensive status
   */
  getStatus() {
    const remaining = Math.max(0, this.queue.length - this.state.currentIndex);
    const percent = this.queue.length > 0 ? ((this.state.currentIndex / this.queue.length) * 100).toFixed(2) : '0.00';
    const nextCombo = this.state.currentIndex < this.queue.length ? this.queue[this.state.currentIndex] : null;

    return {
      currentIndex: this.state.currentIndex,
      totalCombos: this.queue.length,
      remainingCombos: remaining,
      completedCombos: this.state.completedCombos || this.state.currentIndex,
      progressPercent: `${percent}%`,
      lastCompletedCombo: this.state.lastCompletedCombo,
      lastRunAt: this.state.lastRunAt,
      totalStoresCollected: this.state.totalStoresCollected || 0,
      nextCombo: nextCombo ? { city: nextCombo.city, category: nextCombo.category, url: nextCombo.url } : null,
      isFinished: this.state.currentIndex >= this.queue.length,
    };
  }
}

module.exports = QueueManager;
