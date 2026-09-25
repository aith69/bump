const test = require('node:test');
const assert = require('node:assert/strict');

const createShareRouter = require('../src/routes/share');

function createResponse() {
  return {
    statusCode: null,
    body: null,

    sendStatus(code) {
      this.statusCode = code;
      return this;
    },

    json(value) {
      this.body = value;
      return this;
    },
  };
}

function getHandler(options = {}) {
  const router = createShareRouter({
    devices: options.devices || new Map(),
    limited: options.limited || (() => false),
    shareTtl: options.shareTtl ?? 180000,
  });

  const layer = router.stack.find(
    (x) => x.route && x.route.path === '/share'
  );

  return layer.route.stack[0].handle;
}

test('share: dispositivo sconosciuto -> 404', () => {
  const handler = getHandler();
  const res = createResponse();

  handler(
    {
      query: { id: 'missing' },
      ip: '127.0.0.1',
    },
    res
  );

  assert.equal(res.statusCode, 404);
});

test('share: nessun file pending -> 404', () => {
  const devices = new Map([
    ['device1', {
      pending: null,
    }],
  ]);

  const handler = getHandler({ devices });
  const res = createResponse();

  handler(
    {
      query: { id: 'device1' },
      ip: '127.0.0.1',
    },
    res
  );

  assert.equal(res.statusCode, 404);
});

test('share: rate limit -> 429', () => {
  const devices = new Map([
    ['device1', {
      pending: {
        name: 'test.txt',
        file: '/tmp/test',
        token: null,
        tokenExp: 0,
      },
    }],
  ]);

  const handler = getHandler({
    devices,
    limited: () => true,
  });

  const res = createResponse();

  handler(
    {
      query: { id: 'device1' },
      ip: '127.0.0.1',
    },
    res
  );

  assert.equal(res.statusCode, 429);
});

test('share: crea token e imposta correttamente la scadenza', () => {
  const shareTtl = 180000;

  const pending = {
    name: 'test.txt',
    file: '/tmp/test',
    token: null,
    tokenExp: 0,
  };

  const devices = new Map([
    ['device1', {
      pending,
    }],
  ]);

  const handler = getHandler({
    devices,
    shareTtl,
  });

  const res = createResponse();

  const before = Date.now();

  handler(
    {
      query: { id: 'device1' },
      ip: '127.0.0.1',
    },
    res
  );

  const after = Date.now();

  assert.equal(res.statusCode, null);
  assert.ok(res.body);

  assert.match(
    pending.token,
    /^[0-9a-f]{32}$/
  );

  assert.equal(
    res.body.url,
    `/download?t=${pending.token}`
  );

  assert.ok(
    pending.tokenExp >= before + shareTtl &&
    pending.tokenExp <= after + shareTtl
  );
});

test('share: ogni richiesta genera un nuovo token', () => {
  const pending = {
    name: 'test.txt',
    file: '/tmp/test',
    token: null,
    tokenExp: 0,
  };

  const devices = new Map([
    ['device1', {
      pending,
    }],
  ]);

  const handler = getHandler({ devices });

  const firstRes = createResponse();

  handler(
    {
      query: { id: 'device1' },
      ip: '127.0.0.1',
    },
    firstRes
  );

  const firstToken = pending.token;

  const secondRes = createResponse();

  handler(
    {
      query: { id: 'device1' },
      ip: '127.0.0.1',
    },
    secondRes
  );

  assert.ok(firstToken);
  assert.ok(pending.token);
  assert.notEqual(pending.token, firstToken);
  assert.equal(
    secondRes.body.url,
    `/download?t=${pending.token}`
  );
});
