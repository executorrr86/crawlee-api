const express = require('express');
const { STEEL_BROWSER_URL } = require('./helpers/steel-session');

// Import routers
const actorsRouter = require('./actors');
const genericScraper = require('./scrapers/generic');
const jobsScraper = require('./scrapers/jobs');
const listScraper = require('./scrapers/list');
const screenshotUtil = require('./utils/screenshot');
const pdfUtil = require('./utils/pdf');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const VERSION = '3.0';

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'crawlee-api',
    version: VERSION,
    steelBrowser: STEEL_BROWSER_URL
  });
});

// Mount routers
app.use('/actors', actorsRouter);
app.use('/scrape', genericScraper);
app.use('/scrape/jobs', jobsScraper);
app.use('/scrape/list', listScraper);
app.use('/screenshot', screenshotUtil);
app.use('/pdf', pdfUtil);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Crawlee API',
    version: VERSION,
    endpoints: {
      health: 'GET /health',
      actors: 'GET /actors',
      runActor: 'POST /actors/:id',
      scrape: 'POST /scrape',
      scrapeJobs: 'POST /scrape/jobs',
      scrapeList: 'POST /scrape/list',
      screenshot: 'POST /screenshot',
      pdf: 'POST /pdf'
    }
  });
});

app.listen(PORT, () => {
  console.log(`Crawlee API v${VERSION} running on port ${PORT}`);
  console.log(`Steel Browser: ${STEEL_BROWSER_URL}`);
  console.log(`Available endpoints: GET /`);
});
