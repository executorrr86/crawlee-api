const express = require('express');
const { PlaywrightCrawler, Dataset } = require('crawlee');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'crawlee-api' });
});

// Generic scraper - extracts based on selectors
app.post('/scrape', async (req, res) => {
  try {
    const { url, selectors, waitFor } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const results = [];
    
    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: 1,
      async requestHandler({ page, request }) {
        if (waitFor) {
          await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
        }
        
        const data = { url: request.url };
        
        if (selectors) {
          for (const [key, selector] of Object.entries(selectors)) {
            const elements = await page.$$(selector);
            data[key] = await Promise.all(
              elements.map(el => el.textContent())
            );
          }
        } else {
          // Default: extract title and all text
          data.title = await page.title();
          data.text = await page.$eval('body', el => el.innerText).catch(() => '');
        }
        
        results.push(data);
      },
    });

    await crawler.run([url]);
    
    res.json({ success: true, data: results[0] || {} });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Job scraper - specialized for job listings
app.post('/scrape/jobs', async (req, res) => {
  try {
    const { url, jobSelector, fields } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const jobs = [];
    
    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: 1,
      async requestHandler({ page }) {
        // Wait for job listings to load
        await page.waitForTimeout(2000);
        
        const selector = jobSelector || '[class*="job"], [class*="listing"], [class*="result"], article';
        const jobElements = await page.$$(selector);
        
        for (const element of jobElements.slice(0, 50)) {
          const job = {};
          
          if (fields) {
            for (const [key, sel] of Object.entries(fields)) {
              const el = await element.$(sel);
              job[key] = el ? await el.textContent() : null;
            }
          } else {
            // Default extraction
            job.title = await element.$eval('[class*="title"], h2, h3', el => el.textContent).catch(() => null);
            job.company = await element.$eval('[class*="company"], [class*="employer"]', el => el.textContent).catch(() => null);
            job.location = await element.$eval('[class*="location"]', el => el.textContent).catch(() => null);
            job.link = await element.$eval('a', el => el.href).catch(() => null);
          }
          
          if (Object.values(job).some(v => v)) {
            jobs.push(job);
          }
        }
      },
    });

    await crawler.run([url]);
    
    res.json({ success: true, count: jobs.length, jobs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List scraper - extracts lists of items
app.post('/scrape/list', async (req, res) => {
  try {
    const { url, itemSelector, fields, maxItems = 100 } = req.body;
    
    if (!url || !itemSelector) {
      return res.status(400).json({ error: 'URL and itemSelector are required' });
    }

    const items = [];
    
    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: 1,
      async requestHandler({ page }) {
        await page.waitForSelector(itemSelector, { timeout: 10000 }).catch(() => {});
        
        const elements = await page.$$(itemSelector);
        
        for (const element of elements.slice(0, maxItems)) {
          const item = {};
          
          if (fields) {
            for (const [key, config] of Object.entries(fields)) {
              const sel = typeof config === 'string' ? config : config.selector;
              const attr = typeof config === 'object' ? config.attr : null;
              
              const el = await element.$(sel);
              if (el) {
                item[key] = attr 
                  ? await el.getAttribute(attr)
                  : await el.textContent();
              }
            }
          } else {
            item.text = await element.textContent();
          }
          
          items.push(item);
        }
      },
    });

    await crawler.run([url]);
    
    res.json({ success: true, count: items.length, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Multi-page crawler
app.post('/crawl', async (req, res) => {
  try {
    const { startUrl, linkSelector, maxPages = 10, extractSelectors } = req.body;
    
    if (!startUrl) {
      return res.status(400).json({ error: 'startUrl is required' });
    }

    const pages = [];
    
    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: maxPages,
      async requestHandler({ page, request, enqueueLinks }) {
        const data = { url: request.url };
        
        if (extractSelectors) {
          for (const [key, selector] of Object.entries(extractSelectors)) {
            data[key] = await page.$eval(selector, el => el.textContent).catch(() => null);
          }
        } else {
          data.title = await page.title();
        }
        
        pages.push(data);
        
        if (linkSelector) {
          await enqueueLinks({ selector: linkSelector });
        }
      },
    });

    await crawler.run([startUrl]);
    
    res.json({ success: true, count: pages.length, pages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Crawlee API running on port ${PORT}`);
});