const { actors } = require('./actors/linkedin-jobs');

// Generate OpenAPI spec from actor metadata
function generateSwaggerSpec() {
  const actorList = [require('./actors/linkedin-jobs')];
  
  const paths = {
    '/': {
      get: {
        tags: ['General'],
        summary: 'API Info',
        description: 'Get API information and available endpoints',
        responses: {
          '200': {
            description: 'API information',
            content: {
              'application/json': {
                example: {
                  service: 'Crawlee API',
                  version: '3.0',
                  endpoints: {}
                }
              }
            }
          }
        }
      }
    },
    '/health': {
      get: {
        tags: ['General'],
        summary: 'Health Check',
        description: 'Check API health status',
        responses: {
          '200': {
            description: 'Health status',
            content: {
              'application/json': {
                example: {
                  status: 'ok',
                  service: 'crawlee-api',
                  version: '3.0'
                }
              }
            }
          }
        }
      }
    },
    '/actors': {
      get: {
        tags: ['Actors'],
        summary: 'List all actors',
        description: 'Get a list of all available actors with their metadata and input/output schemas',
        responses: {
          '200': {
            description: 'List of actors',
            content: {
              'application/json': {
                example: {
                  actors: [{ id: 'linkedin-jobs', name: 'LinkedIn Jobs Scraper', version: '3.0' }]
                }
              }
            }
          }
        }
      }
    }
  };

  // Generate paths for each actor
  actorList.forEach(actor => {
    const meta = actor.meta;
    
    // GET /actors/:id - Actor info
    paths[`/actors/${meta.id}`] = {
      get: {
        tags: ['Actors'],
        summary: `Get ${meta.name} info`,
        description: meta.description,
        responses: {
          '200': {
            description: 'Actor metadata and schema'
          }
        }
      },
      post: {
        tags: ['Actors'],
        summary: `Run ${meta.name}`,
        description: meta.description,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: generateInputSchema(meta.input),
              examples: generateExamples(meta.examples)
            }
          }
        },
        responses: {
          '200': {
            description: 'Scraping results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    count: { type: 'integer' },
                    data: {
                      type: 'array',
                      items: generateOutputSchema(meta.output)
                    }
                  }
                }
              }
            }
          }
        }
      }
    };
  });

  // Add generic scraper endpoints
  paths['/scrape'] = {
    post: {
      tags: ['Scrapers'],
      summary: 'Generic web scraper',
      description: 'Scrape any webpage with custom selectors',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: 'string', description: 'URL to scrape' },
                selector: { type: 'string', description: 'CSS selector for items' },
                fields: { type: 'object', description: 'Field mappings {name: selector}' },
                waitFor: { type: 'string', description: 'Selector to wait for' },
                timeout: { type: 'integer', description: 'Timeout in ms', default: 30000 }
              }
            },
            example: {
              url: 'https://example.com',
              selector: '.item',
              fields: { title: 'h2', link: 'a@href' }
            }
          }
        }
      },
      responses: {
        '200': { description: 'Scraped data' }
      }
    }
  };

  paths['/scrape/jobs'] = {
    post: {
      tags: ['Scrapers'],
      summary: 'Jobs scraper',
      description: 'Scrape job listings from any job board',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: 'string', description: 'Job board URL' },
                itemSelector: { type: 'string', description: 'Job item selector' },
                limit: { type: 'integer', default: 25 }
              }
            }
          }
        }
      },
      responses: {
        '200': { description: 'Job listings' }
      }
    }
  };

  paths['/scrape/list'] = {
    post: {
      tags: ['Scrapers'],
      summary: 'List scraper',
      description: 'Scrape lists/tables from webpages',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: 'string', description: 'Page URL' },
                listSelector: { type: 'string', description: 'List container selector' },
                itemSelector: { type: 'string', description: 'Item selector' }
              }
            }
          }
        }
      },
      responses: {
        '200': { description: 'List items' }
      }
    }
  };

  paths['/screenshot'] = {
    post: {
      tags: ['Utilities'],
      summary: 'Take screenshot',
      description: 'Capture a screenshot of any webpage',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: 'string', description: 'URL to screenshot' },
                fullPage: { type: 'boolean', default: false },
                width: { type: 'integer', default: 1920 },
                height: { type: 'integer', default: 1080 }
              }
            },
            example: {
              url: 'https://example.com',
              fullPage: true
            }
          }
        }
      },
      responses: {
        '200': {
          description: 'Screenshot image',
          content: {
            'image/png': {}
          }
        }
      }
    }
  };

  paths['/pdf'] = {
    post: {
      tags: ['Utilities'],
      summary: 'Generate PDF',
      description: 'Generate a PDF from any webpage',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: 'string', description: 'URL to convert' },
                format: { type: 'string', default: 'A4' },
                landscape: { type: 'boolean', default: false }
              }
            },
            example: {
              url: 'https://example.com',
              format: 'A4'
            }
          }
        }
      },
      responses: {
        '200': {
          description: 'PDF document',
          content: {
            'application/pdf': {}
          }
        }
      }
    }
  };

  return {
    openapi: '3.0.0',
    info: {
      title: 'Crawlee API',
      version: '3.0.0',
      description: 'Web scraping API using Steel Browser - Apify alternative for n8n.\n\n' +
        '## Features\n' +
        '- **Actors**: Pre-built scrapers for specific platforms (LinkedIn Jobs)\n' +
        '- **Generic Scrapers**: Flexible scraping with custom selectors\n' +
        '- **Utilities**: Screenshots and PDF generation\n\n' +
        '## Steel Browser\n' +
        'All scraping uses Steel Browser for anti-detection and proxy support.',
      contact: {
        name: 'Crawlee API'
      }
    },
    servers: [
      {
        url: '/',
        description: 'Current server'
      }
    ],
    tags: [
      { name: 'General', description: 'API information and health' },
      { name: 'Actors', description: 'Pre-built scrapers for specific platforms' },
      { name: 'Scrapers', description: 'Generic scraping endpoints' },
      { name: 'Utilities', description: 'Screenshot and PDF generation' }
    ],
    paths
  };
}

function generateInputSchema(input) {
  const properties = {};
  const required = [];

  Object.entries(input).forEach(([key, config]) => {
    const prop = {
      description: config.description
    };

    // Handle type
    if (config.type === 'string|array') {
      prop.oneOf = [
        { type: 'string' },
        { type: 'array', items: { type: 'string' } }
      ];
    } else if (config.type === 'integer') {
      prop.type = 'integer';
    } else if (config.type === 'boolean') {
      prop.type = 'boolean';
    } else if (config.type === 'array') {
      prop.type = 'array';
      prop.items = { type: 'string' };
    } else {
      prop.type = config.type || 'string';
    }

    // Handle enum
    if (config.enum) {
      prop.description += '\n\nOptions: ' + Object.entries(config.enum)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
    }

    // Handle default
    if (config.default !== undefined) {
      prop.default = config.default;
    }

    properties[key] = prop;

    if (config.required) {
      required.push(key);
    }
  });

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined
  };
}

function generateOutputSchema(output) {
  const properties = {};

  Object.entries(output).forEach(([key, description]) => {
    properties[key] = {
      type: 'string',
      description
    };
  });

  return {
    type: 'object',
    properties
  };
}

function generateExamples(examples) {
  const result = {};
  examples.forEach(ex => {
    result[ex.name] = {
      summary: ex.name,
      value: ex.input
    };
  });
  return result;
}

module.exports = { generateSwaggerSpec };
