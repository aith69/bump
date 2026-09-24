const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline, Transform } = require('stream');
const state = require('./src/store/memory');
const { devices, hits } = state;
const createPairing = require('./src/services/pairing');
const createRateLimiter = require('./src/services/rate-limit');
const createCleanup = require('./src/services/cleanup');
const {
  PORT,
  HOST,
  DIR,
  MAX_BYTES,
  MAX_FILES,
  MAX_FILES_PER_IP,
  MAX_STREAMS_PER_IP,
  PAIR_WINDOW,
  SETTLE,
  LOOKBACK,
  TTL,
  TOKEN_TTL,
  SHARE_TTL,
} = require("./src/config");
const limited = createRateLimiter(hits);
const pairing = createPairing({
  state,
  devices,
  send,
  pairWindow: PAIR_WINDOW,
  settle: SETTLE,
  lookback: LOOKBACK,
  tokenTtl: TOKEN_TTL,
});

// all'avvio la cartella temporanea parte sempre vuota
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR);

const ID_RE = /^[0-9a-f]{32}$/;

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
// dietro nginx serve leggere l'IP reale da X-Forwarded-For; TRUST_PROXY=true per fidarsi di qualsiasi proxy
const tp = process.env.TRUST_PROXY;
app.set('trust proxy', tp === 'true' ? true : tp || 'loopback, uniquelocal');

const stateOf = (d) => ({ pending: d.pending && { name: d.pending.name } });

function send(d, event, data) {
  if (d.res) d.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function dropPending(d) {
  if (d.pending) fs.unlink(d.pending.file, () => {});
  d.pending = null;
}



// canale server -> dispositivo (stato del proprio file, ordine di download, conferma)
app.get('/events', (req, res) => {
  const id = String(req.query.id);
  if (!ID_RE.test(id)) return res.sendStatus(400);
  const streams = [...devices.values()].filter((x) => x.res && x.ip === req.ip && x.id !== id).length;
  if (streams >= MAX_STREAMS_PER_IP) return res.sendStatus(429);

  let d = devices.get(id);
  if (!d) devices.set(id, (d = { id, res: null, ip: req.ip, pending: null, uploading: false }));
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

// upload in streaming (niente memoria) con limite di dimensione
app.post('/upload', (req, res) => {
  const d = devices.get(String(req.query.id));
  if (!d) return res.sendStatus(404);
  if (d.pending || d.uploading) return res.sendStatus(409);
  if (limited('upload', req.ip, 20, 10 * 60 * 1000)) return res.sendStatus(429);

  const active = [...devices.values()].filter((x) => x.pending || x.uploading);
  if (active.length >= MAX_FILES || active.filter((x) => x.ip === req.ip).length >= MAX_FILES_PER_IP) {
    return res.sendStatus(503);
  }
  if (Number(req.headers['content-length']) > MAX_BYTES) {
    res.set('Connection', 'close');
    return res.sendStatus(413);
  }

  d.ip = req.ip;
  const name = path.basename(String(req.query.name || 'file'));
  const file = path.join(DIR, crypto.randomUUID());

  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      cb(size > MAX_BYTES ? new Error('troppo grande') : null, chunk);
    },
  });

  d.uploading = true;
  pipeline(req, limiter, fs.createWriteStream(file), (err) => {
    d.uploading = false;
    if (err) {
      fs.unlink(file, () => {});
      if (res.writable && !res.headersSent) res.sendStatus(500);
      return;
    }
    d.pending = { name, file, ts: Date.now(), token: null, tokenExp: 0 };
    send(d, 'state', stateOf(d));
    res.sendStatus(200);
  });
});

// rimozione manuale del proprio file in attesa (la X nella pagina)
app.delete('/file', (req, res) => {
  const d = devices.get(String(req.query.id));
  if (!d) return res.sendStatus(404);
  dropPending(d);
  send(d, 'state', stateOf(d));
  res.sendStatus(200);
});

// genera un link di download monouso per il proprio file in attesa, da mostrare come QR
// (alternativa al bump, per quando l'accelerometro non è disponibile o non funziona)
app.post('/share', (req, res) => {
  const d = devices.get(String(req.query.id));
  if (!d) return res.sendStatus(404);
  if (!d.pending) return res.sendStatus(404);
  if (limited('share', req.ip, 30, 10 * 60 * 1000)) return res.sendStatus(429);

  const token = crypto.randomBytes(16).toString('hex');
  d.pending.token = token;
  d.pending.tokenExp = Date.now() + SHARE_TTL;
  res.json({ url: `/download?t=${token}` });
});

// Bump. Ogni bump registra "chi" (dispositivo) e "come" (tasto oppure movimento), poi dopo SETTLE ms
// si valuta la situazione. L'abbinamento parte SOLO se negli ultimi istanti hanno colpito esattamente due
// dispositivi: uno con la barra spaziatrice ("key") e uno con l'accelerometro ("motion"), a meno di
// PAIR_WINDOW ms di distanza, e uno solo dei due ha un file. Se i dispositivi coinvolti sono di più
// l'abbinamento è ambiguo e non parte nulla (si riprova).
app.post('/bump', (req, res) => {
  const id = String(req.query.id);
  const type = String(req.query.type);
  if (!devices.has(id)) return res.sendStatus(404);
  if (type !== 'key' && type !== 'motion') return res.sendStatus(400);
  if (limited('bump', req.ip, 12, 60 * 1000)) return res.sendStatus(429);
  res.sendStatus(200);

  pairing.record(id, type);

});

// alcuni browser sondano l'URL con HEAD: non deve consumare il file
app.head('/download', (req, res) => res.sendStatus(200));

// download una tantum, con link monouso ricevuto solo dal dispositivo abbinato
app.get('/download', (req, res) => {
  const t = String(req.query.t);
  const now = Date.now();
  const owner = [...devices.values()].find((x) => x.pending && x.pending.token === t && now < x.pending.tokenExp);
  if (!owner) return res.sendStatus(404);

  const p = owner.pending;
  owner.pending = null;
  send(owner, 'state', stateOf(owner));
  res.download(p.file, p.name, (err) => {
    fs.unlink(p.file, () => {});
    if (!err) send(owner, 'done', {});
  });
});

// manutenzione: scadenza dei file, dispositivi scollegati, contatori, ping per le connessioni SSE
createCleanup({
  devices,
  hits,
  ttl: TTL,
  intervalMs: 25000,
  stateOf,
  dropPending,
  send,
});

app.listen(PORT, HOST, () => console.log(`Bump attivo su ${HOST}:${PORT}`));
