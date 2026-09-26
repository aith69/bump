const test = require('node:test');
const assert = require('node:assert/strict');

const createConfigRouter = require('../src/routes/config');

function createResponse() {
  return {
    body: null,

    json(value) {
      this.body = value;
      return this;
    },
  };
}

function getHandler(options = {}) {
  const router = createConfigRouter({
    maxBytes: options.maxBytes ?? 50 * 1024 * 1024,
    shareTtl: options.shareTtl ?? 180000,
  });

  const layer = router.stack.find(
    (x) => x.route && x.route.path === '/config'
  );

  return layer.route.stack[0].handle;
}

test('config: restituisce maxBytes e shareTtl', () => {
  const handler = getHandler({
    maxBytes: 123456,
    shareTtl: 654321,
  });

  const res = createResponse();

  handler({}, res);

  assert.deepEqual(res.body, {
    maxBytes: 123456,
    shareTtl: 654321,
  });
});

test('config: usa i valori ricevuti dal router', () => {
  const handler = getHandler({
    maxBytes: 50 * 1024 * 1024,
    shareTtl: 3 * 60 * 1000,
  });

  const res = createResponse();

  handler({}, res);

  assert.equal(res.body.maxBytes, 50 * 1024 * 1024);
  assert.equal(res.body.shareTtl, 3 * 60 * 1000);
});

test('config: non espone altre impostazioni', () => {
  const handler = getHandler({
    maxBytes: 123,
    shareTtl: 456,
  });

  const res = createResponse();

  handler({}, res);

  assert.deepEqual(Object.keys(res.body).sort(), [
    'maxBytes',
    'shareTtl',
  ]);
});
