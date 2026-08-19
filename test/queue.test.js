const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const QueueManager = require('../src/queue');

describe('QueueManager', () => {
  const testDataDir = path.resolve(__dirname, 'temp_data');
  const testStateFile = 'test_state.json';

  beforeEach(() => {
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('correctly builds 1,717 queue items from 101 cities and 17 categories', () => {
    const qm = new QueueManager({
      dataDir: testDataDir,
      stateFile: testStateFile,
    });

    assert.strictEqual(qm.cities.length, 101, 'Should load 101 cities');
    assert.strictEqual(qm.categories.length, 17, 'Should load 17 categories');
    assert.strictEqual(qm.queue.length, 1717, 'Total combinations should be 1,717');

    // First item should be City 1, Category 1
    assert.strictEqual(qm.queue[0].city, 'New York');
    assert.strictEqual(qm.queue[0].category, 'Fashion & Apparel');
    assert.strictEqual(
      qm.queue[0].url,
      'https://www.google.com/maps/search/Fashion+%26+Apparel+in+New+York/'
    );

    // 17th item (index 16) should still be New York, last category (Gift Shop)
    assert.strictEqual(qm.queue[16].city, 'New York');
    assert.strictEqual(qm.queue[16].category, 'Gift Shop');

    // 18th item (index 17) should be Los Angeles, Category 1
    assert.strictEqual(qm.queue[17].city, 'Los Angeles');
    assert.strictEqual(qm.queue[17].category, 'Fashion & Apparel');
  });

  it('buildSearchUrl correctly encodes category in city and replaces spaces with +', () => {
    const url1 = QueueManager.buildSearchUrl('Electronics', 'New York');
    assert.strictEqual(url1, 'https://www.google.com/maps/search/Electronics+in+New+York/');

    const url2 = QueueManager.buildSearchUrl('Fashion & Apparel', 'San Francisco');
    assert.strictEqual(url2, 'https://www.google.com/maps/search/Fashion+%26+Apparel+in+San+Francisco/');
  });

  it('manages cursor advancement and state persistence', () => {
    const qm = new QueueManager({
      dataDir: testDataDir,
      stateFile: testStateFile,
    });

    assert.strictEqual(qm.state.currentIndex, 0);

    const batch = qm.getNextBatch(3);
    assert.strictEqual(batch.length, 3);
    assert.strictEqual(batch[0].city, 'New York');

    qm.advance(3, 15, batch[2]);

    assert.strictEqual(qm.state.currentIndex, 3);
    assert.strictEqual(qm.state.completedCombos, 3);
    assert.strictEqual(qm.state.totalStoresCollected, 15);
    assert.strictEqual(qm.state.lastCompletedCombo.city, 'New York');

    // Create a new instance pointing to same state file to verify persistence
    const qmReloaded = new QueueManager({
      dataDir: testDataDir,
      stateFile: testStateFile,
    });

    assert.strictEqual(qmReloaded.state.currentIndex, 3);
    assert.strictEqual(qmReloaded.state.completedCombos, 3);
    assert.strictEqual(qmReloaded.state.totalStoresCollected, 15);

    // Test Reset
    qmReloaded.reset(0);
    assert.strictEqual(qmReloaded.state.currentIndex, 0);
  });

  it('guarantees each combination runs only once and skips completed combos', () => {
    const qm = new QueueManager({
      dataDir: testDataDir,
      stateFile: testStateFile,
    });

    // Initial batch of 2
    const batch1 = qm.getNextBatch(2);
    assert.strictEqual(batch1.length, 2);
    assert.strictEqual(batch1[0].city, 'New York');
    assert.strictEqual(batch1[0].category, 'Fashion & Apparel');
    assert.strictEqual(batch1[1].city, 'New York');
    assert.strictEqual(batch1[1].category, 'Jewelry');

    // Mark the first combo as completed
    qm.advance(1, 10, batch1[0]);
    assert.strictEqual(qm.isComboCompleted('New York', 'Fashion & Apparel'), true);
    assert.strictEqual(qm.isComboCompleted('New York', 'Jewelry'), false);

    // Next batch should NOT include New York Fashion & Apparel
    const batch2 = qm.getNextBatch(2);
    assert.strictEqual(batch2.length, 2);
    assert.strictEqual(batch2[0].city, 'New York');
    assert.strictEqual(batch2[0].category, 'Jewelry');
    assert.strictEqual(batch2[1].city, 'New York');
    assert.strictEqual(batch2[1].category, 'Beauty & Cosmetics');

    // Complete Jewelry
    qm.advance(1, 12, batch2[0]);
    assert.strictEqual(qm.isComboCompleted('New York', 'Jewelry'), true);

    // Verify persistence of completed combos
    const qm2 = new QueueManager({
      dataDir: testDataDir,
      stateFile: testStateFile,
    });
    assert.strictEqual(qm2.isComboCompleted('New York', 'Fashion & Apparel'), true);
    assert.strictEqual(qm2.isComboCompleted('New York', 'Jewelry'), true);
    assert.strictEqual(qm2.isComboCompleted('New York', 'Beauty & Cosmetics'), false);

    const batch3 = qm2.getNextBatch(1);
    assert.strictEqual(batch3.length, 1);
    assert.strictEqual(batch3[0].city, 'New York');
    assert.strictEqual(batch3[0].category, 'Beauty & Cosmetics');
  });
});
