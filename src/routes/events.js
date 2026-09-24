const express = require('express');

function createEventsRouter({
  devices,
  maxStreamsPerIp,
  idRegex,
  send,
  stateOf,
}) {
  const router = express.Router();

  // canale server -> dispositivo (stato del proprio file, ordine di download, conferma)
  router.get('/events', (req, res) => {
    const id = String(req.query.id);

    if (!idRegex.test(id)) return res.sendStatus(400);

    const streams = [...devices.values()].filter(
      (x) => x.res && x.ip === req.ip && x.id !== id
    ).length;

    if (streams >= maxStreamsPerIp) return res.sendStatus(429);

    let d = devices.get(id);

    if (!d) {
      devices.set(
        id,
        (d = {
          id,
          res: null,
          ip: req.ip,
          pending: null,
          uploading: false,
        })
      );
    }

    d.ip = req.ip;
    d.res = res;

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    res.flushHeaders();

    send(d, 'state', stateOf(d));

    req.on('close', () => {
      if (d.res === res) d.res = null;
    });
  });

  return router;
}

module.exports = createEventsRouter;
