const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const createDownloadRouter = require('../src/routes/download');

function createResponse() {
  return {
    statusCode: null,
    downloaded: null,
    downloadCallback: null,

    sendStatus(code) {
      this.statusCode = code;
      return this;
    },

    download(file, name, callback) {
      this.downloaded = { file, name };
      this.downloadCallback = callback;
      return this;
    },
  };
}

function getHandlers(options = {}) {
  const router = createDownloadRouter({
    devices: options.devices || new Map(),
    send: options.send || (() => {}),
    stateOf: options.stateOf || ((d) => ({
      pending: !!d.pending,
    })),
  });

  const headLayer = router.stack.find(
    (x) => x.route && x.route.path === '/download' && x.route.methods.head
  );

  const getLayer = router.stack.find(
    (x) => x.route && x.route.path === '/download' && x.route.methods.get
  );

  return {
    head: headLayer.route.stack[0].handle,
    get: getLayer.route.stack[0].handle,
  };
}

async function waitFor(predicate, timeout = 1000) {
  const start = Date.now();

  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error('timeout waiting for condition');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function createTempFile(content = 'test content') {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'bump-download-')
  );

  const file = path.join(dir, 'file');
  await fs.promises.writeFile(file, content);

  return { dir, file };
}

test('download HEAD -> 200', () => {
  const { head } = getHandlers();
  const res = createResponse();

  head({}, res);

  assert.equal(res.statusCode, 200);
});

test('download con token inesistente -> 404', () => {
  const devices = new Map([
    ['device1', {
      pending: {
        token: 'valid-token',
        tokenExp: Date.now() + 30000,
      },
    }],
  ]);

  const { get } = getHandlers({ devices });
  const res = createResponse();

  get(
    {
      query: { t: 'wrong-token' },
    },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.downloaded, null);
});

test('download con token scaduto -> 404', () => {
  const devices = new Map([
    ['device1', {
      pending: {
        token: 'expired-token',
        tokenExp: Date.now() - 1,
      },
    }],
  ]);

  const { get } = getHandlers({ devices });
  const res = createResponse();

  get(
    {
      query: { t: 'expired-token' },
    },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.downloaded, null);
});

test('download valido -> pending consumato e stato aggiornato', async () => {
  const { dir, file } = await createTempFile('hello');

  const device = {
    pending: {
      name: 'prova.txt',
      file,
      token: 'valid-token',
      tokenExp: Date.now() + 30000,
    },
  };

  const devices = new Map([
    ['device1', device],
  ]);

  const sent = [];

  const { get } = getHandlers({
    devices,
    send: (...args) => sent.push(args),
    stateOf: (d) => ({
      pending: !!d.pending,
    }),
  });

  const res = createResponse();

  get(
    {
      query: { t: 'valid-token' },
    },
    res
  );

  assert.equal(res.statusCode, null);
  assert.equal(device.pending, null);

  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], device);
  assert.equal(sent[0][1], 'state');
  assert.deepEqual(sent[0][2], {
    pending: false,
  });

  assert.deepEqual(res.downloaded, {
    file,
    name: 'prova.txt',
  });

  assert.equal(res.downloadCallback !== null, true);

  await res.downloadCallback(null);

  await waitFor(async () => {
    try {
      await fs.promises.access(file);
      return false;
    } catch {
      return true;
    }
  });

  assert.equal(sent.length, 2);
  assert.equal(sent[1][0], device);
  assert.equal(sent[1][1], 'done');
  assert.deepEqual(sent[1][2], {});

  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('download con errore -> file eliminato ma nessun done', async () => {
  const { dir, file } = await createTempFile('hello');

  const device = {
    pending: {
      name: 'errore.txt',
      file,
      token: 'error-token',
      tokenExp: Date.now() + 30000,
    },
  };

  const devices = new Map([
    ['device1', device],
  ]);

  const sent = [];

  const { get } = getHandlers({
    devices,
    send: (...args) => sent.push(args),
  });

  const res = createResponse();

  get(
    {
      query: { t: 'error-token' },
    },
    res
  );

  assert.equal(device.pending, null);
  assert.ok(res.downloadCallback);

  await res.downloadCallback(new Error('download failed'));

  await waitFor(async () => {
    try {
      await fs.promises.access(file);
      return false;
    } catch {
      return true;
    }
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], 'state');

  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('download: il token viene consumato una sola volta', async () => {
  const { dir, file } = await createTempFile('hello');

  const device = {
    pending: {
      name: 'one-shot.txt',
      file,
      token: 'one-shot-token',
      tokenExp: Date.now() + 30000,
    },
  };

  const devices = new Map([
    ['device1', device],
  ]);

  const { get } = getHandlers({ devices });

  const firstRes = createResponse();

  get(
    {
      query: { t: 'one-shot-token' },
    },
    firstRes
  );

  assert.ok(firstRes.downloaded);
  assert.equal(device.pending, null);

  const secondRes = createResponse();

  get(
    {
      query: { t: 'one-shot-token' },
    },
    secondRes
  );

  assert.equal(secondRes.statusCode, 404);
  assert.equal(secondRes.downloaded, null);

  await firstRes.downloadCallback(null);

  await fs.promises.rm(dir, { recursive: true, force: true });
});
