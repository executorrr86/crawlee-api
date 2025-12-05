const express = require('express');
const { createSteelSession, releaseSteelSession } = require('../helpers/steel-session');

const router = express.Router();

// POST /scrape/jobs - Generic jobs scraper
router.post('/', async (req, res) => {
  let sessionId = null, browser = null;

  try {
    const { url, jobSelector, fields } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const session = await createSteelSession();
    browser = session.browser;
    sessionId = session.sessionId;

    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const selector = jobSelector || '[class*="job"], [class*="listing"], article';
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
        job.company = await element.$eval('[class*="company"]', el => el.textContent).catch(() => null);
        job.location = await element.$eval('[class*="location"]', el => el.textContent).catch(() => null);
        job.link = await element.$eval('a', el => el.href).catch(() => null);
      }
      if (Object.values(job).some(v => v)) jobs.push(job);
    }

    await browser.close();
    await releaseSteelSession(sessionId);
    res.json({ success: true, count: jobs.length, jobs });
  } catch (error) {
    console.error('Jobs scraper error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
