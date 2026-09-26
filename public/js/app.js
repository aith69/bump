const $ = (s) => document.querySelector(s);

new QRCode($('#qrcode'), {
  text: location.host,
  width: 80,
  height: 80,
  colorDark: '#f5f5f5',
  colorLight: getComputedStyle(document.documentElement)
    .getPropertyValue('--bg')
    .trim(),
  correctLevel: QRCode.CorrectLevel.L
});

const MAX = window.appConfig.maxBytes;

// identificativo casuale del dispositivo (una scheda del browser = un dispositivo)
function makeId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
let ID;
try { ID = sessionStorage.id || (sessionStorage.id = makeId()); } catch { ID = makeId(); }

const isTouch = matchMedia('(pointer: coarse)').matches;
$('#hint').textContent = t(isTouch ? 'touchHint' : 'desktopHint');
document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;

// ---------- stato e schermata ----------
let pending = null, busy = false, flash = '', flashTimer = 0, sharing = false;

function render() {
  const showMsg = busy || !!flash;
  $('#msg').hidden = !showMsg;
  $('#msg').textContent = busy ? t('uploading') : flash;
  $('#file').hidden = showMsg || !pending || sharing;
  $('#shareBox').hidden = showMsg || !pending || !sharing;
  $('#qr').hidden = sharing;
  $('#hint').hidden = sharing;
  $('#pick').hidden = showMsg || !!pending;
  if (pending) $('#name').textContent = pending.name;
}

function showFlash(text) {
  flash = text;
  render();
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash = ''; render(); }, 3000);
}

// ---------- WebRTC ----------
let webrtcSessionId = null;
let peerConnection = null;
let dataChannel = null;
let pendingIceCandidates = [];

const WEBRTC_CHUNK_SIZE = 64 * 1024;
const WEBRTC_BUFFER_HIGH = 1024 * 1024;
const WEBRTC_BUFFER_LOW = 256 * 1024;

let pendingFile = null;
let receivingFile = null;
let p2pTransferActive = false;
let p2pTransferComplete = false;
let p2pChannelOpen = false;

let pendingDownloadUrl = null;

const P2P_FALLBACK_TIMEOUT = 5000;

const webrtcFallback = createWebrtcFallback({
  timeout: P2P_FALLBACK_TIMEOUT,
  hasUrl: () => !!pendingDownloadUrl,
  isChannelOpen: () => p2pChannelOpen,
  isTransferActive: () => p2pTransferActive,
  isTransferComplete: () => p2pTransferComplete,
  fallback: () => downloadHttpFallback(),
});

function resetWebrtc() {
  webrtcFallback.cancel();
  pendingDownloadUrl = null;

  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  webrtcSessionId = null;
  pendingIceCandidates = [];
  p2pChannelOpen = false;
  p2pTransferActive = false;
  p2pTransferComplete = false;
  receivingFile = null;
}

function downloadHttpFallback() {
  if (!pendingDownloadUrl) {
    console.warn('[WebRTC] HTTP fallback requested without URL');
    return;
  }

  const url = pendingDownloadUrl;

  pendingDownloadUrl = null;

  webrtcFallback.cancel();

  console.log('[WebRTC] using HTTP download fallback');

  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();

  showFlash(t('received'));
  setTimeout(() => location.reload(), 800);
}

function armHttpFallback() {
  webrtcFallback.arm();
}

function handleP2PChannelOpen() {
  p2pChannelOpen = true;

  webrtcFallback.cancel();
}

async function confirmP2PCompletion() {
  const response = await fetch('/webrtc/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId: webrtcSessionId,
      deviceId: ID,
    }),
  });

  if (!response.ok) {
    throw new Error(`WebRTC completion failed: ${response.status}`);
  }
}

