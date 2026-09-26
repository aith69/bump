const express = require('express');

function createWebrtcRouter({ webrtc, devices, send, dropPending, stateOf }) {
  const router = express.Router();

  function createHandler(type) {
    return (req, res) => {
      const { sessionId, deviceId, payload } = req.body || {};

      if (!sessionId || !deviceId || payload === undefined) {
        return res.status(400).json({ error: 'Invalid request' });
      }

      const session = webrtc.get(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (!webrtc.isPeer(sessionId, deviceId)) {
        return res.status(403).json({ error: 'Not a session peer' });
      }

      const peerId =
        session.a === deviceId
          ? session.b
          : session.a;

      const peer = devices.get(peerId);

      if (!peer) {
        return res.status(404).json({ error: 'Peer not found' });
      }

      send(peer, `webrtc-${type}`, {
        sessionId,
        payload,
      });

      return res.json({ ok: true });
    };
  }

  router.post('/webrtc/offer', createHandler('offer'));
  router.post('/webrtc/answer', createHandler('answer'));
  router.post('/webrtc/ice', createHandler('ice'));

  router.post('/webrtc/complete', (req, res) => {
    const { sessionId, deviceId } = req.body || {};

    if (!sessionId || !deviceId) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const session = webrtc.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!webrtc.isPeer(sessionId, deviceId)) {
      return res.status(403).json({ error: 'Not a session peer' });
    }

    // session.a = sender, session.b = receiver.
    // Solo il destinatario può confermare il completamento P2P.
    if (deviceId !== session.b) {
      return res.status(403).json({ error: 'Sender cannot complete transfer' });
    }

    const owner = devices.get(session.a);

    if (!owner) {
      return res.status(404).json({ error: 'Sender not found' });
    }

    if (!owner.pending) {
      return res.status(409).json({ error: 'No pending file' });
    }

    dropPending(owner);
    send(owner, 'state', stateOf(owner));
    send(owner, 'done', {});

    webrtc.remove(session.id);

    return res.json({ ok: true });
  });

  return router;
}

module.exports = createWebrtcRouter;
