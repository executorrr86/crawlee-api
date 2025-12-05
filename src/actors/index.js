const express = require('express');
const linkedinJobs = require('./linkedin-jobs');

const router = express.Router();

// Actor registry - add new actors here
const actors = {
  'linkedin-jobs': linkedinJobs
};

// GET /actors - List all available actors with documentation
router.get('/', (req, res) => {
  const actorList = Object.entries(actors).map(([id, actor]) => ({
    id,
    ...actor.meta
  }));

  res.json({ actors: actorList });
});

// GET /actors/:id - Get specific actor info
router.get('/:id', (req, res) => {
  const actor = actors[req.params.id];
  if (!actor) {
    return res.status(404).json({ error: `Actor '${req.params.id}' not found` });
  }
  res.json({ id: req.params.id, ...actor.meta });
});

// POST /actors/:id - Run specific actor
router.post('/:id', async (req, res) => {
  const actor = actors[req.params.id];
  if (!actor) {
    return res.status(404).json({ error: `Actor '${req.params.id}' not found` });
  }

  try {
    const result = await actor.run(req.body);
    res.json(result);
  } catch (error) {
    console.error(`Actor ${req.params.id} error:`, error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
