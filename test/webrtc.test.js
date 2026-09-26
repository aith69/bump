const test = require('node:test');
const assert = require('node:assert/strict');

const createWebrtc = require('../src/services/webrtc');

function createService(options = {}) {
  const sessions = options.sessions || new Map();

  const service = createWebrtc({
    sessions,
    ttl: options.ttl ?? 30000,
  });

  return { service, sessions };
}

test('webrtc: crea una sessione tra due dispositivi', () => {
  const { service, sessions } = createService();

  const session = service.create('device-a', 'device-b');

  assert.ok(session);
  assert.match(session.id, /^[0-9a-f]{32}$/);
  assert.equal(session.a, 'device-a');
  assert.equal(session.b, 'device-b');
  assert.ok(Number.isInteger(session.expiresAt));
  assert.equal(sessions.get(session.id), session);
});

test('webrtc: get restituisce una sessione esistente e valida', () => {
  const { service } = createService();

  const session = service.create('device-a', 'device-b');

  assert.equal(service.get(session.id), session);
});

test('webrtc: get restituisce null per una sessione inesistente', () => {
  const { service } = createService();

  assert.equal(service.get('missing'), null);
});

test('webrtc: sessione scaduta non viene restituita', () => {
  const { service, sessions } = createService({
    ttl: 0,
  });

  const session = service.create('device-a', 'device-b');

  assert.equal(service.get(session.id), null);
  assert.equal(sessions.has(session.id), false);
});

test('webrtc: isPeer riconosce entrambi i dispositivi', () => {
  const { service } = createService();

  const session = service.create('device-a', 'device-b');

  assert.equal(service.isPeer(session.id, 'device-a'), true);
  assert.equal(service.isPeer(session.id, 'device-b'), true);
});

test('webrtc: isPeer rifiuta un dispositivo estraneo', () => {
  const { service } = createService();

  const session = service.create('device-a', 'device-b');

  assert.equal(service.isPeer(session.id, 'device-c'), false);
});

test('webrtc: remove elimina la sessione', () => {
  const { service, sessions } = createService();

  const session = service.create('device-a', 'device-b');

  assert.equal(service.remove(session.id), true);
  assert.equal(sessions.has(session.id), false);
  assert.equal(service.get(session.id), null);
});

test('webrtc: remove di una sessione inesistente restituisce false', () => {
  const { service } = createService();

  assert.equal(service.remove('missing'), false);
});

test('webrtc: ogni sessione riceve un ID diverso', () => {
  const { service } = createService();

  const first = service.create('device-a', 'device-b');
  const second = service.create('device-c', 'device-d');

  assert.notEqual(first.id, second.id);
});
