const express = require('express');
const { createSteelSession, releaseSteelSession } = require('../helpers/steel-session');

const router = express.Router();

// POST /scrape/list - List scraper
router.post('/', async (req, res) => {
  let sessionId = null, browser = null;

  try {
    const { url, itemSelector, fields, maxItems = 100 } = req.body;
    if (!url || !itemSelector) return res.status(400).json({ error: 'URL and itemSelector required' });

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
          if (el) item[key] = attr ? await el.getAttribute(attr) : await el.textContent();
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
    console.error('List scraper error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
