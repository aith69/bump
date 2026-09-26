const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadFallback(options) {
  const source = fs.readFileSync(
    'public/js/webrtc-fallback.js',
    'utf8'
  );

  const context = {
    window: {},
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(source, context);

  return context.window.createWebrtcFallback(options);
}

function createFakeTimer() {
  let callback = null;
  let delay = null;
  let cleared = false;

  return {
    setTimer(fn, ms) {
      callback = fn;
      delay = ms;
      return 1;
    },

    clearTimer() {
      cleared = true;
      callback = null;
    },

    fire() {
      if (callback) {
        const fn = callback;
        callback = null;
        fn();
      }
    },

    get delay() {
      return delay;
    },

    get cleared() {
      return cleared;
    },
  };
}

test('webrtc fallback: esegue il fallback dopo il timeout', () => {
  const timer = createFakeTimer();
  let fallbackCalled = 0;

  const fallback = loadFallback({
    timeout: 5000,
    hasUrl: () => true,
    isChannelOpen: () => false,
    isTransferActive: () => false,
    isTransferComplete: () => false,
    fallback: () => {
      fallbackCalled++;
    },
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  fallback.arm();

  assert.equal(timer.delay, 5000);
  assert.equal(fallbackCalled, 0);

  timer.fire();

  assert.equal(fallbackCalled, 1);
});

test('webrtc fallback: non parte senza URL', () => {
  const timer = createFakeTimer();

  const fallback = loadFallback({
    timeout: 5000,
    hasUrl: () => false,
    isChannelOpen: () => false,
    isTransferActive: () => false,
    isTransferComplete: () => false,
    fallback: assert.fail,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  fallback.arm();

  assert.equal(timer.delay, null);
});

test('webrtc fallback: non parte se il canale P2P è già aperto', () => {
  const timer = createFakeTimer();

  const fallback = loadFallback({
    timeout: 5000,
    hasUrl: () => true,
    isChannelOpen: () => true,
    isTransferActive: () => false,
    isTransferComplete: () => false,
    fallback: assert.fail,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  fallback.arm();

  assert.equal(timer.delay, null);
});

test('webrtc fallback: non esegue il fallback se il trasferimento è attivo', () => {
  const timer = createFakeTimer();
  let fallbackCalled = false;

  const fallback = loadFallback({
    timeout: 5000,
    hasUrl: () => true,
    isChannelOpen: () => false,
    isTransferActive: () => true,
    isTransferComplete: () => false,
    fallback: () => {
      fallbackCalled = true;
    },
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  fallback.arm();
  timer.fire();

  assert.equal(fallbackCalled, false);
});

test('webrtc fallback: non esegue il fallback se il trasferimento è completo', () => {
  const timer = createFakeTimer();
  let fallbackCalled = false;

  const fallback = loadFallback({
    timeout: 5000,
    hasUrl: () => true,
    isChannelOpen: () => false,
    isTransferActive: () => false,
    isTransferComplete: () => true,
    fallback: () => {
      fallbackCalled = true;
    },
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  fallback.arm();
  timer.fire();

  assert.equal(fallbackCalled, false);
});

test('webrtc fallback: arm annulla il timer precedente', () => {
  const timer = createFakeTimer();

  const fallback = loadFallback({
    timeout: 5000,
    hasUrl: () => true,
    isChannelOpen: () => false,
    isTransferActive: () => false,
    isTransferComplete: () => false,
    fallback: assert.fail,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  fallback.arm();
  fallback.arm();

  assert.equal(timer.cleared, true);
  assert.equal(timer.delay, 5000);
});

test('webrtc fallback: cancel annulla il timer', () => {
  const timer = createFakeTimer();

  const fallback = loadFallback({
    timeout: 5000,
    hasUrl: () => true,
    isChannelOpen: () => false,
    isTransferActive: () => false,
    isTransferComplete: () => false,
    fallback: assert.fail,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  fallback.arm();
  fallback.cancel();

  assert.equal(timer.cleared, true);
});
