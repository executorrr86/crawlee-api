const express = require('express');
const { chromium } = require('playwright-core');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const STEEL_BROWSER_URL = process.env.STEEL_BROWSER_URL || 'http://steel-browser:3000';

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'crawlee-api', version: '3.0', steelBrowser: STEEL_BROWSER_URL });
});

// Helper: Connect to Steel Browser and get a page
async function createSteelSession() {
  const response = await fetch(`${STEEL_BROWSER_URL}/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionTimeout: 600000 }) // 10 min for detailed scraping
  });

  if (!response.ok) {
    throw new Error(`Failed to create Steel session: ${response.statusText}`);
  }

  const session = await response.json();
  const wsUrl = `ws://${STEEL_BROWSER_URL.replace('http://', '').replace('https://', '')}/v1/sessions/${session.id}/cdp`;

  const browser = await chromium.connectOverCDP(wsUrl);
  return { browser, sessionId: session.id };
}

// Helper: Release Steel session
async function releaseSteelSession(sessionId) {
  try {
    await fetch(`${STEEL_BROWSER_URL}/v1/sessions/${sessionId}/release`, { method: 'POST' });
  } catch (e) {
    console.error('Failed to release session:', e.message);
  }
}

// Helper: Scroll to load more jobs
async function scrollToLoadJobs(page, targetCount) {
  let previousHeight = 0;
  let currentCount = 0;
  let scrollAttempts = 0;
  const maxScrollAttempts = 20;

  while (currentCount < targetCount && scrollAttempts < maxScrollAttempts) {
    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    // Click "Show more" button if exists
    const showMoreBtn = await page.$('button.infinite-scroller__show-more-button, button[aria-label*="more jobs"]');
    if (showMoreBtn) {
      await showMoreBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Count current jobs
    currentCount = await page.$$eval('.base-search-card, .job-search-card, .base-card', cards => cards.length);

    // Check if page height changed
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) {
      scrollAttempts++;
    } else {
      scrollAttempts = 0;
    }
    previousHeight = newHeight;

    console.log(`Loaded ${currentCount}/${targetCount} jobs (scroll attempt ${scrollAttempts})`);
  }

  return currentCount;
}

// Helper: Extract job details from detail page
async function extractJobDetails(page, jobUrl) {
  try {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    const details = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };

      const getHtml = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerHTML : null;
      };

      // Description
      const descriptionEl = document.querySelector('.description__text, .show-more-less-html__markup, .jobs-description__content');
      const descriptionHtml = descriptionEl ? descriptionEl.innerHTML : null;
      const descriptionText = descriptionEl ? descriptionEl.textContent.trim() : null;

      // Salary - multiple possible locations
      const salaryEl = document.querySelector('.salary-main-rail__data-body, .compensation__salary, [class*="salary"]');
      const salaryText = salaryEl ? salaryEl.textContent.trim() : null;
      const salaryInfo = salaryText ? salaryText.match(/[\$\€\£][\d,]+(?:\s*-\s*[\$\€\£]?[\d,]+)?/g) : null;

      // Applicants count
      const applicantsEl = document.querySelector('.num-applicants__caption, .jobs-unified-top-card__applicant-count, [class*="applicant"]');
      const applicantsText = applicantsEl ? applicantsEl.textContent.trim() : null;
      const applicantsCount = applicantsText ? applicantsText.match(/\d+/)?.[0] : null;

      // Apply URL
      const applyBtn = document.querySelector('a.apply-button, a[data-tracking-control-name*="apply"], .jobs-apply-button');
      const applyUrl = applyBtn ? applyBtn.href : null;

      // Job criteria (seniority, type, function, industries)
      const criteriaItems = document.querySelectorAll('.description__job-criteria-item, .job-criteria__item');
      const criteria = {};
      criteriaItems.forEach(item => {
        const label = item.querySelector('.description__job-criteria-subheader, .job-criteria__subheader');
        const value = item.querySelector('.description__job-criteria-text, .job-criteria__text');
        if (label && value) {
          const key = label.textContent.trim().toLowerCase().replace(/\s+/g, '_');
          criteria[key] = value.textContent.trim();
        }
      });

      // Job poster info
      const posterNameEl = document.querySelector('.jobs-poster__name, .hirer-card__hirer-information h3');
      const posterTitleEl = document.querySelector('.jobs-poster__headline, .hirer-card__hirer-information h4');
      const posterPhotoEl = document.querySelector('.jobs-poster__photo img, .hirer-card__hirer-photo img');
      const posterLinkEl = document.querySelector('.jobs-poster__profile-link, .hirer-card__hirer-information a');

      return {
        descriptionHtml,
        descriptionText,
        salaryInfo,
        applicantsCount,
        applyUrl,
        seniorityLevel: criteria.seniority_level || criteria.experience_level || null,
        employmentType: criteria.employment_type || criteria.job_type || null,
        jobFunction: criteria.job_function || criteria.function || null,
        industries: criteria.industries || criteria.industry || null,
        jobPosterName: posterNameEl ? posterNameEl.textContent.trim() : null,
        jobPosterTitle: posterTitleEl ? posterTitleEl.textContent.trim() : null,
        jobPosterPhoto: posterPhotoEl ? posterPhotoEl.src : null,
        jobPosterProfileUrl: posterLinkEl ? posterLinkEl.href : null
      };
    });

    return details;
  } catch (error) {
    console.error(`Failed to extract details from ${jobUrl}:`, error.message);
    return null;
  }
}

