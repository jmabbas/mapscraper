class EmailExtractor {
  /**
   * Sanitizes and validates candidate email strings
   */
  static cleanEmail(rawEmail) {
    if (!rawEmail || typeof rawEmail !== 'string') return null;

    let email = rawEmail.trim();

    // Strip mailto: prefix if present
    if (email.toLowerCase().startsWith('mailto:')) {
      email = email.substring(7);
    }

    // Strip URL parameters like ?subject=...
    if (email.includes('?')) {
      email = email.split('?')[0];
    }

    // Strip trailing and leading punctuation (.,;:!?)'"[]{})
    email = email.replace(/^[.,;:!?'"`()\[\]{}]+|[.,;:!?'"`()\[\]{}]+$/g, '').trim();

    // Basic email format validation
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return null;
    }

    // Filter out common false positives and asset files
    const lower = email.toLowerCase();
    const badExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.css', '.js', '.woff', '.ttf'];
    for (const ext of badExtensions) {
      if (lower.endsWith(ext) || lower.includes(`${ext}@`)) {
        return null;
      }
    }

    // Filter out obvious placeholder dummy emails or framework noise
    const dummyDomains = [
      'example.com',
      'domain.com',
      'email.com',
      'yoursite.com',
      'mysite.com',
      'sample.com',
      'wixpress.com',
      'sentry.io',
      'schema.org',
    ];
    for (const dummy of dummyDomains) {
      if (lower.endsWith(`@${dummy}`) || lower.endsWith(`.${dummy}`)) {
        return null;
      }
    }

    return lower;
  }

  /**
   * Scans a loaded page for mailto: links and regex text matches
   */
  static async extractFromCurrentPage(page) {
    try {
      const extracted = await page.evaluate(() => {
        const emails = [];

        // 1. mailto: links
        const mailtoAnchors = document.querySelectorAll('a[href^="mailto:"]');
        for (const a of mailtoAnchors) {
          const href = a.getAttribute('href');
          if (href) emails.push(href);
        }

        // 2. Text scan of whole document body
        const bodyText = document.body ? document.body.innerText : '';
        const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const matches = bodyText.match(regex);
        if (matches) {
          emails.push(...matches);
        }

        return emails;
      });

      const cleanedSet = new Set();
      for (const item of extracted) {
        const cleaned = EmailExtractor.cleanEmail(item);
        if (cleaned) {
          cleanedSet.add(cleaned);
        }
      }

      return Array.from(cleanedSet);
    } catch (err) {
      return [];
    }
  }

  /**
   * Visits website URL and extracts emails
   * @param {object} page - Puppeteer page instance
   * @param {string} websiteUrl - Store website URL
   * @param {number} timeoutMs - Max timeout in milliseconds
   */
  static async extractEmails(page, websiteUrl, timeoutMs = 12000) {
    if (!websiteUrl || websiteUrl === 'Not found' || !websiteUrl.startsWith('http')) {
      return 'Not found';
    }

    try {
      // Navigate to homepage
      await page.goto(websiteUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });

      let emails = await EmailExtractor.extractFromCurrentPage(page);

      // If no emails found on homepage, attempt to find a Contact/About link
      if (emails.length === 0) {
        try {
          const contactUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href]'));
            const contactLink = links.find((a) => {
              const text = (a.innerText || '').toLowerCase();
              const href = (a.getAttribute('href') || '').toLowerCase();
              return (
                text.includes('contact') ||
                text.includes('about us') ||
                href.includes('/contact') ||
                href.includes('/about')
              );
            });
            return contactLink ? contactLink.href : null;
          });

          if (contactUrl && contactUrl.startsWith('http') && contactUrl !== websiteUrl) {
            await page.goto(contactUrl, {
              waitUntil: 'domcontentloaded',
              timeout: Math.min(timeoutMs, 6000),
            });
            const contactEmails = await EmailExtractor.extractFromCurrentPage(page);
            emails = contactEmails;
          }
        } catch (err) {
          // Ignore contact page navigation errors
        }
      }

      if (emails.length > 0) {
        return emails.join(', ');
      }
      return 'Not found';
    } catch (err) {
      return 'Not found';
    }
  }
}

module.exports = EmailExtractor;
