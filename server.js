const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline, Transform } = require('stream');

const PORT = process.env.PORT || 3000;
// di default solo in locale (dietro un reverse proxy HTTPS); per ascoltare sulla rete: HOST=192.168.x.x
const HOST = process.env.HOST || '127.0.0.1';

const DIR = path.join(__dirname, 'tmp');
const MAX_BYTES = 50 * 1024 * 1024;   // 50 MB per file
const MAX_FILES = 20;                 // file in attesa contemporaneamente su tutto il server
const MAX_FILES_PER_IP = 3;           // ... e per singolo indirizzo IP
const MAX_STREAMS_PER_IP = 10;        // dispositivi collegati contemporaneamente da uno stesso IP
const PAIR_WINDOW = 300;             // ms: distanza massima tra i due bump per abbinarli
const SETTLE = 500;                   // ms: si attende un attimo prima di decidere, per accorgersi di bump "intrusi"
const LOOKBACK = PAIR_WINDOW + SETTLE;
const TTL = 5 * 60 * 1000;            // un file non ritirato viene cancellato dopo 5 minuti
const TOKEN_TTL = 30 * 1000;          // il link di download dopo il bump vale 30 secondi
const SHARE_TTL = 3 * 60 * 1000;      // il link generato con "Crea QR" vale 3 minuti, per dare tempo di inquadrarlo

// all'avvio la cartella temporanea parte sempre vuota
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR);

const ID_RE = /^[0-9a-f]{32}$/;
const devices = new Map();   // id -> { id, res, ip, pending, uploading }   (solo in memoria)
let bumps = [];              // bump recenti: { id, type, t }
const hits = new Map();      // "tipo:ip" -> [timestamp...]  (limiti di frequenza)

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
// dietro nginx serve leggere l'IP reale da X-Forwarded-For; TRUST_PROXY=true per fidarsi di qualsiasi proxy
const tp = process.env.TRUST_PROXY;
app.set('trust proxy', tp === 'true' ? true : tp || 'loopback, uniquelocal');

function limited(kind, ip, max, windowMs) {
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  const over = list.length >= max;
  if (!over) list.push(now);
  hits.set(key, list);
  return over;
}

const stateOf = (d) => ({ pending: d.pending && { name: d.pending.name } });

function send(d, event, data) {
  if (d.res) d.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function dropPending(d) {
  if (d.pending) fs.unlink(d.pending.file, () => {});
  d.pending = null;
}


app.get('/qrcode.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'qrcode.min.js'));
});

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

  const now = Date.now();
  bumps = bumps.filter((b) => now - b.t <= LOOKBACK && b.id !== id);
  bumps.push({ id, type, t: now });
  setTimeout(evaluate, SETTLE);
});

function evaluate() {
  const now = Date.now();

  bumps = bumps.filter((b) => now - b.t <= LOOKBACK);

  // Servono esattamente due bump
  if (bumps.length !== 2) return;

  const [aBump, bBump] = bumps;

  // Devono provenire da due dispositivi diversi
  if (aBump.id === bBump.id) return;

  // Devono essere abbastanza ravvicinati
  if (Math.abs(aBump.t - bBump.t) > PAIR_WINDOW) return;

  // Sono ammesse:
  //   key + motion   -> PC + telefono
  //   motion + motion -> telefono + telefono
  // key + key non è valido
  const validPair =
    (aBump.type === 'key' && bBump.type === 'motion') ||
    (aBump.type === 'motion' && bBump.type === 'key') ||
    (aBump.type === 'motion' && bBump.type === 'motion');

  if (!validPair) return;

  const a = devices.get(aBump.id);
  const b = devices.get(bBump.id);

  if (!a || !b) return;

  // Esattamente uno dei due deve avere un file
  if (!!a.pending === !!b.pending) return;

  const [sender, receiver] = a.pending ? [a, b] : [b, a];

  // Il destinatario deve essere ancora collegato
  if (!receiver.res) return;

  const token = crypto.randomBytes(16).toString('hex');

  sender.pending.token = token;
  sender.pending.tokenExp = now + TOKEN_TTL;

  bumps = [];

  send(receiver, 'download', {
    url: `/download?t=${token}`
  });
}

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
setInterval(() => {
  const now = Date.now();
  for (const [id, d] of devices) {
    if (d.pending && now - d.pending.ts > TTL) {
      dropPending(d);
      send(d, 'state', stateOf(d));
    }
    if (d.res) d.res.write(': ping\n\n');
    else if (!d.pending && !d.uploading) devices.delete(id);
  }
  for (const [k, list] of hits) if (now - list[list.length - 1] > 10 * 60 * 1000) hits.delete(k);
}, 25000);

app.listen(PORT, HOST, () => console.log(`Bump attivo su ${HOST}:${PORT}`));