// Helper: Extract company details
async function extractCompanyDetails(page, companyUrl) {
  try {
    await page.goto(companyUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    const details = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };

      // Company description
      const descEl = document.querySelector('.core-section-container__content p, .org-top-card-summary-info-list, .org-about-us-organization-description__text');
      const companyDescription = descEl ? descEl.textContent.trim() : null;

      // Website
      const websiteEl = document.querySelector('a[data-tracking-control-name*="website"], .org-top-card-primary-actions__inner a[href*="http"]');
      const companyWebsite = websiteEl ? websiteEl.href : null;

      // Employees count
      const employeesEl = document.querySelector('.org-top-card-summary-info-list__info-item:nth-child(2), [class*="employee"]');
      const employeesText = employeesEl ? employeesEl.textContent.trim() : null;
      const employeesMatch = employeesText ? employeesText.match(/[\d,]+(?:-[\d,]+)?\s*employees/i) : null;
      const companyEmployeesCount = employeesMatch ? employeesMatch[0].replace(/[^\d-]/g, '') : null;

      // Logo
      const logoEl = document.querySelector('.org-top-card-primary-content__logo, .artdeco-entity-image');
      const companyLogo = logoEl ? (logoEl.src || logoEl.style.backgroundImage?.match(/url\("?([^"]+)"?\)/)?.[1]) : null;

      return {
        companyDescription,
        companyWebsite,
        companyEmployeesCount,
        companyLogo
      };
    });

    return details;
  } catch (error) {
    console.error(`Failed to extract company details from ${companyUrl}:`, error.message);
    return null;
  }
}

// ========================================
// ACTORS - Pre-built scrapers for specific sites
// ========================================

