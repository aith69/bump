const express = require('express');
const fs = require('fs');
const path = require('path');
const state = require('./src/store/memory');
const { devices, hits } = state;
const createPairing = require('./src/services/pairing');
const createRateLimiter = require('./src/services/rate-limit');
const createCleanup = require('./src/services/cleanup');
const createDeviceService = require('./src/services/device');
const createSse = require('./src/services/sse');
const createEventsRouter = require('./src/routes/events');
const createFileRouter = require('./src/routes/file');
const createBumpRouter = require('./src/routes/bump');
const createDownloadRouter = require('./src/routes/download');
const createShareRouter = require('./src/routes/share');
const createUploadRouter = require('./src/routes/upload');
const createConfigRouter = require('./src/routes/config');
const createWebrtc = require('./src/services/webrtc');
const prepareLocales = require('./src/services/locales');
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

const deviceService = createDeviceService();
const { stateOf, dropPending } = deviceService;

const webrtc = createWebrtc({
  sessions: state.webrtcSessions,
  ttl: 30000,
});

const sse = createSse();
const { send } = sse;

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

// prepara i file delle traduzioni disponibili per il frontend
prepareLocales();

const ID_RE = /^[0-9a-f]{32}$/;

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  createConfigRouter({
    maxBytes: MAX_BYTES,
    shareTtl: SHARE_TTL,
  })
);
// dietro nginx serve leggere l'IP reale da X-Forwarded-For; TRUST_PROXY=true per fidarsi di qualsiasi proxy
const tp = process.env.TRUST_PROXY;
app.set('trust proxy', tp === 'true' ? true : tp || 'loopback, uniquelocal');

app.use(
  createEventsRouter({
    devices,
    maxStreamsPerIp: MAX_STREAMS_PER_IP,
    idRegex: ID_RE,
    send,
    stateOf,
  })
);
app.use(
  createFileRouter({
    devices,
    dropPending,
    send,
    stateOf,
  })
);
app.use(
  createShareRouter({
    devices,
    limited,
    shareTtl: SHARE_TTL,
  })
);

app.use(
  createUploadRouter({
    devices,
    limited,
    maxBytes: MAX_BYTES,
    maxFiles: MAX_FILES,
    maxFilesPerIp: MAX_FILES_PER_IP,
    dir: DIR,
    send,
    stateOf,
  })
);

// Bump. Ogni bump registra "chi" (dispositivo) e "come" (tasto oppure movimento), poi dopo SETTLE ms
// si valuta la situazione. L'abbinamento parte SOLO se negli ultimi istanti hanno colpito esattamente due
// dispositivi: uno con la barra spaziatrice ("key") e uno con l'accelerometro ("motion"), a meno di
// PAIR_WINDOW ms di distanza, e uno solo dei due ha un file. Se i dispositivi coinvolti sono di più
// l'abbinamento è ambiguo e non parte nulla (si riprova).
app.use(
  createBumpRouter({
    devices,
    limited,
    pairing,
  })
);

// alcuni browser sondano l'URL con HEAD: non deve consumare il file
app.use(
  createDownloadRouter({
    devices,
    send,
    stateOf,
  })
);

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
