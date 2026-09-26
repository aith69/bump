const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

const createWebrtcRouter = require('../src/routes/webrtc');

function createTestServer() {
  const sessions = new Map();
  const devices = new Map();
  const messages = [];
  const removedSessions = [];
  const droppedPending = [];

  const router = createWebrtcRouter({
    webrtc: {
      get(id) {
        return sessions.get(id) || null;
      },
      isPeer(id, deviceId) {
        const session = sessions.get(id);
        return !!session &&
          (session.a === deviceId || session.b === deviceId);
      },
      remove(id) {
        removedSessions.push(id);
        return sessions.delete(id);
      },
    },
    devices,
    send(device, event, data) {
      messages.push({ device, event, data });
    },
    dropPending(device) {
      droppedPending.push(device);
      device.pending = null;
    },
    stateOf(device) {
      return {
        pending: !!device.pending,
      };
    },
  });

  const app = express();
  app.use(express.json());
  app.use(router);

  const server = http.createServer(app);

  return {
    server,
    sessions,
    devices,
    messages,
    removedSessions,
    droppedPending,
  };
}

function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let response = '';

        res.on('data', (chunk) => {
          response += chunk;
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: response ? JSON.parse(response) : null,
          });
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function addSession(sessions) {
  sessions.set('session-1', {
    id: 'session-1',
    a: 'device-a',
    b: 'device-b',
    expiresAt: Date.now() + 30000,
  });
}

test('webrtc route: inoltra un offer al peer della sessione', async () => {
  const { server, sessions, devices, messages } = createTestServer();

  addSession(sessions);

  const deviceA = {};
  const deviceB = {};

  devices.set('device-a', deviceA);
  devices.set('device-b', deviceB);

  await new Promise((resolve) => server.listen(0, resolve));

  const response = await request(server, 'POST', '/webrtc/offer', {
    sessionId: 'session-1',
    deviceId: 'device-a',
    payload: {
      type: 'offer',
      sdp: 'test-sdp',
    },
  });

  server.close();

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });

  assert.deepEqual(messages, [
    {
      device: deviceB,
      event: 'webrtc-offer',
      data: {
        sessionId: 'session-1',
        payload: {
          type: 'offer',
          sdp: 'test-sdp',
        },
      },
    },
  ]);
});

test('webrtc route: rifiuta una richiesta senza sessionId', async () => {
  const { server } = createTestServer();

  await new Promise((resolve) => server.listen(0, resolve));

  const response = await request(server, 'POST', '/webrtc/offer', {
    deviceId: 'device-a',
    payload: {
      type: 'offer',
      sdp: 'test-sdp',
    },
  });

  server.close();

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Invalid request' });
});

test('webrtc route: rifiuta una richiesta senza deviceId', async () => {
  const { server } = createTestServer();

  await new Promise((resolve) => server.listen(0, resolve));

  const response = await request(server, 'POST', '/webrtc/offer', {
    sessionId: 'session-1',
    payload: {
      type: 'offer',
      sdp: 'test-sdp',
    },
  });

  server.close();

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Invalid request' });
});

test('webrtc route: rifiuta una richiesta senza payload', async () => {
  const { server } = createTestServer();

  await new Promise((resolve) => server.listen(0, resolve));

  const response = await request(server, 'POST', '/webrtc/offer', {
    sessionId: 'session-1',
    deviceId: 'device-a',
  });

  server.close();

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Invalid request' });
});

test('webrtc route: rifiuta una sessione inesistente', async () => {
  const { server } = createTestServer();

  await new Promise((resolve) => server.listen(0, resolve));

  const response = await request(server, 'POST', '/webrtc/offer', {
    sessionId: 'missing',
    deviceId: 'device-a',
    payload: {
      type: 'offer',
      sdp: 'test-sdp',
    },
  });

  server.close();

  assert.equal(response.status, 404);
});

test('webrtc route: rifiuta un device che non appartiene alla sessione', async () => {
  const { server, sessions, devices } = createTestServer();

  addSession(sessions);
  devices.set('device-a', {});
  devices.set('device-b', {});
  devices.set('device-c', {});

  await new Promise((resolve) => server.listen(0, resolve));

  const response = await request(server, 'POST', '/webrtc/offer', {
    sessionId: 'session-1',
    deviceId: 'device-c',
    payload: {
      type: 'offer',
      sdp: 'test-sdp',
    },
  });

  server.close();

  assert.equal(response.status, 403);
});

