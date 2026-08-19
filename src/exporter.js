const fs = require('fs');
const path = require('path');
const config = require('./config');

class Exporter {
  constructor(customConfig = {}) {
    this.config = { ...config, ...customConfig };
    this.headers = ['city', 'category', 'name', 'url', 'address', 'website', 'email', 'scrapedAt'];
  }

  /**
   * Escape and format a value for CSV conforming to RFC 4180
   */
  static escapeCsvCell(value) {
    if (value === null || value === undefined) {
      return '""';
    }
    const str = String(value);
    // If value contains double quotes, commas, newlines, or carriage returns, wrap in quotes and escape internal quotes
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  }

  /**
   * Generates a unique deduplication key for a store record
   */
  static getStoreKey(store) {
    if (store.url && store.url !== 'Not found' && String(store.url).trim() !== '') {
      return String(store.url).trim().toLowerCase();
    }
    const city = String(store.city || '').trim().toLowerCase();
    const cat = String(store.category || '').trim().toLowerCase();
    const name = String(store.name || '').trim().toLowerCase();
    const addr = String(store.address || '').trim().toLowerCase();
    return `${city}:::${cat}:::${name}:::${addr}`;
  }

  /**
   * Deduplicates an array of store objects, retaining the first occurrence
   */
  static deduplicateStores(stores) {
    if (!Array.isArray(stores)) return [];
    const seen = new Set();
    const unique = [];
    for (const store of stores) {
      if (!store) continue;
      const normalized = Exporter.normalizeStore(store);
      const key = Exporter.getStoreKey(normalized);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(normalized);
      }
    }
    return unique;
  }

  /**
   * Converts an array of store objects to a CSV string
   */
  static toCsv(stores, includeHeader = true) {
    const headers = ['city', 'category', 'name', 'url', 'address', 'website', 'email', 'scrapedAt'];
    const lines = [];

    if (includeHeader) {
      lines.push(headers.join(','));
    }

    for (const store of stores) {
      const row = headers.map((field) => {
        const val = store[field] !== undefined && store[field] !== null ? store[field] : 'Not found';
        return Exporter.escapeCsvCell(val);
      });
      lines.push(row.join(','));
    }

    return lines.join('\n');
  }

  /**
   * Formats a timestamp into Indian Standard Time (IST, UTC+5:30)
   * Example output: "2026-08-18 19:08:22 IST"
   */
  static formatIST(date = new Date()) {
    if (!date) date = new Date();
    if (typeof date === 'string' && date.endsWith('IST')) {
      return date;
    }
    const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
    const validDate = isNaN(d.getTime()) ? new Date() : d;

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(validDate);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} IST`;
  }

  /**
   * Normalizes a store object to ensure all required fields are present with 'Not found' fallback and IST timestamp
   */
  static normalizeStore(store) {
    return {
      city: store.city || 'Not found',
      category: store.category || 'Not found',
      name: store.name || 'Not found',
      url: store.url || 'Not found',
      address: store.address || 'Not found',
      website: store.website || 'Not found',
      email: store.email || 'Not found',
      scrapedAt: Exporter.formatIST(store.scrapedAt),
    };
  }

  /**
   * Exports a batch of scraped stores to both JSON and CSV files
   * @param {Array} stores - Array of store objects
   * @param {Object} metadata - Run metadata
   * @param {Object} options - Export options { appendCumulative: boolean, createRunFile: boolean }
   */
  exportResults(stores, metadata = {}, options = {}) {
    if (!stores || stores.length === 0) {
      return { runJsonPath: null, runCsvPath: null, cumulativeJsonPath: null, cumulativeCsvPath: null };
    }

    const { appendCumulative = true, createRunFile = true } = options;
    const normalizedStores = Exporter.deduplicateStores(stores);

    // Ensure output directories exist
    const outputDir = this.config.outputDir;
    const runsDir = path.resolve(outputDir, 'runs');
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runJsonPath = path.resolve(runsDir, `scrape_${timestamp}.json`);
    const runCsvPath = path.resolve(runsDir, `scrape_${timestamp}.csv`);
    const cumulativeJsonPath = path.resolve(outputDir, this.config.resultsJsonFile || 'results.json');
    const cumulativeCsvPath = path.resolve(outputDir, this.config.resultsCsvFile || 'results.csv');

    // 1. Write Run-specific files if enabled
    if (createRunFile) {
      const runPayload = {
        runAt: new Date().toISOString(),
        metadata,
        count: normalizedStores.length,
        stores: normalizedStores,
      };
      fs.writeFileSync(runJsonPath, JSON.stringify(runPayload, null, 2), 'utf8');

      const runCsvContent = Exporter.toCsv(normalizedStores, true);
      fs.writeFileSync(runCsvPath, runCsvContent, 'utf8');
    }

    // 2. Update Cumulative files if enabled with deduplication
    if (appendCumulative) {
      let existingJson = [];
      if (fs.existsSync(cumulativeJsonPath)) {
        try {
          const raw = fs.readFileSync(cumulativeJsonPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            existingJson = parsed;
          }
        } catch (err) {
          console.warn(`Warning: Could not parse existing results.json, creating new array.`);
        }
      }

      // Combine existing and new stores and deduplicate
      const updatedStores = Exporter.deduplicateStores(existingJson.concat(normalizedStores));
      fs.writeFileSync(cumulativeJsonPath, JSON.stringify(updatedStores, null, 2), 'utf8');

      // Write deduplicated CSV
      const updatedCsvContent = Exporter.toCsv(updatedStores, true);
      fs.writeFileSync(cumulativeCsvPath, updatedCsvContent, 'utf8');
    }

    return {
      count: normalizedStores.length,
      runJsonPath: createRunFile ? runJsonPath : null,
      runCsvPath: createRunFile ? runCsvPath : null,
      cumulativeJsonPath,
      cumulativeCsvPath,
    };
  }
}

module.exports = Exporter;
