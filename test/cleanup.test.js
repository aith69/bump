const test = require('node:test');
const assert = require('node:assert/strict');

const createCleanup = require('../src/services/cleanup');

function runCleanup(options) {
  const originalSetInterval = global.setInterval;

  let callback;
  let interval;

  global.setInterval = (fn, intervalMs) => {
    callback = fn;
    interval = intervalMs;
    return { unref() {} };
  };

  try {
    const result = createCleanup(options);

    assert.ok(callback);
    assert.equal(interval, options.intervalMs);

    callback();

    return result;
  } finally {
    global.setInterval = originalSetInterval;
  }
}

test('cleanup: elimina pending scaduto e invia nuovo stato', () => {
  const device = {
    pending: {
      name: 'expired.txt',
      ts: 1000,
    },
    uploading: false,
    res: null,
  };

  const devices = new Map([
    ['device1', device],
  ]);

  const hits = new Map();

  const dropped = [];
  const sent = [];

  const originalNow = Date.now;
  Date.now = () => 5000;

  try {
    runCleanup({
      devices,
      hits,
      ttl: 1000,
      intervalMs: 25000,
      stateOf: (d) => ({
        pending: !!d.pending,
      }),
      dropPending: (d) => {
        dropped.push(d);
        d.pending = null;
      },
      send: (...args) => sent.push(args),
    });

    assert.equal(dropped.length, 1);
    assert.equal(dropped[0], device);

    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], device);
    assert.equal(sent[0][1], 'state');
    assert.deepEqual(sent[0][2], {
      pending: false,
    });
  } finally {
    Date.now = originalNow;
  }
});

test('cleanup: pending non scaduto viene mantenuto', () => {
  const pending = {
    name: 'valid.txt',
    ts: 4500,
  };

  const device = {
    pending,
    uploading: false,
    res: null,
  };

  const devices = new Map([
    ['device1', device],
  ]);

  const hits = new Map();
  const dropped = [];
  const sent = [];

  const originalNow = Date.now;
  Date.now = () => 5000;

  try {
    runCleanup({
      devices,
      hits,
      ttl: 1000,
      intervalMs: 25000,
      stateOf: () => ({}),
      dropPending: (d) => dropped.push(d),
      send: (...args) => sent.push(args),
    });

    assert.equal(devices.has('device1'), true);
    assert.equal(device.pending, pending);
    assert.equal(dropped.length, 0);
    assert.equal(sent.length, 0);
  } finally {
    Date.now = originalNow;
  }
});

test('cleanup: connessione SSE attiva riceve il ping', () => {
  const writes = [];

  const device = {
    pending: null,
    uploading: false,
    res: {
      write: (data) => writes.push(data),
    },
  };

  const devices = new Map([
    ['device1', device],
  ]);

  const hits = new Map();

  runCleanup({
    devices,
    hits,
    ttl: 1000,
    intervalMs: 25000,
    stateOf: () => ({}),
    dropPending: () => {},
    send: () => {},
  });

  assert.deepEqual(writes, [
    ': ping\n\n',
  ]);

  assert.equal(devices.has('device1'), true);
});

test('cleanup: device scollegato e inattivo viene eliminato', () => {
  const device = {
    pending: null,
    uploading: false,
    res: null,
  };

  const devices = new Map([
    ['device1', device],
  ]);

  const hits = new Map();

  runCleanup({
    devices,
    hits,
    ttl: 1000,
    intervalMs: 25000,
    stateOf: () => ({}),
    dropPending: () => {},
    send: () => {},
  });

  assert.equal(devices.has('device1'), false);
});

test('cleanup: device in upload viene mantenuto anche senza SSE', () => {
  const device = {
    pending: null,
    uploading: true,
    res: null,
  };

  const devices = new Map([
    ['device1', device],
  ]);

  const hits = new Map();

  runCleanup({
    devices,
    hits,
    ttl: 1000,
    intervalMs: 25000,
    stateOf: () => ({}),
    dropPending: () => {},
    send: () => {},
  });

  assert.equal(devices.has('device1'), true);
});

test('cleanup: elimina gli hit rate-limit scaduti e conserva quelli recenti', () => {
  const devices = new Map();

  const hits = new Map([
    ['upload:old', [1000]],
    ['upload:recent', [599000]],
    ['share:old', [1000, 2000]],
  ]);

  const originalNow = Date.now;
  Date.now = () => 602001;

  try {
    runCleanup({
      devices,
      hits,
      ttl: 1000,
      intervalMs: 25000,
      stateOf: () => ({}),
      dropPending: () => {},
      send: () => {},
    });

    assert.equal(hits.has('upload:old'), false);
    assert.equal(hits.has('share:old'), false);
    assert.equal(hits.has('upload:recent'), true);
  } finally {
    Date.now = originalNow;
  }
});
