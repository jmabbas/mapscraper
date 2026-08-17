const { describe, it } = require('node:test');
const assert = require('node:assert');
const BrowserManager = require('../src/browser');

describe('BlockDetector', () => {
  it('detects google /sorry/ URL as blocked', async () => {
    const bm = new BrowserManager();
    const mockPage = {
      isClosed: () => false,
      url: () => 'https://www.google.com/sorry/index?continue=https://www.google.com/maps',
      evaluate: async () => 'some text',
    };

    const isBlocked = await bm.checkIsBlocked(mockPage);
    assert.strictEqual(isBlocked, true);
  });

  it('detects unusual traffic message in page text', async () => {
    const bm = new BrowserManager();
    const mockPage = {
      isClosed: () => false,
      url: () => 'https://www.google.com/maps/search/Electronics+in+New+York/',
      evaluate: async () => 'Our systems have detected unusual traffic from your computer network. Please solve the challenge below.',
    };

    const isBlocked = await bm.checkIsBlocked(mockPage);
    assert.strictEqual(isBlocked, true);
  });

  it('passes normal maps pages as not blocked', async () => {
    const bm = new BrowserManager();
    const mockPage = {
      isClosed: () => false,
      url: () => 'https://www.google.com/maps/search/Electronics+in+New+York/',
      evaluate: async () => 'Best Buy Electronics store 529 5th Ave New York NY',
    };

    const isBlocked = await bm.checkIsBlocked(mockPage);
    assert.strictEqual(isBlocked, false);
  });
});
