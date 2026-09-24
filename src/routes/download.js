const express = require('express');
const fs = require('fs');

function createDownloadRouter({
  devices,
  send,
  stateOf,
}) {
  const router = express.Router();

  // alcuni browser sondano l'URL con HEAD: non deve consumare il file
  router.head('/download', (req, res) => res.sendStatus(200));

  // download una tantum, con link monouso ricevuto solo dal dispositivo abbinato
  router.get('/download', (req, res) => {
    const t = String(req.query.t);
    const now = Date.now();

    const owner = [...devices.values()].find(
      (x) =>
        x.pending &&
        x.pending.token === t &&
        now < x.pending.tokenExp
    );

    if (!owner) return res.sendStatus(404);

    const p = owner.pending;

    owner.pending = null;
    send(owner, 'state', stateOf(owner));

    res.download(p.file, p.name, (err) => {
      fs.unlink(p.file, () => {});

      if (!err) send(owner, 'done', {});
    });
  });

  return router;
}

module.exports = createDownloadRouter;
