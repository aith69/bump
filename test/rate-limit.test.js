const test = require('node:test');
const assert = require('node:assert/strict');

const createRateLimiter = require('../src/services/rate-limit');

test('rate limit: prima richiesta consentita', () => {
  const hits = new Map();
  const limited = createRateLimiter(hits);

  assert.equal(
    limited('upload', '127.0.0.1', 3, 1000),
    false
  );

  assert.equal(
    hits.get('upload:127.0.0.1').length,
    1
  );
});

test('rate limit: raggiunto il limite blocca le richieste successive', () => {
  const hits = new Map();
  const limited = createRateLimiter(hits);

  assert.equal(limited('upload', '127.0.0.1', 2, 1000), false);
  assert.equal(limited('upload', '127.0.0.1', 2, 1000), false);
  assert.equal(limited('upload', '127.0.0.1', 2, 1000), true);
  assert.equal(limited('upload', '127.0.0.1', 2, 1000), true);

  assert.equal(
    hits.get('upload:127.0.0.1').length,
    2
  );
});

test('rate limit: kind e IP sono indipendenti', () => {
  const hits = new Map();
  const limited = createRateLimiter(hits);

  assert.equal(
    limited('upload', '127.0.0.1', 1, 1000),
    false
  );

  // Stessa IP, ma operazione diversa.
  assert.equal(
    limited('share', '127.0.0.1', 1, 1000),
    false
  );

  // Stesso kind, ma IP diversa.
  assert.equal(
    limited('upload', '192.168.0.10', 1, 1000),
    false
  );

  assert.equal(hits.size, 3);
});

test('rate limit: le richieste fuori dalla finestra temporale vengono rimosse', () => {
  const originalNow = Date.now;
  let now = 1000;

  Date.now = () => now;

  try {
    const hits = new Map();
    const limited = createRateLimiter(hits);

    assert.equal(
      limited('upload', '127.0.0.1', 1, 1000),
      false
    );

    // Ancora dentro la finestra: viene bloccata.
    now = 1999;

    assert.equal(
      limited('upload', '127.0.0.1', 1, 1000),
      true
    );

    // La richiesta precedente è ora esattamente fuori finestra.
    now = 2000;

    assert.equal(
      limited('upload', '127.0.0.1', 1, 1000),
      false
    );

    assert.deepEqual(
      hits.get('upload:127.0.0.1'),
      [2000]
    );
  } finally {
    Date.now = originalNow;
  }
});