// LinkedIn Jobs Actor - ENHANCED VERSION
app.post('/actors/linkedin-jobs', async (req, res) => {
  let sessionId = null, browser = null;

  try {
    const {
      // Basic params
      keywords = '',
      location = '',
      limit = 25,
      startFrom = 0,

      // Advanced filters
      experienceLevel = null,    // 1=Intern, 2=Entry, 3=Associate, 4=Mid-Senior, 5=Director, 6=Executive
      jobType = null,            // F=Full-time, P=Part-time, C=Contract, T=Temporary, V=Volunteer, I=Internship, O=Other
      workSchedule = null,       // 1=On-site, 2=Remote, 3=Hybrid
      jobPostTime = null,        // r86400=24h, r604800=1week, r2592000=1month
      companyNames = [],         // Array of company names to filter

      // Detail options
      includeDetails = true,     // Get full job details (slower but more data)
      scrapeCompany = false      // Get company details (even slower)
    } = req.body;

    // Build LinkedIn Jobs URL with all filters
    const params = new URLSearchParams();
    if (keywords) params.append('keywords', keywords);
    if (location) params.append('location', location);
    if (startFrom > 0) params.append('start', startFrom.toString());

    // Experience level filter (f_E)
    if (experienceLevel) {
      const levels = Array.isArray(experienceLevel) ? experienceLevel : [experienceLevel];
      params.append('f_E', levels.join(','));
    }

    // Job type filter (f_JT)
    if (jobType) {
      const types = Array.isArray(jobType) ? jobType : [jobType];
      params.append('f_JT', types.join(','));
    }

    // Work schedule filter (f_WT)
    if (workSchedule) {
      const schedules = Array.isArray(workSchedule) ? workSchedule : [workSchedule];
      params.append('f_WT', schedules.join(','));
    }

    // Time posted filter (f_TPR)
    if (jobPostTime) {
      params.append('f_TPR', jobPostTime);
    }

    // Company filter (f_C) - requires company IDs, but we can use text search
    if (companyNames && companyNames.length > 0) {
      // For company names, we append to keywords
      const companyFilter = companyNames.map(c => `"${c}"`).join(' OR ');
      const currentKeywords = params.get('keywords') || '';
      params.set('keywords', currentKeywords ? `${currentKeywords} ${companyFilter}` : companyFilter);
    }

    params.append('trk', 'public_jobs_jobs-search-bar_search-submit');

    const url = `https://www.linkedin.com/jobs/search?${params.toString()}`;

    console.log(`Starting LinkedIn Jobs scrape: ${url}`);
    console.log(`Options: limit=${limit}, includeDetails=${includeDetails}, scrapeCompany=${scrapeCompany}`);

    const session = await createSteelSession();
    browser = session.browser;
    sessionId = session.sessionId;

    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for job cards to load
    await page.waitForSelector('.base-search-card, .job-search-card', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Scroll to load more jobs if needed
    if (limit > 25) {
      await scrollToLoadJobs(page, limit);
    }

    // Extract basic job info from cards
    const basicJobs = await page.evaluate((maxJobs) => {
      const jobCards = document.querySelectorAll('.base-search-card, .job-search-card, .base-card');
      const results = [];

      for (let i = 0; i < Math.min(jobCards.length, maxJobs); i++) {
        const card = jobCards[i];

        const titleEl = card.querySelector('.base-search-card__title, h3.base-search-card__title, .job-search-card__title');
        const companyEl = card.querySelector('.base-search-card__subtitle, h4.base-search-card__subtitle, .job-search-card__subtitle');
        const locationEl = card.querySelector('.job-search-card__location, .base-search-card__metadata');
        const linkEl = card.querySelector('a.base-card__full-link, a');
        const dateEl = card.querySelector('time, .job-search-card__listdate');
        const companyLinkEl = card.querySelector('a[data-tracking-control-name*="company"], h4 a');
        const logoEl = card.querySelector('img.artdeco-entity-image, .search-entity-media img');
        const salaryEl = card.querySelector('.job-search-card__salary-info, [class*="salary"]');

        const job = {
          id: card.getAttribute('data-entity-urn')?.split(':').pop() || null,
          title: titleEl ? titleEl.textContent.trim() : null,
          company: companyEl ? companyEl.textContent.trim() : null,
          companyLinkedinUrl: companyLinkEl ? companyLinkEl.href : null,
          companyLogo: logoEl ? logoEl.src : null,
          location: locationEl ? locationEl.textContent.trim() : null,
          link: linkEl ? linkEl.href : null,
          postedAt: dateEl ? (dateEl.getAttribute('datetime') || dateEl.textContent.trim()) : null,
          salaryInfo: salaryEl ? salaryEl.textContent.trim().split(/\s*-\s*/).map(s => s.trim()) : null
        };

        // Only add if we have at least a title
        if (job.title) {
          results.push(job);
        }
      }

      return results;
    }, limit);

    console.log(`Found ${basicJobs.length} jobs from search results`);

    // Enrich with details if requested
    let jobs = basicJobs;

    if (includeDetails && jobs.length > 0) {
      console.log('Extracting detailed info for each job...');
      const detailPage = await context.newPage();

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.link) {
          console.log(`Getting details for job ${i + 1}/${jobs.length}: ${job.title}`);
          const details = await extractJobDetails(detailPage, job.link);
          if (details) {
            jobs[i] = { ...job, ...details };
          }
        }

        // Small delay to avoid rate limiting
        await detailPage.waitForTimeout(500);
      }

      await detailPage.close();
    }

    // Enrich with company details if requested
    if (scrapeCompany && jobs.length > 0) {
      console.log('Extracting company details...');
      const companyPage = await context.newPage();
      const scrapedCompanies = new Map();

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.companyLinkedinUrl) {
          // Cache company data to avoid re-scraping same company
          if (!scrapedCompanies.has(job.companyLinkedinUrl)) {
            console.log(`Getting company details for: ${job.company}`);
            const companyDetails = await extractCompanyDetails(companyPage, job.companyLinkedinUrl);
            scrapedCompanies.set(job.companyLinkedinUrl, companyDetails);
            await companyPage.waitForTimeout(500);
          }

          const cachedCompany = scrapedCompanies.get(job.companyLinkedinUrl);
          if (cachedCompany) {
            jobs[i] = { ...job, ...cachedCompany };
          }
        }
      }

      await companyPage.close();
    }

    await browser.close();
    await releaseSteelSession(sessionId);

    res.json({
      success: true,
      query: {
        keywords,
        location,
        experienceLevel,
        jobType,
        workSchedule,
        jobPostTime,
        companyNames
      },
      options: {
        limit,
        startFrom,
        includeDetails,
        scrapeCompany
      },
      count: jobs.length,
      jobs
    });
  } catch (error) {
    console.error('LinkedIn Jobs error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    res.status(500).json({ error: error.message });
  }
});

