const express = require('express');

function createBumpRouter({
  devices,
  limited,
  pairing,
}) {
  const router = express.Router();

  // registra un bump: dispositivo e tipo di input
  router.post('/bump', (req, res) => {
    const id = String(req.query.id);
    const type = String(req.query.type);

    if (!devices.has(id)) return res.sendStatus(404);
    if (type !== 'key' && type !== 'motion') return res.sendStatus(400);
    if (limited('bump', req.ip, 12, 60 * 1000)) {
      return res.sendStatus(429);
    }

    res.sendStatus(200);
    pairing.record(id, type);
  });

  return router;
}

module.exports = createBumpRouter;
