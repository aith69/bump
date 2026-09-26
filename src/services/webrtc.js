const crypto = require('crypto');

function createWebrtc({ sessions, ttl }) {
  function create(a, b) {
    const id = crypto.randomBytes(16).toString('hex');

    const session = {
      id,
      a,
      b,
      expiresAt: Date.now() + ttl,
    };

    sessions.set(id, session);

    return session;
  }

  function get(id) {
    const session = sessions.get(String(id));

    if (!session) {
      return null;
    }

    if (Date.now() >= session.expiresAt) {
      sessions.delete(session.id);
      return null;
    }

    return session;
  }

  function isPeer(id, deviceId) {
    const session = get(id);

    if (!session) {
      return false;
    }

    return session.a === deviceId || session.b === deviceId;
  }

  function remove(id) {
    return sessions.delete(String(id));
  }

  return {
    create,
    get,
    isPeer,
    remove,
  };
}

module.exports = createWebrtc;