// List available actors with full documentation
app.get('/actors', (req, res) => {
  res.json({
    actors: [
      {
        id: 'linkedin-jobs',
        name: 'LinkedIn Jobs Scraper',
        version: '3.0',
        description: 'Advanced LinkedIn Jobs scraper with detailed job info, filters, and company data',
        endpoint: '/actors/linkedin-jobs',
        method: 'POST',
        input: {
          // Basic params
          keywords: {
            type: 'string',
            description: 'Search keywords (e.g., "Software Engineer")',
            required: false
          },
          location: {
            type: 'string',
            description: 'Job location (e.g., "Spain", "Remote")',
            required: false
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of jobs to return',
            default: 25
          },
          startFrom: {
            type: 'integer',
            description: 'Offset for pagination',
            default: 0
          },
          // Advanced filters
          experienceLevel: {
            type: 'string|array',
            description: 'Experience level filter',
            enum: {
              '1': 'Internship',
              '2': 'Entry level',
              '3': 'Associate',
              '4': 'Mid-Senior level',
              '5': 'Director',
              '6': 'Executive'
            }
          },
          jobType: {
            type: 'string|array',
            description: 'Job type filter',
            enum: {
              'F': 'Full-time',
              'P': 'Part-time',
              'C': 'Contract',
              'T': 'Temporary',
              'V': 'Volunteer',
              'I': 'Internship',
              'O': 'Other'
            }
          },
          workSchedule: {
            type: 'string|array',
            description: 'Work location type',
            enum: {
              '1': 'On-site',
              '2': 'Remote',
              '3': 'Hybrid'
            }
          },
          jobPostTime: {
            type: 'string',
            description: 'Filter by posting time',
            enum: {
              'r86400': 'Past 24 hours',
              'r604800': 'Past week',
              'r2592000': 'Past month'
            }
          },
          companyNames: {
            type: 'array',
            description: 'Filter by company names'
          },
          // Detail options
          includeDetails: {
            type: 'boolean',
            description: 'Fetch full job details (description, salary, applicants, etc.)',
            default: true
          },
          scrapeCompany: {
            type: 'boolean',
            description: 'Fetch company details (slower)',
            default: false
          }
        },
        output: {
          id: 'LinkedIn job ID',
          title: 'Job title',
          company: 'Company name',
          companyLinkedinUrl: 'Company LinkedIn page URL',
          companyLogo: 'Company logo URL',
          location: 'Job location',
          link: 'Job posting URL',
          postedAt: 'Date posted',
          salaryInfo: 'Salary range (array)',
          descriptionHtml: 'Full job description (HTML)',
          descriptionText: 'Full job description (text)',
          applicantsCount: 'Number of applicants',
          applyUrl: 'Direct apply URL',
          seniorityLevel: 'Seniority level',
          employmentType: 'Employment type',
          jobFunction: 'Job function/category',
          industries: 'Industry',
          jobPosterName: 'Recruiter name',
          jobPosterTitle: 'Recruiter title',
          jobPosterPhoto: 'Recruiter photo URL',
          jobPosterProfileUrl: 'Recruiter LinkedIn profile',
          companyDescription: 'Company description (if scrapeCompany=true)',
          companyWebsite: 'Company website (if scrapeCompany=true)',
          companyEmployeesCount: 'Employee count (if scrapeCompany=true)'
        },
        examples: [
          {
            name: 'Basic search',
            input: {
              keywords: 'Software Engineer',
              location: 'Spain',
              limit: 10
            }
          },
          {
            name: 'Remote jobs with filters',
            input: {
              keywords: 'Data Scientist',
              workSchedule: '2',
              experienceLevel: ['3', '4'],
              jobType: 'F',
              jobPostTime: 'r604800',
              limit: 20
            }
          },
          {
            name: 'Full details with company info',
            input: {
              keywords: 'Product Manager',
              location: 'United States',
              includeDetails: true,
              scrapeCompany: true,
              limit: 5
            }
          }
        ]
      }
    ]
  });
});

// ========================================
// GENERIC SCRAPERS (unchanged from original)
// ========================================

// Generic scraper
app.post('/scrape', async (req, res) => {
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

// Job scraper
app.post('/scrape/jobs', async (req, res) => {
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
    console.error('Jobs error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    res.status(500).json({ error: error.message });
  }
});

// List scraper
app.post('/scrape/list', async (req, res) => {
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
    console.error('List error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    res.status(500).json({ error: error.message });
  }
});

// Screenshot
app.post('/screenshot', async (req, res) => {
  let sessionId = null, browser = null;

  try {
    const { url, fullPage = false } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

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

// PDF
app.post('/pdf', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Crawlee API v3.0 (Enhanced) running on port ${PORT}`);
  console.log(`Steel Browser: ${STEEL_BROWSER_URL}`);
  console.log(`Available actors: GET /actors`);
});
