const fs = require('fs');
const path = require('path');
const config = require('./config');

class QueueManager {
  constructor(customConfig = {}) {
    this.config = { ...config, ...customConfig };
    this.categories = [];
    this.cities = [];
    this.queue = [];
    this.completedCombosSet = new Set();
    this.state = {
      currentIndex: 0,
      lastCompletedCombo: null,
      lastRunAt: null,
      totalCombos: 0,
      completedCombos: 0,
      totalStoresCollected: 0,
      completedCombosList: [],
    };
    this.init();
  }

  /**
   * Generates a normalized unique key for a city + category combination
   */
  static getComboKey(city, category) {
    return `${String(city || '').trim()}:::${String(category || '').trim()}`;
  }

  /**
   * Checks if a combination has already been completed
   */
  isComboCompleted(city, category) {
    const key = QueueManager.getComboKey(city, category);
    return this.completedCombosSet.has(key);
  }

  /**
   * Marks a combination as completed
   */
  markComboCompleted(city, category) {
    const key = QueueManager.getComboKey(city, category);
    if (!this.completedCombosSet.has(key)) {
      this.completedCombosSet.add(key);
      if (!Array.isArray(this.state.completedCombosList)) {
        this.state.completedCombosList = [];
      }
      this.state.completedCombosList.push(key);
    }
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

        this.completedCombosSet = new Set();
        if (Array.isArray(this.state.completedCombosList) && this.state.completedCombosList.length > 0) {
          for (const key of this.state.completedCombosList) {
            this.completedCombosSet.add(key);
          }
        } else if (typeof this.state.currentIndex === 'number' && this.state.currentIndex > 0) {
          // Backfill completed combinations from previous linear cursor
          const prevCombos = this.queue.slice(0, this.state.currentIndex);
          this.state.completedCombosList = [];
          for (const c of prevCombos) {
            const key = QueueManager.getComboKey(c.city, c.category);
            this.completedCombosSet.add(key);
            this.state.completedCombosList.push(key);
          }
        }

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
    this.state.completedCombos = this.completedCombosSet.size;
    this.state.completedCombosList = Array.from(this.completedCombosSet);
    fs.writeFileSync(statePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  /**
   * Get next N combinations to process, skipping any already completed combos
   */
  getNextBatch(count = this.config.combosPerRun) {
    const pending = [];
    for (let i = 0; i < this.queue.length; i++) {
      const combo = this.queue[i];
      if (!this.isComboCompleted(combo.city, combo.category)) {
        pending.push(combo);
        if (pending.length >= count) {
          break;
        }
      }
    }
    return pending;
  }

  /**
   * Advance the cursor and record completed combinations
   */
  advance(completedCount, storesCollectedCount = 0, lastCombo = null) {
    if (completedCount <= 0 && !lastCombo) return this.state;

    if (lastCombo) {
      this.markComboCompleted(lastCombo.city, lastCombo.category);
      this.state.lastCompletedCombo = {
        city: lastCombo.city,
        category: lastCombo.category,
      };

      // If completedCount > 1, ensure the preceding uncompleted combos in the batch are also marked
      let marked = 1;
      for (let i = 0; i < this.queue.length && marked < completedCount; i++) {
        const c = this.queue[i];
        if (!this.isComboCompleted(c.city, c.category)) {
          this.markComboCompleted(c.city, c.category);
          marked++;
        }
      }
    } else {
      // Mark next completedCount uncompleted combos
      let marked = 0;
      for (let i = 0; i < this.queue.length && marked < completedCount; i++) {
        const c = this.queue[i];
        if (!this.isComboCompleted(c.city, c.category)) {
          this.markComboCompleted(c.city, c.category);
          this.state.lastCompletedCombo = { city: c.city, category: c.category };
          marked++;
        }
      }
    }

    // Find the next uncompleted index in queue to update currentIndex
    let nextIndex = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      const c = this.queue[i];
      if (!this.isComboCompleted(c.city, c.category)) {
        nextIndex = i;
        break;
      }
    }

    this.state.currentIndex = nextIndex;
    this.state.completedCombos = this.completedCombosSet.size;
    this.state.totalStoresCollected = (this.state.totalStoresCollected || 0) + storesCollectedCount;
    this.state.lastRunAt = new Date().toISOString();

    this.saveState();
    return this.state;
  }

  /**
   * Reset cursor to specific index and reset completed combinations
   */
  reset(index = 0) {
    const safeIndex = Math.max(0, Math.min(index, this.queue.length));
    this.state.currentIndex = safeIndex;
    this.completedCombosSet.clear();
    this.state.completedCombosList = [];

    if (safeIndex > 0) {
      const prevCombos = this.queue.slice(0, safeIndex);
      for (const c of prevCombos) {
        const key = QueueManager.getComboKey(c.city, c.category);
        this.completedCombosSet.add(key);
        this.state.completedCombosList.push(key);
      }
      const last = prevCombos[prevCombos.length - 1];
      this.state.lastCompletedCombo = { city: last.city, category: last.category };
    } else {
      this.state.lastCompletedCombo = null;
    }

    this.state.completedCombos = this.completedCombosSet.size;
    this.saveState();
    return this.state;
  }

  /**
   * Get comprehensive status
   */
  getStatus() {
    const pendingCombos = this.queue.filter((c) => !this.isComboCompleted(c.city, c.category));
    const remaining = pendingCombos.length;
    const completed = this.completedCombosSet.size;
    const percent = this.queue.length > 0 ? ((completed / this.queue.length) * 100).toFixed(2) : '0.00';
    const nextCombo = pendingCombos.length > 0 ? pendingCombos[0] : null;

    return {
      currentIndex: this.state.currentIndex,
      totalCombos: this.queue.length,
      remainingCombos: remaining,
      completedCombos: completed,
      progressPercent: `${percent}%`,
      lastCompletedCombo: this.state.lastCompletedCombo,
      lastRunAt: this.state.lastRunAt,
      totalStoresCollected: this.state.totalStoresCollected || 0,
      nextCombo: nextCombo ? { city: nextCombo.city, category: nextCombo.category, url: nextCombo.url } : null,
      isFinished: remaining === 0,
    };
  }
}

module.exports = QueueManager;
