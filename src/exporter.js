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
   * Normalizes a store object to ensure all required fields are present with 'Not found' fallback
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
      scrapedAt: store.scrapedAt || new Date().toISOString(),
    };
  }

  /**
   * Exports a batch of scraped stores to both JSON and CSV files
   */
  exportResults(stores, metadata = {}) {
    if (!stores || stores.length === 0) {
      return { runJsonPath: null, runCsvPath: null, cumulativeJsonPath: null, cumulativeCsvPath: null };
    }

    const normalizedStores = stores.map(Exporter.normalizeStore);

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

    // 1. Write Run-specific JSON
    const runPayload = {
      runAt: new Date().toISOString(),
      metadata,
      count: normalizedStores.length,
      stores: normalizedStores,
    };
    fs.writeFileSync(runJsonPath, JSON.stringify(runPayload, null, 2), 'utf8');

    // 2. Write Run-specific CSV
    const runCsvContent = Exporter.toCsv(normalizedStores, true);
    fs.writeFileSync(runCsvPath, runCsvContent, 'utf8');

    // 3. Append to Cumulative JSON
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
    const updatedJson = existingJson.concat(normalizedStores);
    fs.writeFileSync(cumulativeJsonPath, JSON.stringify(updatedJson, null, 2), 'utf8');

    // 4. Append to Cumulative CSV
    const cumulativeCsvExists = fs.existsSync(cumulativeCsvPath);
    const cumulativeCsvContent = Exporter.toCsv(normalizedStores, !cumulativeCsvExists);
    if (cumulativeCsvExists) {
      fs.appendFileSync(cumulativeCsvPath, '\n' + cumulativeCsvContent, 'utf8');
    } else {
      fs.writeFileSync(cumulativeCsvPath, cumulativeCsvContent, 'utf8');
    }

    return {
      count: normalizedStores.length,
      runJsonPath,
      runCsvPath,
      cumulativeJsonPath,
      cumulativeCsvPath,
    };
  }
}

module.exports = Exporter;
