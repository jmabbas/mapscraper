const { describe, it } = require('node:test');
const assert = require('node:assert');
const EmailExtractor = require('../src/emailExtractor');

describe('EmailExtractor', () => {
  it('correctly cleans and validates valid emails', () => {
    assert.strictEqual(
      EmailExtractor.cleanEmail('info@boutique.com'),
      'info@boutique.com'
    );
    assert.strictEqual(
      EmailExtractor.cleanEmail('mailto:contact@store.org?subject=Hello'),
      'contact@store.org'
    );
    assert.strictEqual(
      EmailExtractor.cleanEmail('  support@my-shop.co.uk. '),
      'support@my-shop.co.uk'
    );
    assert.strictEqual(
      EmailExtractor.cleanEmail('(sales@brand.nyc)'),
      'sales@brand.nyc'
    );
    assert.strictEqual(
      EmailExtractor.cleanEmail('"orders@company.io,"'),
      'orders@company.io'
    );
  });

  it('rejects invalid emails, assets, and dummy domains', () => {
    // Bad extensions / asset files
    assert.strictEqual(EmailExtractor.cleanEmail('logo@2x.png'), null);
    assert.strictEqual(EmailExtractor.cleanEmail('banner@image.jpg'), null);
    assert.strictEqual(EmailExtractor.cleanEmail('icon@1x.svg'), null);

    // Dummy placeholder domains
    assert.strictEqual(EmailExtractor.cleanEmail('user@example.com'), null);
    assert.strictEqual(EmailExtractor.cleanEmail('info@domain.com'), null);
    assert.strictEqual(EmailExtractor.cleanEmail('test@yoursite.com'), null);

    // Malformed strings
    assert.strictEqual(EmailExtractor.cleanEmail('not-an-email'), null);
    assert.strictEqual(EmailExtractor.cleanEmail('@missingusername.com'), null);
    assert.strictEqual(EmailExtractor.cleanEmail('missing-tld@domain'), null);
    assert.strictEqual(EmailExtractor.cleanEmail(null), null);
    assert.strictEqual(EmailExtractor.cleanEmail(''), null);
  });
});
