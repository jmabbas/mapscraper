class MapsScraper {
  constructor(browserManager, config = {}) {
    this.browserManager = browserManager;
    this.config = config;
  }

  /**
   * Helper delay
   */
  static sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Navigate to Google Maps search URL and check for blocks
   */
  async navigateToSearch(page, searchUrl) {
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.config.pageTimeoutMs || 30000,
    });

    // Check for Google block / CAPTCHA
    const isBlocked = await this.browserManager.checkIsBlocked(page);
    if (isBlocked) {
      return { blocked: true };
    }

    // Handle Google Consent / Cookie dialog if present
    try {
      const consentButton = await page.$('button[aria-label*="Accept all"], button[aria-label*="Agree"], form[action*="consent"] button');
      if (consentButton) {
        await consentButton.click();
        await MapsScraper.sleep(1000);
      }
    } catch (err) {
      // ignore
    }

    return { blocked: false };
  }

  /**
   * Collects listing URLs from search results page by scrolling the feed container
   */
  async collectListingLinks(page, targetCount = 25) {
    // Wait briefly for either the feed or listing items or direct place page
    try {
      await page.waitForSelector('div[role="feed"], a.hfpxzc, a[href*="/maps/place/"], h1.DUwDvf', {
        timeout: 10000,
      });
    } catch (err) {
      // If nothing appeared, check if page has no results
      const hasNoResults = await page.evaluate(() => {
        const text = (document.body ? document.body.textContent : '') || '';
        return text.includes("Google Maps can't find") || text.includes("No results found");
      }).catch(() => false);
      if (hasNoResults) {
        return [];
      }
    }

    // Check if Google Maps redirected directly to a single place page
    const isDirectPlace = await page.evaluate(() => {
      const h1 = document.querySelector('h1.DUwDvf, h1');
      const isPlaceUrl = window.location.href.includes('/maps/place/');
      return Boolean(isPlaceUrl && h1 && (h1.textContent || h1.innerText || '').trim());
    }).catch(() => false);

    if (isDirectPlace) {
      const directPlaceData = await page.evaluate(() => {
        const h1 = document.querySelector('h1.DUwDvf, h1');
        return {
          name: h1 ? (h1.textContent || h1.innerText || '').trim() : 'Unknown Store',
          url: window.location.href,
        };
      }).catch(() => ({ name: 'Unknown Store', url: page.url() }));
      return [directPlaceData];
    }

    const seenUrls = new Set();
    const collectedListings = [];

    const getListingsFromDOM = async () => {
      try {
        return await page.evaluate(() => {
          const results = [];
          // Primary selector: a.hfpxzc
          let anchors = Array.from(document.querySelectorAll('a.hfpxzc'));

          // Fallback selector: anchors with href containing /maps/place/
          if (anchors.length === 0) {
            anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
          }

          for (const a of anchors) {
            const href = a.getAttribute('href');
            const ariaLabel = a.getAttribute('aria-label') || a.textContent || '';
            if (href && href.includes('/maps/place/')) {
              results.push({
                name: ariaLabel.trim() || 'Store',
                url: href.startsWith('http') ? href : `https://www.google.com${href}`,
              });
            }
          }
          return results;
        });
      } catch (err) {
        return [];
      }
    };

    let scrollAttempts = 0;
    const maxScrollAttempts = Math.max(15, Math.ceil(targetCount / 2));
    let lastFoundCount = 0;
    let unchangedRounds = 0;

    while (collectedListings.length < targetCount && scrollAttempts < maxScrollAttempts) {
      const items = await getListingsFromDOM();

      for (const item of items) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          collectedListings.push(item);
          if (collectedListings.length >= targetCount) {
            break;
          }
        }
      }

      if (collectedListings.length >= targetCount) {
        break;
      }

      // Check if scroll reached end of list without full page layout reflow
      const isEndOfList = await page.evaluate(() => {
        const endIndicator = document.querySelector('div.HlvSq, p.fontBodyMedium > span > span, span.HlvSq');
        if (endIndicator) return true;
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
          const text = feed.textContent || '';
          return text.includes("You've reached the end of the list") || text.includes("No more results");
        }
        return false;
      }).catch(() => false);

      if (collectedListings.length === lastFoundCount) {
        unchangedRounds++;
        if (unchangedRounds >= 4 || isEndOfList) {
          // No more new items being loaded
          break;
        }
      } else {
        unchangedRounds = 0;
        lastFoundCount = collectedListings.length;
      }

      // Scroll the results feed directly
      await page.evaluate(() => {
        const container = document.querySelector('div[role="feed"]') || document.querySelector('div.m6QErb[aria-label]') || document.querySelector('div[role="main"]');
        if (container) {
          container.scrollBy(0, 1500);
          container.scrollTop += 1500;
        } else {
          window.scrollBy(0, 1200);
        }
      }).catch(() => {});

      await MapsScraper.sleep(1200);
      scrollAttempts++;
    }

    return collectedListings.slice(0, targetCount);
  }

  /**
   * Scrapes detailed information (name, address, website) from a single Maps place page
   */
  async scrapePlaceDetails(page, placeUrl, fallbackName = 'Not found') {
    try {
      await page.goto(placeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.pageTimeoutMs || 30000,
      });

      // Check if blocked
      const isBlocked = await this.browserManager.checkIsBlocked(page);
      if (isBlocked) {
        return { blocked: true };
      }

      // Wait a moment for place content
      try {
        await page.waitForSelector('h1, button[data-item-id="address"], a[data-item-id="authority"]', {
          timeout: 6000,
        });
      } catch (e) {
        // Continue anyway to extract whatever is in the DOM
      }

      const details = await page.evaluate((defaultName) => {
        // Name
        const h1 = document.querySelector('h1.DUwDvf, h1');
        const name = h1 ? h1.innerText.trim() : defaultName;

        // Address
        let address = 'Not found';
        const addressBtn = document.querySelector(
          'button[data-item-id="address"], button[aria-label^="Address:"], button[data-tooltip*="address" i], button[data-item-id*="addr"]'
        );
        if (addressBtn) {
          const ariaLabel = addressBtn.getAttribute('aria-label');
          if (ariaLabel) {
            address = ariaLabel.replace(/^Address:\s*/i, '').trim();
          } else {
            address = addressBtn.innerText.replace(/^Address:\s*/i, '').trim();
          }
        } else {
          // Fallback: look for address icon container
          const addrElem = document.querySelector('div.rogA2c div.Io6YTe, [data-item-id="address"] .fontBodyMedium');
          if (addrElem) {
            address = addrElem.innerText.trim();
          }
        }

        // Website
        let website = 'Not found';
        const websiteElem = document.querySelector(
          'a[data-item-id="authority"], a[aria-label^="Website:"], a[aria-label^="Website"], button[data-item-id="authority"]'
        );
        if (websiteElem) {
          const href = websiteElem.getAttribute('href');
          if (href && href.startsWith('http')) {
            website = href;
          }
        }

        return {
          name: name || defaultName || 'Not found',
          address: address || 'Not found',
          website: website || 'Not found',
        };
      }, fallbackName);

      return {
        blocked: false,
        name: details.name || fallbackName,
        address: details.address || 'Not found',
        website: details.website || 'Not found',
        url: placeUrl,
      };
    } catch (err) {
      return {
        blocked: false,
        name: fallbackName || 'Not found',
        address: 'Not found',
        website: 'Not found',
        url: placeUrl,
        error: err.message,
      };
    }
  }
}

module.exports = MapsScraper;