async function sendWebrtcSignal(type, payload) {
  const response = await fetch(`/webrtc/${type}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId: webrtcSessionId,
      deviceId: ID,
      payload,
    }),
  });

  if (!response.ok) {
    throw new Error(`WebRTC ${type} failed: ${response.status}`);
  }
}

async function createOffer() {
  console.log('[WebRTC] creating offer');

  const offer = await peerConnection.createOffer();

  await peerConnection.setLocalDescription(offer);

  console.log('[WebRTC] sending offer');

  await sendWebrtcSignal('offer', peerConnection.localDescription);
}

async function handleOffer(offer) {
  console.log('[WebRTC] received offer');

  await peerConnection.setRemoteDescription(offer);
  await flushIceCandidates();

  const answer = await peerConnection.createAnswer();

  await peerConnection.setLocalDescription(answer);

  console.log('[WebRTC] sending answer');

  await sendWebrtcSignal('answer', peerConnection.localDescription);
}

async function handleAnswer(answer) {
  console.log('[WebRTC] received answer');

  await peerConnection.setRemoteDescription(answer);
  await flushIceCandidates();

  console.log('[WebRTC] remote description set');
}

async function sendIceCandidate(candidate) {
  await sendWebrtcSignal('ice', candidate);
}

async function handleIceCandidate(candidate) {
  if (!peerConnection) return;

  if (!peerConnection.remoteDescription) {
    pendingIceCandidates.push(candidate);
    return;
  }

  await peerConnection.addIceCandidate(candidate);
}

async function flushIceCandidates() {
  while (pendingIceCandidates.length > 0) {
    const candidate = pendingIceCandidates.shift();
    await peerConnection.addIceCandidate(candidate);
  }
}


function sendWebrtcMessage(message) {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    throw new Error('WebRTC data channel is not open');
  }

  dataChannel.send(JSON.stringify(message));
}

function waitForWebrtcBuffer() {
  if (!dataChannel) {
    return Promise.reject(new Error('WebRTC data channel unavailable'));
  }

  if (dataChannel.bufferedAmount <= WEBRTC_BUFFER_HIGH) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const channel = dataChannel;

    const onLow = () => {
      cleanup();
      resolve();
    };

    const onClose = () => {
      cleanup();
      reject(new Error('WebRTC data channel closed'));
    };

    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      channel.removeEventListener('close', onClose);
    };

    channel.bufferedAmountLowThreshold = WEBRTC_BUFFER_LOW;
    channel.addEventListener('bufferedamountlow', onLow);
    channel.addEventListener('close', onClose);
  });
}

async function sendFileP2P(file) {
  if (!file) {
    console.warn('[WebRTC] no pending file available');
    return;
  }

  if (!dataChannel || dataChannel.readyState !== 'open') {
    console.warn('[WebRTC] data channel not ready for file transfer');
    return;
  }

  p2pTransferActive = true;
  p2pTransferComplete = false;

  console.log('[WebRTC] starting P2P file transfer');
  console.log('[WebRTC] file:', file.name);
  console.log('[WebRTC] size:', file.size);
  console.log('[WebRTC] type:', file.type || 'application/octet-stream');

  sendWebrtcMessage({
    type: 'file-start',
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
  });

  let offset = 0;

  while (offset < file.size) {
    await waitForWebrtcBuffer();

    if (!dataChannel || dataChannel.readyState !== 'open') {
      throw new Error('WebRTC data channel closed during transfer');
    }

    const chunk = await file
      .slice(offset, offset + WEBRTC_CHUNK_SIZE)
      .arrayBuffer();

    dataChannel.send(chunk);

    offset += chunk.byteLength;

    console.log(`[WebRTC] sent ${offset}/${file.size} bytes`);
  }

  sendWebrtcMessage({
    type: 'file-end',
  });

  console.log('[WebRTC] file data sent, waiting for completion');
}

function handleP2PMessage(event) {
  // Messaggio binario = chunk del file
  if (typeof event.data !== 'string') {
    if (!receivingFile) {
      console.warn('[WebRTC] binary data received without file-start');
      return;
    }

    if (event.data instanceof ArrayBuffer) {
      receivingFile.chunks.push(event.data);
      receivingFile.received += event.data.byteLength;
    } else if (event.data instanceof Blob) {
      receivingFile.chunks.push(event.data);
      receivingFile.received += event.data.size;
    } else {
      console.warn('[WebRTC] unsupported binary data:', event.data);
      return;
    }

    console.log(
      `[WebRTC] received ${receivingFile.received}/${receivingFile.size} bytes`
    );

    return;
  }

  let message;

  try {
    message = JSON.parse(event.data);
  } catch {
    console.warn('[WebRTC] invalid JSON message:', event.data);
    return;
  }

  console.log('[WebRTC] control message:', message);

  // Il receiver comunica che il canale è pronto.
  if (message.type === 'ready') {
    if (pendingFile) {
      sendFileP2P(pendingFile).catch((error) => {
        console.error('[WebRTC] file transfer error:', error);
        p2pTransferActive = false;
        downloadHttpFallback();
      });
    } else {
      console.warn('[WebRTC] receiver ready but no pending file');
    }

    return;
  }

  // Inizio trasferimento.
  if (message.type === 'file-start') {
    receivingFile = {
      name: message.name || 'file',
      size: Number(message.size) || 0,
      mime: message.mime || 'application/octet-stream',
      chunks: [],
      received: 0,
    };

    p2pTransferActive = true;
    p2pTransferComplete = false;

    console.log(
      '[WebRTC] receiving file:',
      receivingFile.name,
      receivingFile.size,
      receivingFile.mime
    );

    return;
  }

  // Fine trasferimento.
  if (message.type === 'file-end') {
    if (!receivingFile) {
      console.warn('[WebRTC] file-end without active transfer');
      return;
    }

    if (receivingFile.received !== receivingFile.size) {
      console.error(
        `[WebRTC] size mismatch: received ${receivingFile.received}, expected ${receivingFile.size}`
      );
      return;
    }

    const blob = new Blob(receivingFile.chunks, {
      type: receivingFile.mime,
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = receivingFile.name;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    console.log('[WebRTC] P2P file received successfully');

    confirmP2PCompletion()
      .then(() => {
        console.log('[WebRTC] server confirmed P2P completion');
      })
      .catch((error) => {
        console.error('[WebRTC] completion confirmation failed:', error);
      });

    receivingFile = null;
    p2pTransferActive = false;
    p2pTransferComplete = true;

    return;
  }

  // Conferma finale del receiver.
  if (message.type === 'file-complete') {
    console.log('[WebRTC] receiver confirmed file completion');

    p2pTransferActive = false;
    p2pTransferComplete = true;
  }
}

function startWebrtc(sessionId, role) {
  resetWebrtc();

  webrtcSessionId = sessionId;
  peerConnection = new RTCPeerConnection();

  peerConnection.addEventListener('icecandidate', (event) => {
    if (!event.candidate) return;

    console.log('[WebRTC] sending ICE candidate');

    sendIceCandidate(event.candidate).catch((error) => {
      console.error('[WebRTC] ICE send error:', error);
    });
  });

  peerConnection.addEventListener('connectionstatechange', () => {
    console.log('[WebRTC] connection state:', peerConnection.connectionState);
  });

  peerConnection.addEventListener('iceconnectionstatechange', () => {
    console.log('[WebRTC] ICE state:', peerConnection.iceConnectionState);
  });

  peerConnection.addEventListener('signalingstatechange', () => {
    console.log('[WebRTC] signaling state:', peerConnection.signalingState);
  });

  peerConnection.addEventListener('datachannel', (event) => {
    dataChannel = event.channel;
    dataChannel.binaryType = 'arraybuffer';

    console.log('[WebRTC] data channel received:', dataChannel.label);

    dataChannel.addEventListener('open', () => {
      console.log('[WebRTC] data channel open');

      handleP2PChannelOpen();

      sendWebrtcMessage({
        type: 'ready',
      });

      console.log('[WebRTC] ready message sent');
    });

    dataChannel.addEventListener('message', (event) => {
      handleP2PMessage(event);
    });
  });

  console.log('[WebRTC] session:', webrtcSessionId);
  console.log('[WebRTC] role:', role);

  if (role === 'offerer') {
    dataChannel = peerConnection.createDataChannel('bump');

    dataChannel.addEventListener('open', () => {
      console.log('[WebRTC] data channel open');
      handleP2PChannelOpen();
    });

    dataChannel.addEventListener('message', (event) => {
      handleP2PMessage(event);
    });

    dataChannel.addEventListener('close', () => {
      console.log('[WebRTC] data channel closed');
      p2pChannelOpen = false;
    });

    createOffer().catch((error) => {
      console.error('[WebRTC] offer error:', error);
    });
  }
}

// ---------- server -> dispositivo ----------
const es = new EventSource(`/events?id=${ID}`);

es.addEventListener('webrtc-session', (e) => {
  const { sessionId, role } = JSON.parse(e.data);

  if (!sessionId || !role) return;

  startWebrtc(sessionId, role);
});

es.addEventListener('webrtc-offer', (e) => {
  const { sessionId, payload } = JSON.parse(e.data);

  if (sessionId !== webrtcSessionId || !payload) return;

  handleOffer(payload).catch((error) => {
    console.error('[WebRTC] offer handling error:', error);
  });
});

es.addEventListener('webrtc-answer', (e) => {
  const { sessionId, payload } = JSON.parse(e.data);

  if (sessionId !== webrtcSessionId || !payload) return;

  handleAnswer(payload).catch((error) => {
    console.error('[WebRTC] answer handling error:', error);
  });
});

es.addEventListener('webrtc-ice', (e) => {
  const { sessionId, payload } = JSON.parse(e.data);

  if (sessionId !== webrtcSessionId || !payload) return;

  handleIceCandidate(payload).catch((error) => {
    console.error('[WebRTC] ICE handling error:', error);
  });
});
es.addEventListener('state', (e) => {
  pending = JSON.parse(e.data).pending;
  if (!pending) { clearInterval(shareTimer); sharing = false; }
  render();
});
es.addEventListener('done', () => {
  showFlash(t('sent'));
  setTimeout(() => location.reload(), 800);
});
es.addEventListener('download', (e) => {
  const data = JSON.parse(e.data);

  pendingDownloadUrl = data.url;

  if (p2pChannelOpen) {
    console.log('[WebRTC] P2P channel already available, skipping HTTP fallback timer');
    return;
  }

  armHttpFallback();
});

// ---------- upload / rimozione ----------
async function upload(file) {
  if (!file || busy || pending) return;
  if (file.size > MAX) return showFlash(t('maxFileSize'));
  busy = true; render();
  let msg = '';
  try {
    const r = await fetch(`/upload?id=${ID}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    if (r.status === 413) msg = t('maxFileSize');
    else if (r.status === 429) msg = t('tooManyAttempts');
    else if (r.status === 503) msg = t('serverBusy');
    else if (r.status === 409) msg = t('fileAlreadyWaiting');
    else if (!r.ok) msg = t('failed');
  } catch { msg = t('failed'); }

  if (!msg) {
    pendingFile = file;
  }

  busy = false;
  msg ? showFlash(msg) : render();
}

