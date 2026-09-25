const test = require('node:test');
const assert = require('node:assert/strict');

const createPairing = require('../src/services/pairing');

const PAIR_WINDOW = 300;
const SETTLE = 500;
const LOOKBACK = PAIR_WINDOW + SETTLE;
const TOKEN_TTL = 30 * 1000;

function createFixture() {
  const state = {
    bumps: [],
  };

  const devices = new Map();

  const sent = [];

  const send = (device, event, data) => {
    sent.push({ device, event, data });
  };

  const pairing = createPairing({
    state,
    devices,
    send,
    pairWindow: PAIR_WINDOW,
    settle: SETTLE,
    lookback: LOOKBACK,
    tokenTtl: TOKEN_TTL,
  });

  return {
    state,
    devices,
    sent,
    pairing,
  };
}

function addDevice(devices, id, options = {}) {
  const device = {
    id,
    res: Object.prototype.hasOwnProperty.call(options, 'res') ? options.res : {},
    pending: options.pending ?? null,
  };

  devices.set(id, device);

  return device;
}

function addPending(name = 'file.txt') {
  return {
    name,
    file: `/tmp/${name}`,
    ts: Date.now(),
    token: null,
    tokenExp: 0,
  };
}

function settle(context) {
  context.mock.timers.tick(SETTLE);
}

test('key + motion pairs two different devices', (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 1000,
  });

  const { state, devices, sent, pairing } = createFixture();

  const sender = addDevice(devices, 'a', {
    pending: addPending(),
  });

  const receiver = addDevice(devices, 'b');

  pairing.record('a', 'key');
  pairing.record('b', 'motion');

  settle(context);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].device, receiver);
  assert.equal(sent[0].event, 'download');

  const url = sent[0].data.url;

  assert.match(url, /^\/download\?t=[0-9a-f]{32}$/);

  const token = url.slice('/download?t='.length);

  assert.equal(sender.pending.token, token);
  assert.equal(sender.pending.tokenExp, 1500 + TOKEN_TTL);
  assert.deepEqual(state.bumps, []);
});

test('motion + key pairs two different devices', (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 1000,
  });

  const { devices, sent, pairing } = createFixture();

  const sender = addDevice(devices, 'a', {
    pending: addPending(),
  });

  const receiver = addDevice(devices, 'b');

  pairing.record('a', 'motion');
  pairing.record('b', 'key');

  settle(context);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].device, receiver);
  assert.equal(sent[0].event, 'download');

  assert.ok(sender.pending.token);
  assert.match(sender.pending.token, /^[0-9a-f]{32}$/);
});

test('motion + motion pairs two phones', (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 1000,
  });

  const { devices, sent, pairing } = createFixture();

  const sender = addDevice(devices, 'a', {
    pending: addPending(),
  });

  const receiver = addDevice(devices, 'b');

  pairing.record('a', 'motion');
  pairing.record('b', 'motion');

  settle(context);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].device, receiver);
  assert.ok(sender.pending.token);
});

test('key + key does not pair', (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 1000,
  });

  const { devices, sent, pairing } = createFixture();

  addDevice(devices, 'a', {
    pending: addPending(),
  });

  addDevice(devices, 'b');

  pairing.record('a', 'key');
  pairing.record('b', 'key');

  settle(context);

  assert.equal(sent.length, 0);
});

test('two bumps from the same device do not pair', (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 1000,
  });

  const { devices, sent, pairing } = createFixture();

  addDevice(devices, 'a', {
    pending: addPending(),
  });

  pairing.record('a', 'key');
  pairing.record('a', 'motion');

  settle(context);

  assert.equal(sent.length, 0);
});

test('bumps outside pair window do not pair', (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 1000,
  });

  const { devices, sent, pairing } = createFixture();

  addDevice(devices, 'a', {
    pending: addPending(),
  });

  addDevice(devices, 'b');

  pairing.record('a', 'key');

  context.mock.timers.tick(PAIR_WINDOW + 1);

  pairing.record('b', 'motion');

  settle(context);

  assert.equal(sent.length, 0);
});

test('both devices with a pending file do not pair', (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 1000,
  });

  const { devices, sent, pairing } = createFixture();

  addDevice(devices, 'a', {
    pending: addPending('a.txt'),
  });

  addDevice(devices, 'b', {
    pending: addPending('b.txt'),
  });

  pairing.record('a', 'key');
  pairing.record('b', 'motion');

  settle(context);

  assert.equal(sent.length, 0);
});

test('neither device with a pending file does not pair', (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 1000,
  });

  const { devices, sent, pairing } = createFixture();

  addDevice(devices, 'a');
  addDevice(devices, 'b');

  pairing.record('a', 'key');
  pairing.record('b', 'motion');

  settle(context);

  assert.equal(sent.length, 0);
});

test('receiver without an active SSE connection does not pair', (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 1000,
  });

  const { devices, sent, pairing } = createFixture();

  addDevice(devices, 'a', {
    pending: addPending(),
  });

  addDevice(devices, 'b', {
    res: null,
  });

  pairing.record('a', 'key');
  pairing.record('b', 'motion');

  settle(context);

  assert.equal(sent.length, 0);
});

test('missing device does not pair', (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: 1000,
  });

  const { devices, sent, pairing } = createFixture();

  addDevice(devices, 'a', {
    pending: addPending(),
  });

  pairing.record('a', 'key');
  pairing.record('missing', 'motion');

  settle(context);

  assert.equal(sent.length, 0);
});
