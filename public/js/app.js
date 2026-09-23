const $ = (s) => document.querySelector(s);

new QRCode($('#qrcode'), {
  text: location.host,
  width: 80,
  height: 80,
  colorDark: '#1c2330',
  colorLight: getComputedStyle(document.documentElement)
    .getPropertyValue('--bg')
    .trim(),
  correctLevel: QRCode.CorrectLevel.L
});

const MAX = 50 * 1024 * 1024;

// identificativo casuale del dispositivo (una scheda del browser = un dispositivo)
function makeId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
let ID;
try { ID = sessionStorage.id || (sessionStorage.id = makeId()); } catch { ID = makeId(); }

const isTouch = matchMedia('(pointer: coarse)').matches;
$('#hint').textContent = isTouch
  ? 'Carica un file, poi fai scontrare questo telefono con l\'altro dispositivo.'
  : 'Premi la barra spaziatrice mentre l\'altro dispositivo fa bump.';
document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;

// ---------- stato e schermata ----------
let pending = null, busy = false, flash = '', flashTimer = 0, sharing = false;

function render() {
  const showMsg = busy || !!flash;
  $('#msg').hidden = !showMsg;
  $('#msg').textContent = busy ? 'Caricamento…' : flash;
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

// ---------- server -> dispositivo ----------
const es = new EventSource(`/events?id=${ID}`);
es.addEventListener('state', (e) => {
  pending = JSON.parse(e.data).pending;
  if (!pending) { clearInterval(shareTimer); sharing = false; }
  render();
});
es.addEventListener('done', () => {
  showFlash('Inviato ✓');
  setTimeout(() => location.reload(), 800);
});
es.addEventListener('download', (e) => {
  const a = document.createElement('a');
  a.href = JSON.parse(e.data).url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  showFlash('Ricevuto ✓');
  setTimeout(() => location.reload(), 800);
});

// ---------- upload / rimozione ----------
async function upload(file) {
  if (!file || busy || pending) return;
  if (file.size > MAX) return showFlash('Massimo 50 MB');
  busy = true; render();
  let msg = '';
  try {
    const r = await fetch(`/upload?id=${ID}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    if (r.status === 413) msg = 'Massimo 50 MB';
    else if (r.status === 429) msg = 'Troppi tentativi, aspetta';
    else if (r.status === 503) msg = 'Server occupato, riprova';
    else if (r.status === 409) msg = 'C\'è già un file in attesa';
    else if (!r.ok) msg = 'Non riuscito';
  } catch { msg = 'Non riuscito'; }
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
    $('#shareTimer').textContent = `Valido per ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
  } catch { return showFlash('Non riuscito'); }
  if (!r.ok) return showFlash(r.status === 429 ? 'Troppi tentativi, aspetta' : 'Non riuscito');
  const { url } = await r.json();
  $('#shareqr').innerHTML = '';
  new QRCode($('#shareqr'), {
    text: location.origin + url,
    width: 160,
    height: 160,
    colorDark: '#1c2330',
    colorLight: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    correctLevel: QRCode.CorrectLevel.L
  });
  sharing = true;
  startCountdown(1 * 60 * 1000);   // 1 minuto: deve combaciare con SHARE_TTL in server.js
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

