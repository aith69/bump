const express = require('express');
const crypto = require('crypto');

function createShareRouter({
  devices,
  limited,
  shareTtl,
}) {
  const router = express.Router();

  // genera un link di download monouso per il proprio file in attesa
  router.post('/share', (req, res) => {
    const d = devices.get(String(req.query.id));
    if (!d) return res.sendStatus(404);
    if (!d.pending) return res.sendStatus(404);
    if (limited('share', req.ip, 30, 10 * 60 * 1000)) {
      return res.sendStatus(429);
    }

    const token = crypto.randomBytes(16).toString('hex');
    d.pending.token = token;
    d.pending.tokenExp = Date.now() + shareTtl;

    res.json({ url: `/download?t=${token}` });
  });

  return router;
}

module.exports = createShareRouter;