test('webrtc route: inoltra answer e ice al peer corretto', async () => {
  const { server, sessions, devices, messages } = createTestServer();

  addSession(sessions);

  const deviceA = {};
  const deviceB = {};

  devices.set('device-a', deviceA);
  devices.set('device-b', deviceB);

  await new Promise((resolve) => server.listen(0, resolve));

  const answer = await request(server, 'POST', '/webrtc/answer', {
    sessionId: 'session-1',
    deviceId: 'device-b',
    payload: {
      type: 'answer',
      sdp: 'answer-sdp',
    },
  });

  const ice = await request(server, 'POST', '/webrtc/ice', {
    sessionId: 'session-1',
    deviceId: 'device-b',
    payload: {
      candidate: 'candidate-data',
    },
  });

  server.close();

  assert.equal(answer.status, 200);
  assert.equal(ice.status, 200);

  assert.deepEqual(messages, [
    {
      device: deviceA,
      event: 'webrtc-answer',
      data: {
        sessionId: 'session-1',
        payload: {
          type: 'answer',
          sdp: 'answer-sdp',
        },
      },
    },
    {
      device: deviceA,
      event: 'webrtc-ice',
      data: {
        sessionId: 'session-1',
        payload: {
          candidate: 'candidate-data',
        },
      },
    },
  ]);
});

test('webrtc complete: il destinatario conferma il trasferimento P2P', async () => {
  const {
    server,
    sessions,
    devices,
    messages,
    removedSessions,
    droppedPending,
  } = createTestServer();

  addSession(sessions);

  const sender = {
    id: 'device-a',
    pending: {
      file: '/tmp/test-file',
      name: 'test.txt',
    },
  };

  const receiver = {
    id: 'device-b',
    pending: null,
  };

  devices.set(sender.id, sender);
  devices.set(receiver.id, receiver);

  await new Promise((resolve) => server.listen(0, resolve));

  const result = await request(server, 'POST', '/webrtc/complete', {
    sessionId: 'session-1',
    deviceId: 'device-b',
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });

  assert.equal(sender.pending, null);
  assert.deepEqual(droppedPending, [sender]);
  assert.deepEqual(removedSessions, ['session-1']);
  assert.equal(sessions.has('session-1'), false);

  assert.deepEqual(messages, [
    {
      device: sender,
      event: 'state',
      data: { pending: false },
    },
    {
      device: sender,
      event: 'done',
      data: {},
    },
  ]);

  await new Promise((resolve) => server.close(resolve));
});

test('webrtc complete: il mittente non può confermare il trasferimento', async () => {
  const {
    server,
    sessions,
    devices,
    removedSessions,
  } = createTestServer();

  addSession(sessions);

  const sender = {
    id: 'device-a',
    pending: {
      file: '/tmp/test-file',
      name: 'test.txt',
    },
  };

  const receiver = {
    id: 'device-b',
    pending: null,
  };

  devices.set(sender.id, sender);
  devices.set(receiver.id, receiver);

  await new Promise((resolve) => server.listen(0, resolve));

  const result = await request(server, 'POST', '/webrtc/complete', {
    sessionId: 'session-1',
    deviceId: 'device-a',
  });

  assert.equal(result.status, 403);
  assert.deepEqual(result.body, {
    error: 'Sender cannot complete transfer',
  });

  assert.notEqual(sender.pending, null);
  assert.deepEqual(removedSessions, []);

  await new Promise((resolve) => server.close(resolve));
});

test('webrtc complete: restituisce 409 se il mittente non ha più un file pendente', async () => {
  const {
    server,
    sessions,
    devices,
    removedSessions,
  } = createTestServer();

  addSession(sessions);

  const sender = {
    id: 'device-a',
    pending: null,
  };

  const receiver = {
    id: 'device-b',
    pending: null,
  };

  devices.set(sender.id, sender);
  devices.set(receiver.id, receiver);

  await new Promise((resolve) => server.listen(0, resolve));

  const result = await request(server, 'POST', '/webrtc/complete', {
    sessionId: 'session-1',
    deviceId: 'device-b',
  });

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    error: 'No pending file',
  });

  assert.deepEqual(removedSessions, []);
  assert.equal(sessions.has('session-1'), true);

  await new Promise((resolve) => server.close(resolve));
});

test('webrtc complete: un device estraneo non può confermare', async () => {
  const {
    server,
    sessions,
    devices,
  } = createTestServer();

  addSession(sessions);

  devices.set('device-a', {
    id: 'device-a',
    pending: {
      file: '/tmp/test-file',
      name: 'test.txt',
    },
  });

  devices.set('device-b', {
    id: 'device-b',
    pending: null,
  });

  await new Promise((resolve) => server.listen(0, resolve));

  const result = await request(server, 'POST', '/webrtc/complete', {
    sessionId: 'session-1',
    deviceId: 'device-c',
  });

  assert.equal(result.status, 403);
  assert.deepEqual(result.body, {
    error: 'Not a session peer',
  });

  await new Promise((resolve) => server.close(resolve));
});

test('webrtc complete: restituisce 404 per una sessione inesistente', async () => {
  const { server } = createTestServer();

  await new Promise((resolve) => server.listen(0, resolve));

  const result = await request(server, 'POST', '/webrtc/complete', {
    sessionId: 'does-not-exist',
    deviceId: 'device-b',
  });

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, {
    error: 'Session not found',
  });

  await new Promise((resolve) => server.close(resolve));
});
