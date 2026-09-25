const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline, Transform } = require('stream');

function createUploadRouter({
  devices,
  limited,
  maxBytes,
  maxFiles,
  maxFilesPerIp,
  dir,
  send,
  stateOf,
}) {
  const router = express.Router();

  // upload in streaming (niente memoria) con limite di dimensione
  router.post('/upload', (req, res) => {
    const d = devices.get(String(req.query.id));
    if (!d) return res.sendStatus(404);
    if (d.pending || d.uploading) return res.sendStatus(409);
    if (limited('upload', req.ip, 20, 10 * 60 * 1000)) {
      return res.sendStatus(429);
    }

    const active = [...devices.values()].filter(
      (x) => x.pending || x.uploading
    );

    if (
      active.length >= maxFiles ||
      active.filter((x) => x.ip === req.ip).length >= maxFilesPerIp
    ) {
      return res.sendStatus(503);
    }

    if (Number(req.headers['content-length']) > maxBytes) {
      res.set('Connection', 'close');
      return res.sendStatus(413);
    }

    d.ip = req.ip;

    const name = path.basename(String(req.query.name || 'file'));
    const file = path.join(dir, crypto.randomUUID());

    let size = 0;

    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;

        if (size > maxBytes) {
          const err = new Error('troppo grande');
          err.code = 'LIMIT_FILE_SIZE';
          cb(err);
          return;
        }

        cb(null, chunk);
      },
    });

    d.uploading = true;

    pipeline(
      req,
      limiter,
      fs.createWriteStream(file),
      (err) => {
        d.uploading = false;

        if (err) {
          fs.unlink(file, () => {});

          if (res.writable && !res.headersSent) {
            res.set('Connection', 'close');
            res.sendStatus(
              err.code === 'LIMIT_FILE_SIZE' ? 413 : 500
            );
          }

          return;
        }

        d.pending = {
          name,
          file,
          ts: Date.now(),
          token: null,
          tokenExp: 0,
        };

        send(d, 'state', stateOf(d));
        res.sendStatus(200);
      }
    );
  });

  return router;
}

module.exports = createUploadRouter;
