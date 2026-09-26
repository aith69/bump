const express = require('express');

function createConfigRouter({ maxBytes, shareTtl }) {
  const router = express.Router();

  router.get('/config', (_req, res) => {
    res.json({
      maxBytes,
      shareTtl,
    });
  });

  return router;
}

module.exports = createConfigRouter;
