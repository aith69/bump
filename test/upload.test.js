const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const createUploadRouter = require('../src/routes/upload');

function createResponse() {
  return {
    statusCode: null,
    headers: {},
    sent: null,
    writable: true,
    headersSent: false,

    set(name, value) {
      this.headers[name] = value;
      return this;
    },

    sendStatus(code) {
      this.statusCode = code;
      this.sent = code;
      return this;
    },
  };
}

function getUploadHandler(options = {}) {
  const router = createUploadRouter({
    devices: options.devices || new Map(),
    limited: options.limited || (() => false),
    maxBytes: options.maxBytes ?? 100,
    maxFiles: options.maxFiles ?? 20,
    maxFilesPerIp: options.maxFilesPerIp ?? 3,
    dir: options.dir,
    send: options.send || (() => {}),
    stateOf: options.stateOf || ((d) => ({
      pending: !!d.pending,
      uploading: !!d.uploading,
    })),
  });

  const layer = router.stack.find(
    (x) => x.route && x.route.path === '/upload'
  );

  return layer.route.stack[0].handle;
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

test('upload: dispositivo sconosciuto -> 404', async () => {
  const res = createResponse();

  const handler = getUploadHandler({
    dir: await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'bump-upload-')
    ),
  });

  const req = Readable.from([]);
  req.query = { id: 'missing' };
  req.ip = '127.0.0.1';
  req.headers = {};

  handler(req, res);

  assert.equal(res.statusCode, 404);
});

test('upload: file già pending -> 409', async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'bump-upload-')
  );

  const devices = new Map([
    ['device1', {
      pending: {
        name: 'old.txt',
        file: '/tmp/old',
      },
      uploading: false,
    }],
  ]);

  const res = createResponse();

  const handler = getUploadHandler({ devices, dir });

  const req = Readable.from([]);
  req.query = { id: 'device1' };
  req.ip = '127.0.0.1';
  req.headers = {};

  handler(req, res);

  assert.equal(res.statusCode, 409);
});

test('upload: upload già in corso -> 409', async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'bump-upload-')
  );

  const devices = new Map([
    ['device1', {
      pending: null,
      uploading: true,
    }],
  ]);

  const res = createResponse();

  const handler = getUploadHandler({ devices, dir });

  const req = Readable.from([]);
  req.query = { id: 'device1' };
  req.ip = '127.0.0.1';
  req.headers = {};

  handler(req, res);

  assert.equal(res.statusCode, 409);
});

test('upload: rate limit -> 429', async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'bump-upload-')
  );

  const devices = new Map([
    ['device1', {
      pending: null,
      uploading: false,
    }],
  ]);

  const res = createResponse();

  const handler = getUploadHandler({
    devices,
    dir,
    limited: () => true,
  });

  const req = Readable.from([]);
  req.query = { id: 'device1' };
  req.ip = '127.0.0.1';
  req.headers = {};

  handler(req, res);

  assert.equal(res.statusCode, 429);
});

test('upload: limite globale file attivi -> 503', async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'bump-upload-')
  );

  const devices = new Map([
    ['device1', {
      pending: null,
      uploading: false,
      ip: '127.0.0.1',
    }],
    ['device2', {
      pending: {
        name: 'file.txt',
        file: '/tmp/file',
      },
      uploading: false,
      ip: '192.168.0.2',
    }],
  ]);

  const res = createResponse();

  const handler = getUploadHandler({
    devices,
    dir,
    maxFiles: 1,
  });

  const req = Readable.from([]);
  req.query = { id: 'device1' };
  req.ip = '127.0.0.1';
  req.headers = {};

  handler(req, res);

  assert.equal(res.statusCode, 503);
});

test('upload: limite file attivi per IP -> 503', async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'bump-upload-')
  );

  const devices = new Map([
    ['device1', {
      pending: null,
      uploading: false,
      ip: '127.0.0.1',
    }],
    ['device2', {
      pending: {
        name: 'file.txt',
        file: '/tmp/file',
      },
      uploading: false,
      ip: '127.0.0.1',
    }],
  ]);

  const res = createResponse();

  const handler = getUploadHandler({
    devices,
    dir,
    maxFilesPerIp: 1,
  });

  const req = Readable.from([]);
  req.query = { id: 'device1' };
  req.ip = '127.0.0.1';
  req.headers = {};

  handler(req, res);

  assert.equal(res.statusCode, 503);
});

test('upload: Content-Length oltre limite -> 413', async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'bump-upload-')
  );

  const devices = new Map([
    ['device1', {
      pending: null,
      uploading: false,
    }],
  ]);

  const res = createResponse();

  const handler = getUploadHandler({
    devices,
    dir,
    maxBytes: 100,
  });

  const req = Readable.from([]);
  req.query = {
    id: 'device1',
    name: 'file.txt',
  };
  req.ip = '127.0.0.1';
  req.headers = {
    'content-length': '101',
  };

  handler(req, res);

  assert.equal(res.statusCode, 413);
  assert.equal(res.headers.Connection, 'close');
  assert.equal(devices.get('device1').uploading, false);
});

test('upload: upload valido -> pending + 200 + state', async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'bump-upload-')
  );

  const devices = new Map([
    ['device1', {
      pending: null,
      uploading: false,
    }],
  ]);

  const sent = [];

  const res = createResponse();

  const handler = getUploadHandler({
    devices,
    dir,
    maxBytes: 100,
    send: (...args) => sent.push(args),
    stateOf: (d) => ({
      name: d.pending?.name,
      uploading: d.uploading,
    }),
  });

  const req = Readable.from([
    Buffer.from('hello world'),
  ]);

  req.query = {
    id: 'device1',
    name: 'cartella/../prova.txt',
  };
  req.ip = '192.168.0.10';
  req.headers = {
    'content-length': '11',
  };

  handler(req, res);

  await waitFor(() => res.statusCode !== null);

  const device = devices.get('device1');

  assert.equal(res.statusCode, 200);
  assert.equal(device.uploading, false);
  assert.ok(device.pending);
  assert.equal(device.pending.name, 'prova.txt');
  assert.equal(device.pending.token, null);
  assert.equal(device.pending.tokenExp, 0);
  assert.equal(device.ip, '192.168.0.10');

  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], device);
  assert.equal(sent[0][1], 'state');

  const content = await fs.promises.readFile(device.pending.file, 'utf8');
  assert.equal(content, 'hello world');

  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('upload: body oltre limite -> errore e file temporaneo rimosso', async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'bump-upload-')
  );

  const devices = new Map([
    ['device1', {
      pending: null,
      uploading: false,
    }],
  ]);

  const res = createResponse();

  const handler = getUploadHandler({
    devices,
    dir,
    maxBytes: 5,
  });

  const req = Readable.from([
    Buffer.from('123456789'),
  ]);

  req.query = {
    id: 'device1',
    name: 'big.txt',
  };
  req.ip = '127.0.0.1';
  req.headers = {};

  handler(req, res);

  await waitFor(() => devices.get('device1').uploading === false);

  assert.equal(devices.get('device1').pending, null);

  const files = await fs.promises.readdir(dir);
  assert.deepEqual(files, []);

  assert.equal(res.statusCode, 500);

  await fs.promises.rm(dir, { recursive: true, force: true });
});
