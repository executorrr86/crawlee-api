const express = require('express');
const { createSteelSession, releaseSteelSession } = require('../helpers/steel-session');

const router = express.Router();

// POST /pdf - Generate PDF of a page
router.post('/', async (req, res) => {
  let sessionId = null, browser = null;

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

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

module.exports = router;
