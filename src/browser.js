const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('./config');

puppeteerExtra.use(StealthPlugin());

class BrowserManager {
  constructor(customConfig = {}) {
    this.config = { ...config, ...customConfig };
    this.browser = null;
    this.mapsPage = null;
    this.externalPage = null;
  }

  /**
   * Launch browser with stealth settings and realistic desktop configurations
   */
  async launch() {
    if (this.browser) return this.browser;

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-ipc-flooding-protection',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--lang=en-US,en',
      `--window-size=${this.config.viewport.width},${this.config.viewport.height}`,
    ];

    if (this.config.proxyServer) {
      args.push(`--proxy-server=${this.config.proxyServer}`);
    }

    this.browser = await puppeteerExtra.launch({
      headless: this.config.headless ? 'new' : false,
      args,
      protocolTimeout: this.config.protocolTimeoutMs || 300000,
      defaultViewport: {
        width: this.config.viewport.width,
        height: this.config.viewport.height,
      },
    });

    return this.browser;
  }

  /**
   * Setup standard page configurations (User-Agent, headers, timeouts)
   */
  async configurePage(page) {
    await page.setUserAgent(this.config.userAgent);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
    });
    page.setDefaultNavigationTimeout(this.config.pageTimeoutMs);
    page.setDefaultTimeout(this.config.pageTimeoutMs);
  }

  /**
   * Get or create the dedicated Maps tab (reused across searches)
   */
  async getMapsPage() {
    if (!this.browser) await this.launch();

    if (!this.mapsPage || this.mapsPage.isClosed()) {
      const pages = await this.browser.pages();
      this.mapsPage = pages.length > 0 ? pages[0] : await this.browser.newPage();
      await this.configurePage(this.mapsPage);
    }
    return this.mapsPage;
  }

  /**
   * Get or create the dedicated external website tab (reused across store website checks)
   * Enables resource blocking (images, fonts, stylesheets) for speed
   */
  async getExternalPage() {
    if (!this.browser) await this.launch();

    if (!this.externalPage || this.externalPage.isClosed()) {
      this.externalPage = await this.browser.newPage();
      await this.configurePage(this.externalPage);
      this.externalPage.setDefaultNavigationTimeout(this.config.websiteTimeoutMs);
      this.externalPage.setDefaultTimeout(this.config.websiteTimeoutMs);

      // Block heavy resources on external store websites for speed & memory efficiency
      await this.externalPage.setRequestInterception(true);
      this.externalPage.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'media', 'font', 'stylesheet', 'other'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }
    return this.externalPage;
  }

  /**
   * Active Google block/CAPTCHA detection on the given page
   */
  async checkIsBlocked(page) {
    if (!page || page.isClosed()) return false;

    try {
      const url = page.url() || '';
      if (url.includes('/sorry/index') || url.includes('google.com/sorry')) {
        return true;
      }

      const pageText = await page.evaluate(() => {
        const bodyText = document.body ? (document.body.textContent || document.body.innerText || '') : '';
        return bodyText + ' ' + (document.title || '');
      });

      const blockPhrases = [
        'unusual traffic from your computer network',
        'systems have detected unusual traffic',
        'detected unusual traffic',
        'our systems have detected unusual traffic',
        'please solve the challenge below',
        'recaptcha',
      ];

      const lowerText = String(pageText).toLowerCase();
      for (const phrase of blockPhrases) {
        if (lowerText.includes(phrase)) {
          return true;
        }
      }
      return false;
    } catch (err) {
      // If evaluating fails because page is navigating or closed, ignore
      return false;
    }
  }

  /**
   * Close external page tab
   */
  async closeExternalPage() {
    if (this.externalPage && !this.externalPage.isClosed()) {
      try {
        await this.externalPage.close();
      } catch (err) {
        // ignore
      }
      this.externalPage = null;
    }
  }

  /**
   * Close maps page tab
   */
  async closeMapsPage() {
    if (this.mapsPage && !this.mapsPage.isClosed()) {
      try {
        await this.mapsPage.close();
      } catch (err) {
        // ignore
      }
      this.mapsPage = null;
    }
  }

  /**
   * Reset all working pages to free memory and detached DOM nodes between combos
   */
  async resetPages() {
    await this.closeExternalPage();
    await this.closeMapsPage();
  }

  /**
   * Close entire browser
   */
  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        // ignore
      }
      this.browser = null;
      this.mapsPage = null;
      this.externalPage = null;
    }
  }
}

module.exports = BrowserManager;
