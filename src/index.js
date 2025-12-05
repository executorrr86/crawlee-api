const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const STEEL_BROWSER_URL = process.env.STEEL_BROWSER_URL || 'http://steel-browser:3000';

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'crawlee-api', steelBrowser: STEEL_BROWSER_URL });
});

// Helper: Connect to Steel Browser and get a page
async function createSteelSession() {
  // Create session in Steel Browser
  const response = await fetch(`${STEEL_BROWSER_URL}/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionTimeout: 300000 }) // 5 min timeout
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create Steel session: ${response.statusText}`);
  }
  
  const session = await response.json();
  
  // Connect Playwright to Steel Browser via CDP
  const browser = await chromium.connectOverCDP(
    `ws://${STEEL_BROWSER_URL.replace('http://', '')}/v1/sessions/${session.id}/cdp`
  );
  
  return { browser, sessionId: session.id };
}

// Helper: Release Steel session
async function releaseSteelSession(sessionId) {
  try {
    await fetch(`${STEEL_BROWSER_URL}/v1/sessions/${sessionId}/release`, {
      method: 'POST'
    });
  } catch (e) {
    console.error('Failed to release session:', e.message);
  }
}

// Generic scraper - extracts based on selectors
app.post('/scrape', async (req, res) => {
  let sessionId = null;
  let browser = null;
  
  try {
    const { url, selectors, waitFor } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Connect to Steel Browser
    const session = await createSteelSession();
    browser = session.browser;
    sessionId = session.sessionId;
    
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
    }
    
    const data = { url };
    
    if (selectors) {
      for (const [key, selector] of Object.entries(selectors)) {
        const elements = await page.$$(selector);
        data[key] = await Promise.all(
          elements.map(el => el.textContent())
        );
      }
    } else {
      data.title = await page.title();
      data.text = await page.$eval('body', el => el.innerText).catch(() => '');
    }
    
    await browser.close();
    await releaseSteelSession(sessionId);
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Scrape error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    res.status(500).json({ error: error.message });
  }
});

// Job scraper - specialized for job listings
app.post('/scrape/jobs', async (req, res) => {
  let sessionId = null;
  let browser = null;
  
  try {
    const { url, jobSelector, fields } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const session = await createSteelSession();
    browser = session.browser;
    sessionId = session.sessionId;
    
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    const selector = jobSelector || '[class*="job"], [class*="listing"], [class*="result"], article';
    const jobElements = await page.$$(selector);
    
    const jobs = [];
    for (const element of jobElements.slice(0, 50)) {
      const job = {};
      
      if (fields) {
        for (const [key, sel] of Object.entries(fields)) {
          const el = await element.$(sel);
          job[key] = el ? await el.textContent() : null;
        }
      } else {
        job.title = await element.$eval('[class*="title"], h2, h3', el => el.textContent).catch(() => null);
        job.company = await element.$eval('[class*="company"], [class*="employer"]', el => el.textContent).catch(() => null);
        job.location = await element.$eval('[class*="location"]', el => el.textContent).catch(() => null);
        job.link = await element.$eval('a', el => el.href).catch(() => null);
      }
      
      if (Object.values(job).some(v => v)) {
        jobs.push(job);
      }
    }
    
    await browser.close();
    await releaseSteelSession(sessionId);
    
    res.json({ success: true, count: jobs.length, jobs });
  } catch (error) {
    console.error('Jobs scrape error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    res.status(500).json({ error: error.message });
  }
});

// List scraper - extracts lists of items
app.post('/scrape/list', async (req, res) => {
  let sessionId = null;
  let browser = null;
  
  try {
    const { url, itemSelector, fields, maxItems = 100 } = req.body;
    
    if (!url || !itemSelector) {
      return res.status(400).json({ error: 'URL and itemSelector are required' });
    }

    const session = await createSteelSession();
    browser = session.browser;
    sessionId = session.sessionId;
    
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(itemSelector, { timeout: 10000 }).catch(() => {});
    
    const elements = await page.$$(itemSelector);
    const items = [];
    
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
    
    await browser.close();
    await releaseSteelSession(sessionId);
    
    res.json({ success: true, count: items.length, items });
  } catch (error) {
    console.error('List scrape error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    res.status(500).json({ error: error.message });
  }
});

// Screenshot endpoint
app.post('/screenshot', async (req, res) => {
  let sessionId = null;
  let browser = null;
  
  try {
    const { url, fullPage = false } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const session = await createSteelSession();
    browser = session.browser;
    sessionId = session.sessionId;
    
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const screenshot = await page.screenshot({ fullPage, type: 'png' });
    
    await browser.close();
    await releaseSteelSession(sessionId);
    
    res.set('Content-Type', 'image/png');
    res.send(screenshot);
  } catch (error) {
    console.error('Screenshot error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    res.status(500).json({ error: error.message });
  }
});

// PDF endpoint
app.post('/pdf', async (req, res) => {
  let sessionId = null;
  let browser = null;
  
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const session = await createSteelSession();
    browser = session.browser;
    sessionId = session.sessionId;
    
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const pdf = await page.pdf({ format: 'A4' });
    
    await browser.close();
    await releaseSteelSession(sessionId);
    
    res.set('Content-Type', 'application/pdf');
    res.send(pdf);
  } catch (error) {
    console.error('PDF error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Crawlee API running on port ${PORT}`);
  console.log(`Steel Browser URL: ${STEEL_BROWSER_URL}`);
});
