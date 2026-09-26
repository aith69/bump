const crypto = require('crypto');

function createPairing({
  state,
  devices,
  send,
  webrtc,
  pairWindow,
  settle,
  lookback,
  tokenTtl,
}) {
  function evaluate() {
    const now = Date.now();

    state.bumps = state.bumps.filter((b) => now - b.t <= lookback);

    // Servono esattamente due bump
    if (state.bumps.length !== 2) return;

    const [aBump, bBump] = state.bumps;

    // Devono provenire da due dispositivi diversi
    if (aBump.id === bBump.id) return;

    // Devono essere abbastanza ravvicinati
    if (Math.abs(aBump.t - bBump.t) > pairWindow) return;

    // Sono ammesse:
    //   key + motion   -> PC + telefono
    //   motion + motion -> telefono + telefono
    // key + key non è valido
    const validPair =
      (aBump.type === 'key' && bBump.type === 'motion') ||
      (aBump.type === 'motion' && bBump.type === 'key') ||
      (aBump.type === 'motion' && bBump.type === 'motion');

    if (!validPair) return;

    const a = devices.get(aBump.id);
    const b = devices.get(bBump.id);

    if (!a || !b) return;

    // Esattamente uno dei due deve avere un file
    if (!!a.pending === !!b.pending) return;

    const [sender, receiver] = a.pending ? [a, b] : [b, a];

    // Il destinatario deve essere ancora collegato
    if (!receiver.res) return;

    const token = crypto.randomBytes(16).toString('hex');

    sender.pending.token = token;
    sender.pending.tokenExp = now + tokenTtl;

    const session = webrtc.create(sender.id, receiver.id);

    state.bumps = [];

    send(sender, 'webrtc-session', {
      sessionId: session.id,
    });

    send(receiver, 'webrtc-session', {
      sessionId: session.id,
    });

    send(receiver, 'download', {
      url: `/download?t=${token}`,
    });
  }

  function record(id, type) {
    const now = Date.now();

    state.bumps = state.bumps.filter(
      (b) => now - b.t <= lookback && b.id !== id
    );

    state.bumps.push({ id, type, t: now });

    setTimeout(evaluate, settle);
  }

  return {
    record,
  };
}

module.exports = createPairing;