let shareTimer = null;

function startCountdown(ms) {
  clearInterval(shareTimer);
  const expiry = Date.now() + ms;
  const tick = () => {
    const left = expiry - Date.now();
    if (left <= 0) {
      clearInterval(shareTimer);
      sharing = false;
      render();
      return;
    }
    const s = Math.ceil(left / 1000);
    $('#shareTimer').textContent = t('shareValidFor', {
      time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
    });
  };
  tick();
  shareTimer = setInterval(tick, 1000);
}

$('#pick').onclick = () => $('#input').click();
$('#input').onchange = (e) => { upload(e.target.files[0]); e.target.value = ''; };
$('#remove').onclick = () => fetch(`/file?id=${ID}`, { method: 'DELETE' });
$('#share').onclick = async () => {
  let r;
  try {
    r = await fetch(`/share?id=${ID}`, { method: 'POST' });
  } catch { return showFlash(t('failed')); }
  if (!r.ok) return showFlash(
    r.status === 429 ? t('tooManyAttempts') : t('failed')
  );
  const { url } = await r.json();
  $('#shareqr').innerHTML = '';
  new QRCode($('#shareqr'), {
    text: location.origin + url,
    width: 160,
    height: 160,
    colorDark: '#f5f5f5',
    colorLight: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    correctLevel: QRCode.CorrectLevel.L
  });
  sharing = true;
  startCountdown(window.appConfig.shareTtl);
  render();
};
$('#shareclose').onclick = () => { clearInterval(shareTimer); sharing = false; render(); };
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); upload(e.dataTransfer.files[0]); });

