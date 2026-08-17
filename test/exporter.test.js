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
});
