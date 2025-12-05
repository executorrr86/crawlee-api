const { chromium } = require('playwright-core');

const STEEL_BROWSER_URL = process.env.STEEL_BROWSER_URL || 'http://steel-browser:3000';

/**
 * Create a new Steel Browser session
 * @param {number} timeout - Session timeout in ms (default: 600000 = 10 min)
 * @returns {Promise<{browser: Browser, sessionId: string}>}
 */
async function createSteelSession(timeout = 600000) {
  const response = await fetch(`${STEEL_BROWSER_URL}/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionTimeout: timeout })
  });

  if (!response.ok) {
    throw new Error(`Failed to create Steel session: ${response.statusText}`);
  }

  const session = await response.json();
  const wsUrl = `ws://${STEEL_BROWSER_URL.replace('http://', '').replace('https://', '')}/v1/sessions/${session.id}/cdp`;

  const browser = await chromium.connectOverCDP(wsUrl);
  return { browser, sessionId: session.id };
}

/**
 * Release a Steel Browser session
 * @param {string} sessionId - Session ID to release
 */
async function releaseSteelSession(sessionId) {
  try {
    await fetch(`${STEEL_BROWSER_URL}/v1/sessions/${sessionId}/release`, { method: 'POST' });
  } catch (e) {
    console.error('Failed to release session:', e.message);
  }
}

/**
 * Scroll page to load more items (infinite scroll)
 * @param {Page} page - Playwright page
 * @param {number} targetCount - Target number of items to load
 * @param {string} itemSelector - CSS selector for items
 * @returns {Promise<number>} - Number of items loaded
 */
async function scrollToLoadItems(page, targetCount, itemSelector = '.base-search-card, .job-search-card, .base-card') {
  let previousHeight = 0;
  let currentCount = 0;
  let scrollAttempts = 0;
  const maxScrollAttempts = 20;

  while (currentCount < targetCount && scrollAttempts < maxScrollAttempts) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    // Click "Show more" button if exists
    const showMoreBtn = await page.$('button.infinite-scroller__show-more-button, button[aria-label*="more"]');
    if (showMoreBtn) {
      await showMoreBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    currentCount = await page.$$eval(itemSelector, cards => cards.length);

    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) {
      scrollAttempts++;
    } else {
      scrollAttempts = 0;
    }
    previousHeight = newHeight;

    console.log(`Loaded ${currentCount}/${targetCount} items (scroll attempt ${scrollAttempts})`);
  }

  return currentCount;
}

module.exports = {
  createSteelSession,
  releaseSteelSession,
  scrollToLoadItems,
  STEEL_BROWSER_URL
};
