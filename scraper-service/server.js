const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

async function scrapeGoogleMaps(url, maxResults) {
  console.log(`Launching browser... (target: ${maxResults} results)`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  try {
    console.log('Navigating to main URL...');
    await page.goto(url, { waitUntil: 'networkidle2' });

    console.log('Scrolling to load more results...');
    const maxPageDowns = Math.max(1, Math.ceil(maxResults / 5) + 1);
    for (let i = 0; i < maxPageDowns; i++) {
      await page.keyboard.press('PageDown');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('Extracting search results...');
    const data = await page.content();
    const resultPattern = /<a[^>]+class="[^"]*hfpxzc[^"]*"[^>]+aria-label="([^"]+)"[^>]+href="([^"]+)"/g;
    const results = [];
    let match;
    while ((match = resultPattern.exec(data)) !== null) {
      let resultUrl = match[2];
      if (!resultUrl.startsWith('http')) {
        resultUrl = `https://www.google.com.au${resultUrl}`;
      }
      results.push({ name: match[1], url: resultUrl });
    }

    const limitedResults = results.slice(0, maxResults);
    console.log(`Found ${results.length} results, processing ${limitedResults.length}...`);

    const storeData = [];
    for (const [index, result] of limitedResults.entries()) {
      console.log(`Scraping ${index + 1}/${limitedResults.length}: ${result.name}`);
      try {
        await page.goto(result.url, { waitUntil: 'networkidle2', timeout: 60000 });

        const address = await page
          .$eval('button[data-item-id="address"]', el => el.getAttribute('aria-label').replace('Address: ', '').trim())
          .catch(() => 'Not found');

        const website = await page
          .$eval('a[aria-label^="Website:"]', a => a.getAttribute('href'))
          .catch(() => 'Not found');

        let email = 'Not found';
        if (website !== 'Not found') {
          try {
            await page.goto(website, { waitUntil: 'networkidle2', timeout: 60000 });
            const mailtoEmails = await page.$$eval('a[href^="mailto:"]', anchors =>
              anchors.map(a => a.getAttribute('href').replace('mailto:', '').trim())
            );
            const pageText = await page.evaluate(() => document.body.innerText);
            const textEmails = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
            const allEmails = [...new Set([...mailtoEmails, ...textEmails])];
            email = allEmails.length > 0 ? allEmails.join(', ') : 'Not found';
          } catch (err) {
            console.log(`Website error: ${err.message}`);
          }
        }

        storeData.push({
          name: result.name,
          url: result.url,
          address,
          website,
          email,
          scrapedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.log(`Error scraping ${result.name}: ${err.message}`);
        storeData.push({
          name: result.name,
          url: result.url,
          address: 'Error',
          website: 'Error',
          email: 'Error',
          scrapedAt: new Date().toISOString(),
        });
      }
    }

    return storeData;
  } finally {
    await browser.close();
  }
}

app.post('/scrape', async (req, res) => {
  const { url, maxResults } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing "url" in request body' });
  }
  try {
    const stores = await scrapeGoogleMaps(url, parseInt(maxResults, 10) || 20);
    res.json({ count: stores.length, stores });
  } catch (err) {
    console.error('Scrape failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Scraper service listening on port ${PORT}`));
