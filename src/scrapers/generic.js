const express = require('express');
const { createSteelSession, releaseSteelSession } = require('../helpers/steel-session');

const router = express.Router();

// POST /scrape - Generic scraper
router.post('/', async (req, res) => {
  let sessionId = null, browser = null;

  try {
    const { url, selectors, waitFor } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const session = await createSteelSession();
    browser = session.browser;
    sessionId = session.sessionId;

    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});

    const data = { url };

    if (selectors) {
      for (const [key, selector] of Object.entries(selectors)) {
        const elements = await page.$$(selector);
        data[key] = await Promise.all(elements.map(el => el.textContent()));
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

module.exports = router;
