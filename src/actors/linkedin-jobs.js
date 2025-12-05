const { createSteelSession, releaseSteelSession, scrollToLoadItems } = require('../helpers/steel-session');

/**
 * Extract job details from a job detail page
 */
async function extractJobDetails(page, jobUrl) {
  try {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    return await page.evaluate(() => {
      // Description
      const descriptionEl = document.querySelector('.description__text, .show-more-less-html__markup, .jobs-description__content');
      const descriptionHtml = descriptionEl ? descriptionEl.innerHTML : null;
      const descriptionText = descriptionEl ? descriptionEl.textContent.trim() : null;

      // Salary
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

      // Job criteria
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
  } catch (error) {
    console.error(`Failed to extract details from ${jobUrl}:`, error.message);
    return null;
  }
}

/**
 * Extract company details from company page
 */
async function extractCompanyDetails(page, companyUrl) {
  try {
    await page.goto(companyUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    return await page.evaluate(() => {
      const descEl = document.querySelector('.core-section-container__content p, .org-top-card-summary-info-list, .org-about-us-organization-description__text');
      const companyDescription = descEl ? descEl.textContent.trim() : null;

      const websiteEl = document.querySelector('a[data-tracking-control-name*="website"], .org-top-card-primary-actions__inner a[href*="http"]');
      const companyWebsite = websiteEl ? websiteEl.href : null;

      const employeesEl = document.querySelector('.org-top-card-summary-info-list__info-item:nth-child(2), [class*="employee"]');
      const employeesText = employeesEl ? employeesEl.textContent.trim() : null;
      const employeesMatch = employeesText ? employeesText.match(/[\d,]+(?:-[\d,]+)?\s*employees/i) : null;
      const companyEmployeesCount = employeesMatch ? employeesMatch[0].replace(/[^\d-]/g, '') : null;

      const logoEl = document.querySelector('.org-top-card-primary-content__logo, .artdeco-entity-image');
      const companyLogo = logoEl ? (logoEl.src || logoEl.style.backgroundImage?.match(/url\("?([^"]+)"?\)/)?.[1]) : null;

      return { companyDescription, companyWebsite, companyEmployeesCount, companyLogo };
    });
  } catch (error) {
    console.error(`Failed to extract company details from ${companyUrl}:`, error.message);
    return null;
  }
}

/**
 * Main actor run function
 */
async function run(input) {
  let sessionId = null, browser = null;

  try {
    const {
      keywords = '',
      location = '',
      limit = 25,
      startFrom = 0,
      experienceLevel = null,
      jobType = null,
      workSchedule = null,
      jobPostTime = null,
      companyNames = [],
      includeDetails = true,
      scrapeCompany = false
    } = input;

    // Build LinkedIn Jobs URL
    const params = new URLSearchParams();
    if (keywords) params.append('keywords', keywords);
    if (location) params.append('location', location);
    if (startFrom > 0) params.append('start', startFrom.toString());

    if (experienceLevel) {
      const levels = Array.isArray(experienceLevel) ? experienceLevel : [experienceLevel];
      params.append('f_E', levels.join(','));
    }

    if (jobType) {
      const types = Array.isArray(jobType) ? jobType : [jobType];
      params.append('f_JT', types.join(','));
    }

    if (workSchedule) {
      const schedules = Array.isArray(workSchedule) ? workSchedule : [workSchedule];
      params.append('f_WT', schedules.join(','));
    }

    if (jobPostTime) {
      params.append('f_TPR', jobPostTime);
    }

    if (companyNames && companyNames.length > 0) {
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
    await page.waitForSelector('.base-search-card, .job-search-card', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    if (limit > 25) {
      await scrollToLoadItems(page, limit);
    }

    // Extract basic job info
    const basicJobs = await page.evaluate((maxJobs) => {
      const jobCards = document.querySelectorAll('.base-search-card, .job-search-card, .base-card');
      const results = [];

      for (let i = 0; i < Math.min(jobCards.length, maxJobs); i++) {
        const card = jobCards[i];

        const titleEl = card.querySelector('.base-search-card__title, h3.base-search-card__title');
        const companyEl = card.querySelector('.base-search-card__subtitle, h4.base-search-card__subtitle');
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

        if (job.title) results.push(job);
      }

      return results;
    }, limit);

    console.log(`Found ${basicJobs.length} jobs from search results`);

    let jobs = basicJobs;

    // Enrich with details
    if (includeDetails && jobs.length > 0) {
      console.log('Extracting detailed info for each job...');
      const detailPage = await context.newPage();

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.link) {
          console.log(`Getting details for job ${i + 1}/${jobs.length}: ${job.title}`);
          const details = await extractJobDetails(detailPage, job.link);
          if (details) jobs[i] = { ...job, ...details };
        }
        await detailPage.waitForTimeout(500);
      }

      await detailPage.close();
    }

    // Enrich with company details
    if (scrapeCompany && jobs.length > 0) {
      console.log('Extracting company details...');
      const companyPage = await context.newPage();
      const scrapedCompanies = new Map();

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.companyLinkedinUrl) {
          if (!scrapedCompanies.has(job.companyLinkedinUrl)) {
            console.log(`Getting company details for: ${job.company}`);
            const companyDetails = await extractCompanyDetails(companyPage, job.companyLinkedinUrl);
            scrapedCompanies.set(job.companyLinkedinUrl, companyDetails);
            await companyPage.waitForTimeout(500);
          }

          const cachedCompany = scrapedCompanies.get(job.companyLinkedinUrl);
          if (cachedCompany) jobs[i] = { ...job, ...cachedCompany };
        }
      }

      await companyPage.close();
    }

    await browser.close();
    await releaseSteelSession(sessionId);

    return {
      success: true,
      query: { keywords, location, experienceLevel, jobType, workSchedule, jobPostTime, companyNames },
      options: { limit, startFrom, includeDetails, scrapeCompany },
      count: jobs.length,
      jobs
    };
  } catch (error) {
    console.error('LinkedIn Jobs error:', error);
    if (browser) await browser.close().catch(() => {});
    if (sessionId) await releaseSteelSession(sessionId);
    throw error;
  }
}

// Actor metadata for documentation
const meta = {
  name: 'LinkedIn Jobs Scraper',
  version: '3.0',
  description: 'Advanced LinkedIn Jobs scraper with detailed job info, filters, and company data',
  endpoint: '/actors/linkedin-jobs',
  method: 'POST',
  input: {
    keywords: { type: 'string', description: 'Search keywords', required: false },
    location: { type: 'string', description: 'Job location', required: false },
    limit: { type: 'integer', description: 'Max results', default: 25 },
    startFrom: { type: 'integer', description: 'Pagination offset', default: 0 },
    experienceLevel: {
      type: 'string|array',
      description: 'Experience level filter',
      enum: { '1': 'Internship', '2': 'Entry level', '3': 'Associate', '4': 'Mid-Senior level', '5': 'Director', '6': 'Executive' }
    },
    jobType: {
      type: 'string|array',
      description: 'Job type filter',
      enum: { 'F': 'Full-time', 'P': 'Part-time', 'C': 'Contract', 'T': 'Temporary', 'V': 'Volunteer', 'I': 'Internship', 'O': 'Other' }
    },
    workSchedule: {
      type: 'string|array',
      description: 'Work location type',
      enum: { '1': 'On-site', '2': 'Remote', '3': 'Hybrid' }
    },
    jobPostTime: {
      type: 'string',
      description: 'Filter by posting time',
      enum: { 'r86400': 'Past 24 hours', 'r604800': 'Past week', 'r2592000': 'Past month' }
    },
    companyNames: { type: 'array', description: 'Filter by company names' },
    includeDetails: { type: 'boolean', description: 'Fetch full job details', default: true },
    scrapeCompany: { type: 'boolean', description: 'Fetch company details', default: false }
  },
  output: {
    id: 'LinkedIn job ID',
    title: 'Job title',
    company: 'Company name',
    companyLinkedinUrl: 'Company LinkedIn URL',
    companyLogo: 'Company logo URL',
    location: 'Job location',
    link: 'Job posting URL',
    postedAt: 'Date posted',
    salaryInfo: 'Salary range (array)',
    descriptionHtml: 'Job description (HTML)',
    descriptionText: 'Job description (text)',
    applicantsCount: 'Number of applicants',
    applyUrl: 'Direct apply URL',
    seniorityLevel: 'Seniority level',
    employmentType: 'Employment type',
    jobFunction: 'Job function',
    industries: 'Industry',
    jobPosterName: 'Recruiter name',
    jobPosterTitle: 'Recruiter title',
    companyDescription: 'Company description (if scrapeCompany=true)',
    companyWebsite: 'Company website (if scrapeCompany=true)',
    companyEmployeesCount: 'Employee count (if scrapeCompany=true)'
  },
  examples: [
    { name: 'Basic search', input: { keywords: 'Software Engineer', location: 'Spain', limit: 10 } },
    { name: 'Remote jobs', input: { keywords: 'Data Scientist', workSchedule: '2', jobType: 'F', limit: 20 } },
    { name: 'With company info', input: { keywords: 'Product Manager', includeDetails: true, scrapeCompany: true, limit: 5 } }
  ]
};

module.exports = { run, meta };
