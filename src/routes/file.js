const express = require('express');

function createFileRouter({
  devices,
  dropPending,
  send,
  stateOf,
}) {
  const router = express.Router();

  // rimozione manuale del proprio file in attesa (la X nella pagina)
  router.delete('/file', (req, res) => {
    const d = devices.get(String(req.query.id));
    if (!d) return res.sendStatus(404);

    dropPending(d);
    send(d, 'state', stateOf(d));
    res.sendStatus(200);
  });

  return router;
}

module.exports = createFileRouter;