// ---------- bump ----------
let lastBump = 0;
function bump(type) {
  const now = Date.now();
  if (now - lastBump < 1000) return;   // evita rimbalzi
  lastBump = now;
  fetch(`/bump?id=${ID}&type=${type}`, { method: 'POST' });
  if (navigator.vibrate) navigator.vibrate(60);
  const s = $('#stage');
  s.classList.remove('hit'); void s.offsetWidth; s.classList.add('hit');
}

// barra spaziatrice
addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  if (!e.repeat) bump('key');
});
addEventListener('keyup', (e) => { if (e.code === 'Space') e.preventDefault(); });

// urto rilevato dall'accelerometro (telefono)
const THRESHOLD = 8;   // m/s² oltre la gravità: alzalo se scatta troppo facilmente
const needsPermission = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
let motionOn = false;

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  if (Math.abs(Math.hypot(a.x || 0, a.y || 0, a.z || 0) - 9.8) > THRESHOLD) bump('motion');
}
function startMotion() {
  if (motionOn) return;
  motionOn = true;
  addEventListener('devicemotion', onMotion);
  removeEventListener('click', askMotion);
}
function askMotion() {            // su iPhone va chiamata da un tocco dell'utente
  if (motionOn) return;
  DeviceMotionEvent.requestPermission().then((r) => { if (r === 'granted') startMotion(); }).catch(() => {});
}
if (isTouch) needsPermission ? addEventListener('click', askMotion) : startMotion();

