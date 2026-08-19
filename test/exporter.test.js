const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Exporter = require('../src/exporter');

describe('Exporter', () => {
  const testOutputDir = path.resolve(__dirname, 'temp_output');

  beforeEach(() => {
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it('escapes CSV cells per RFC 4180 properly', () => {
    assert.strictEqual(Exporter.escapeCsvCell('Simple text'), '"Simple text"');
    assert.strictEqual(Exporter.escapeCsvCell('Text with "quotes"'), '"Text with ""quotes"""');
    assert.strictEqual(Exporter.escapeCsvCell('123 Main St, Suite 400'), '"123 Main St, Suite 400"');
    assert.strictEqual(Exporter.escapeCsvCell('Line 1\nLine 2'), '"Line 1\nLine 2"');
    assert.strictEqual(Exporter.escapeCsvCell(null), '""');
  });

  it('generates well-formatted CSV with headers', () => {
    const stores = [
      {
        city: 'New York',
        category: 'Electronics',
        name: 'Best Buy, NYC',
        url: 'https://maps.google.com/place/1',
        address: '529 5th Ave, New York, NY',
        website: 'https://bestbuy.com',
        email: 'support@bestbuy.com',
        scrapedAt: '2026-08-16T12:00:00.000Z',
      },
      {
        city: 'New York',
        category: 'Electronics',
        name: 'Apple Fifth Avenue',
        url: 'https://maps.google.com/place/2',
        address: '767 5th Ave, New York, NY',
        website: 'https://apple.com',
        email: 'Not found',
        scrapedAt: '2026-08-16T12:00:00.000Z',
      },
    ];

    const csv = Exporter.toCsv(stores, true);
    const lines = csv.split('\n');

    assert.strictEqual(lines[0], 'city,category,name,url,address,website,email,scrapedAt');
    assert.strictEqual(lines.length, 3);
    assert.ok(lines[1].includes('"Best Buy, NYC"'));
    assert.ok(lines[2].includes('"Not found"'));
  });

  it('writes run files and appends to cumulative JSON and CSV', () => {
    const exporter = new Exporter({
      outputDir: testOutputDir,
    });

    const batch1 = [
      {
        city: 'New York',
        category: 'Jewelry',
        name: 'Tiffany & Co.',
        url: 'https://maps.google.com/place/tiffany',
        address: '727 5th Ave, New York, NY',
        website: 'https://tiffany.com',
        email: 'contact@tiffany.com',
        scrapedAt: '2026-08-16T12:00:00.000Z',
      },
    ];

    const info1 = exporter.exportResults(batch1, { testRun: 1 });
    assert.ok(fs.existsSync(info1.runJsonPath));
    assert.ok(fs.existsSync(info1.runCsvPath));
    assert.ok(fs.existsSync(info1.cumulativeJsonPath));
    assert.ok(fs.existsSync(info1.cumulativeCsvPath));

    const cumulativeJson1 = JSON.parse(fs.readFileSync(info1.cumulativeJsonPath, 'utf8'));
    assert.strictEqual(cumulativeJson1.length, 1);

    // Export second batch and verify cumulative accumulation
    const batch2 = [
      {
        city: 'Los Angeles',
        category: 'Jewelry',
        name: 'Cartier Beverly Hills',
        url: 'https://maps.google.com/place/cartier',
        address: '370 N Rodeo Dr, Beverly Hills, CA',
        website: 'https://cartier.com',
        email: 'contact@cartier.com',
        scrapedAt: '2026-08-16T12:05:00.000Z',
      },
    ];

    exporter.exportResults(batch2, { testRun: 2 });
    const cumulativeJson2 = JSON.parse(fs.readFileSync(info1.cumulativeJsonPath, 'utf8'));
    assert.strictEqual(cumulativeJson2.length, 2);

    const cumulativeCsvLines = fs.readFileSync(info1.cumulativeCsvPath, 'utf8').trim().split('\n');
    assert.strictEqual(cumulativeCsvLines.length, 3); // 1 header + 2 rows
  });

  it('deduplicates stores and prevents duplicate entries in cumulative JSON and CSV', () => {
    const exporter = new Exporter({
      outputDir: testOutputDir,
    });

    const store = {
      city: 'Los Angeles',
      category: 'Jewelry',
      name: 'Artisan LA Jewelry',
      url: 'https://maps.google.com/place/artisan-la',
      address: '1856 N Vermont Ave, Los Angeles, CA',
      website: 'http://www.artisanla.com/',
      email: 'artisanlajewelry@gmail.com',
      scrapedAt: '2026-08-18T06:30:13.586Z',
    };

    // First export
    exporter.exportResults([store], { combo: 1 }, { appendCumulative: true });

    // Duplicate export of the EXACT same store (e.g. batch run summary or duplicate combo)
    exporter.exportResults([store], { combo: 1, batch: true }, { appendCumulative: true });

    const cumulativeJson = JSON.parse(fs.readFileSync(path.resolve(testOutputDir, 'results.json'), 'utf8'));
    assert.strictEqual(cumulativeJson.length, 1, 'Cumulative JSON should contain only 1 store (no duplicate)');

    const cumulativeCsvLines = fs.readFileSync(path.resolve(testOutputDir, 'results.csv'), 'utf8').trim().split('\n');
    assert.strictEqual(cumulativeCsvLines.length, 2, 'Cumulative CSV should contain 1 header + 1 unique row');
  });

  it('supports appendCumulative: false for batch run summary without modifying cumulative files', () => {
    const exporter = new Exporter({
      outputDir: testOutputDir,
    });

    const store1 = {
      city: 'Chicago',
      category: 'Jewelry',
      name: 'Chicago Gems',
      url: 'https://maps.google.com/place/chicago-gems',
      address: '100 Michigan Ave, Chicago, IL',
      website: 'https://chicagogems.com',
      email: 'info@chicagogems.com',
      scrapedAt: '2026-08-18T08:00:00.000Z',
    };

    // Incremental export
    exporter.exportResults([store1], { incremental: true }, { appendCumulative: true });

    const store2 = {
      city: 'Chicago',
      category: 'Electronics',
      name: 'Chicago Tech',
      url: 'https://maps.google.com/place/chicago-tech',
      address: '200 State St, Chicago, IL',
      website: 'https://chicagotech.com',
      email: 'info@chicagotech.com',
      scrapedAt: '2026-08-18T08:10:00.000Z',
    };

    // Summary export with appendCumulative: false
    const summaryInfo = exporter.exportResults([store1, store2], { summary: true }, { appendCumulative: false });
    assert.ok(fs.existsSync(summaryInfo.runJsonPath));
    assert.ok(fs.existsSync(summaryInfo.runCsvPath));

    // Cumulative JSON should still only have the store exported with appendCumulative: true
    const cumulativeJson = JSON.parse(fs.readFileSync(path.resolve(testOutputDir, 'results.json'), 'utf8'));
    assert.strictEqual(cumulativeJson.length, 1);
  });

  it('correctly formats timestamps in Indian Standard Time (IST, UTC+5:30)', () => {
    // 2026-08-18 12:30:00 UTC corresponds to 2026-08-18 18:00:00 IST
    const istTime = Exporter.formatIST('2026-08-18T12:30:00.000Z');
    assert.strictEqual(istTime, '2026-08-18 18:00:00 IST');

    // Normalizing a store formats its scrapedAt as IST
    const normalized = Exporter.normalizeStore({
      city: 'Mumbai',
      category: 'Electronics',
      name: 'Croma',
      scrapedAt: '2026-08-18T04:00:00.000Z',
    });
    assert.strictEqual(normalized.scrapedAt, '2026-08-18 09:30:00 IST');
  });
});
