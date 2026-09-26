const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

const createWebrtcRouter = require('../src/routes/webrtc');

function createTestServer() {
  const sessions = new Map();
  const devices = new Map();
  const messages = [];

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
    },
    devices,
    send(device, event, data) {
      messages.push({ device, event, data });
    },
  });

  const app = express();
  app.use(express.json());
  app.use(router);

  const server = http.createServer(app);

  return { server, sessions, devices, messages };
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
