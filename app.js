// App web de Despachos y Cartera de TechZone.
// Habla directamente con Firebase (Firestore + Storage) desde el navegador;
// no hay servidor propio. La app de escritorio sincroniza estas mismas
// colecciones (ver electron/firebaseSync.js), asi que los cambios hechos aqui
// se reflejan alla y viceversa.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, onSnapshot, query, where, getDocs,
  runTransaction, orderBy, limit, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';

const firebaseConfig = window.TECHZONE_FIREBASE_CONFIG || {};
const isConfigured = !String(firebaseConfig.apiKey || '').startsWith('REEMPLAZA');

if (!isConfigured) {
  document.getElementById('not-configured-notice').style.display = 'block';
  document.getElementById('btn-login-submit').disabled = true;
}

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);

// Mantiene la sesion guardada en el dispositivo, para no tener que iniciar
// sesion de nuevo cada vez que se abre la pagina.
setPersistence(auth, browserLocalPersistence).catch(() => {});

let despachosCache = [];
let creditosCache = [];
let currentTab = 'despachos';
let unsubDespachos = null;
let unsubCreditos = null;
let qrScanner = null;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function money(n) {
  return '$ ' + Math.round(n || 0).toLocaleString('es-CO');
}
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = `toast ${type || ''}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function playSuccessSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const playTone = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.3, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.05);
    };
    playTone(880, 0, 0.12);
    playTone(1320, 0.13, 0.2);
  } catch (e) {
    // audio no disponible en este dispositivo, no es critico
  }
}
function showSuccessOverlay(titulo, subtitulo) {
  playSuccessSound();
  const el = document.createElement('div');
  el.className = 'success-overlay';
  el.innerHTML = `
    <div class="success-overlay-box">
      <div class="success-checkmark">✅</div>
      <div class="success-title">${escapeHtml(titulo)}</div>
      ${subtitulo ? `<div class="success-subtitle">${escapeHtml(subtitulo)}</div>` : ''}
    </div>
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}
function showModal(html, onMount) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" id="modal-overlay"><div class="modal">${html}</div></div>`;
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  if (onMount) onMount();
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  stopScanner();
}
function esMoroso(credito) {
  return credito.estado === 'activo' && credito.fechaProximoPago && new Date(credito.fechaProximoPago) < new Date();
}

// ---------------------------------------------------------------------------
// Autenticacion
// ---------------------------------------------------------------------------
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    const codigosCredencial = ['auth/wrong-password', 'auth/user-not-found', 'auth/invalid-credential', 'auth/invalid-email'];
    if (codigosCredencial.includes(err.code)) {
      errorEl.textContent = 'Correo o contrasena incorrectos.';
    } else {
      errorEl.textContent = `No se pudo conectar con Firebase (${err.code || err.message}). Revisa la configuracion en SETUP-WEB.md.`;
    }
  }
});

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

// ---------------------------------------------------------------------------
// Desbloqueo con huella/rostro (WebAuthn) - candado local extra para el
// celular. La sesion de Firebase ya queda guardada en el dispositivo
// (browserLocalPersistence de arriba), asi que sin esto cualquiera que tome
// el celular desbloqueado podria abrir esta pagina y ver Despachos/Cartera
// directo. Esta pagina no tiene servidor propio para verificar firmas
// WebAuthn de forma criptografica; se usa solo como candado del dispositivo:
// si el sensor de huella/rostro del telefono aprueba (navigator.credentials
// resuelve en vez de fallar), se muestra el contenido.
const BIO_CRED_KEY = 'tz_bio_cred_id';
const BIO_EMAIL_KEY = 'tz_bio_email';
const BIO_DECLINED_KEY = 'tz_bio_declined';
let bioLocked = false;

function bufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
async function biometriaDisponible() {
  if (!window.PublicKeyCredential || !navigator.credentials) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (err) {
    return false;
  }
}
function credencialRegistrada(email) {
  return !!localStorage.getItem(BIO_CRED_KEY) && localStorage.getItem(BIO_EMAIL_KEY) === email;
}
async function registrarBiometria(email) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'TechZone' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email, displayName: email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000
    }
  });
  localStorage.setItem(BIO_CRED_KEY, bufferToBase64(cred.rawId));
  localStorage.setItem(BIO_EMAIL_KEY, email);
}
async function verificarBiometria() {
  const credId = localStorage.getItem(BIO_CRED_KEY);
  if (!credId) throw new Error('No hay huella/rostro registrado en este dispositivo');
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: base64ToBuffer(credId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000
    }
  });
}
function olvidarBiometria() {
  localStorage.removeItem(BIO_CRED_KEY);
  localStorage.removeItem(BIO_EMAIL_KEY);
  document.getElementById('btn-bio-olvidar').hidden = true;
}
function actualizarBotonOlvidar(email) {
  document.getElementById('btn-bio-olvidar').hidden = !credencialRegistrada(email);
}

document.getElementById('btn-bio-olvidar').addEventListener('click', () => {
  if (!confirm('¿Ya no pedir huella/rostro en este dispositivo? La proxima vez entraras con correo y contrasena.')) return;
  olvidarBiometria();
  toast('Desbloqueo con huella/rostro desactivado en este dispositivo', 'success');
});

function mostrarPantallaBloqueo() {
  bioLocked = true;
  if (unsubDespachos) unsubDespachos();
  if (unsubCreditos) unsubCreditos();
  document.getElementById('login-view').hidden = false;
  document.getElementById('app-view').hidden = true;
  document.getElementById('login-box-password').hidden = true;
  document.getElementById('login-box-biometric').hidden = false;
}
function mostrarApp() {
  bioLocked = false;
  document.getElementById('login-view').hidden = true;
  document.getElementById('app-view').hidden = false;
  startListeners();
  renderTab();
  if (auth.currentUser) actualizarBotonOlvidar(auth.currentUser.email);
}

document.getElementById('btn-bio-unlock').addEventListener('click', async () => {
  const errorEl = document.getElementById('bio-lock-error');
  errorEl.textContent = '';
  try {
    await verificarBiometria();
    mostrarApp();
  } catch (err) {
    errorEl.textContent = 'No se pudo verificar. Intenta de nuevo.';
  }
});
document.getElementById('link-bio-logout').addEventListener('click', (e) => {
  e.preventDefault();
  signOut(auth);
});

// Si el registro biometrico ya esta activo para este usuario, cada vez que
// se vuelve a esta pestana (por ejemplo, al cambiar de app en el celular y
// regresar) se vuelve a pedir la huella/rostro, en vez de confiar solo en
// que la pestana siga abierta.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || bioLocked) return;
  const user = auth.currentUser;
  if (user && credencialRegistrada(user.email)) mostrarPantallaBloqueo();
});

async function ofrecerActivarBiometria(email) {
  if (credencialRegistrada(email)) return;
  if (localStorage.getItem(BIO_DECLINED_KEY) === email) return;
  if (!(await biometriaDisponible())) return;

  const el = document.createElement('div');
  el.className = 'bio-banner';
  el.innerHTML = `
    <span>🔒 ¿Activar desbloqueo con huella/rostro en este dispositivo? Asi nadie mas puede abrir esta pagina aunque tenga el celular desbloqueado.</span>
    <div class="bio-banner-actions">
      <button class="btn btn-sm" id="btn-bio-declinar">Ahora no</button>
      <button class="btn btn-sm btn-primary" id="btn-bio-activar">Activar</button>
    </div>
  `;
  document.body.appendChild(el);
  document.getElementById('btn-bio-declinar').addEventListener('click', () => {
    localStorage.setItem(BIO_DECLINED_KEY, email);
    el.remove();
  });
  document.getElementById('btn-bio-activar').addEventListener('click', async () => {
    try {
      await registrarBiometria(email);
      actualizarBotonOlvidar(email);
      toast('Desbloqueo con huella/rostro activado', 'success');
    } catch (err) {
      toast('No se pudo activar: ' + (err.message || err.code || 'intenta de nuevo'), 'error');
    }
    el.remove();
  });
}

onAuthStateChanged(auth, (user) => {
  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');
  if (user) {
    if (credencialRegistrada(user.email)) {
      mostrarPantallaBloqueo();
    } else {
      loginView.hidden = true;
      appView.hidden = false;
      startListeners();
      renderTab();
      ofrecerActivarBiometria(user.email);
    }
  } else {
    bioLocked = false;
    loginView.hidden = false;
    appView.hidden = true;
    document.getElementById('login-box-password').hidden = false;
    document.getElementById('login-box-biometric').hidden = true;
    if (unsubDespachos) unsubDespachos();
    if (unsubCreditos) unsubCreditos();
  }
});

// ---------------------------------------------------------------------------
// Navegacion de pestanas
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    renderTab();
  });
});

function renderTab() {
  if (currentTab === 'despachos') renderDespachos();
  else if (currentTab === 'cartera') renderCartera();
  else if (currentTab === 'asistencia') renderAsistencia();
}

// ---------------------------------------------------------------------------
// Asistencia: marcar entrada al trabajo con un solo boton, comparando la
// hora contra el horario que el Dueño le configuro a esta persona en
// Configuracion > Roles del equipo en Firebase (app de escritorio). El
// registro se guarda en Firestore (coleccion "asistencia") para que el
// Dueño lo vea en Monitoreo.
async function renderAsistencia() {
  const content = document.getElementById('content');
  const user = auth.currentUser;
  content.innerHTML = `<div class="empty-state">Cargando...</div>`;

  let perfil = {};
  try {
    const snap = await getDoc(doc(db, 'usuarios', user.uid));
    if (snap.exists()) perfil = snap.data();
  } catch (err) {
    // Sin permiso o sin perfil todavia: se sigue mostrando la pantalla, solo
    // sin hora de entrada configurada.
  }

  let ultimas = [];
  try {
    const q = query(collection(db, 'asistencia'), where('uid', '==', user.uid), orderBy('fecha', 'desc'), limit(10));
    const snap = await getDocs(q);
    ultimas = snap.docs.map((d) => d.data());
  } catch (err) {
    // idem: se ignora, la pantalla sigue funcionando sin el historial.
  }

  content.innerHTML = `
    <div class="card">
      <div class="card-title">🕒 Marcar entrada</div>
      ${perfil.horaEntrada
        ? `<div class="card-row"><span>Tu horario</span><strong>${escapeHtml(perfil.horaEntrada)}</strong></div>`
        : `<p class="text-dim" style="font-size:12px">Tu hora de entrada todavia no esta configurada (lo hace el administrador desde la app de escritorio, en Configuracion).</p>`
      }
      <button class="btn btn-primary btn-block" id="btn-marcar-entrada" style="margin-top:10px">Marcar entrada</button>
    </div>
    <div class="section-title">Tus ultimas marcaciones</div>
    ${ultimas.length ? ultimas.map((a) => `
      <div class="card">
        <div class="card-row">
          <span>${fmtDateTime(a.fecha)}</span>
          ${a.tarde ? '<span class="badge badge-red">Tarde</span>' : '<span class="badge badge-green">A tiempo</span>'}
        </div>
      </div>
    `).join('') : '<div class="empty-state">Aun no has marcado entrada.</div>'}
  `;

  const btn = document.getElementById('btn-marcar-entrada');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const ahora = new Date();
      let tarde = false;
      if (perfil.horaEntrada) {
        const [h, m] = perfil.horaEntrada.split(':').map(Number);
        const limite = new Date(ahora);
        limite.setHours(h, m, 0, 0);
        tarde = ahora > limite;
      }
      await addDoc(collection(db, 'asistencia'), {
        uid: user.uid,
        email: user.email,
        nombre: perfil.nombre || user.email,
        fecha: ahora.toISOString(),
        horaEntradaEsperada: perfil.horaEntrada || null,
        tarde,
        registradoEn: serverTimestamp()
      });
      showSuccessOverlay(tarde ? 'Entrada marcada (tarde)' : 'Entrada marcada a tiempo', fmtDateTime(ahora.toISOString()));
      renderAsistencia();
    } catch (err) {
      toast('No se pudo marcar la entrada: ' + (err.message || err.code || 'intenta de nuevo'), 'error');
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Listeners en vivo de Firestore
// ---------------------------------------------------------------------------
function startListeners() {
  const despachosQuery = query(collection(db, 'despachos'), orderBy('fechaCreacion', 'desc'));
  unsubDespachos = onSnapshot(despachosQuery, (snap) => {
    despachosCache = snap.docs.map((d) => d.data());
    if (currentTab === 'despachos') renderDespachos();
  }, (err) => toast('Error cargando despachos: ' + err.message, 'error'));

  const creditosQuery = query(collection(db, 'creditos'));
  unsubCreditos = onSnapshot(creditosQuery, (snap) => {
    creditosCache = snap.docs.map((d) => d.data());
    if (currentTab === 'cartera') renderCartera();
  }, (err) => toast('Error cargando cartera: ' + err.message, 'error'));
}

// ---------------------------------------------------------------------------
// Despachos
// ---------------------------------------------------------------------------
function estadoBadge(estado) {
  const map = {
    pendiente: '<span class="badge badge-yellow">Pendiente</span>',
    en_camino: '<span class="badge badge-blue">En camino</span>',
    entregado: '<span class="badge badge-green">Entregado</span>'
  };
  return map[estado] || estado;
}

function renderDespachos() {
  const content = document.getElementById('content');
  const pendientes = despachosCache.filter((d) => d.estado !== 'entregado');
  const entregados = despachosCache.filter((d) => d.estado === 'entregado');

  content.innerHTML = `
    <div class="card-actions" style="margin-bottom:14px">
      <button class="btn btn-primary" id="btn-scan-salida">📷 Escanear salida (QR)</button>
      <button class="btn" id="btn-entrega-manual">✅ Confirmar entrega</button>
    </div>
    <div class="section-title">Pendientes / en camino (${pendientes.length})</div>
    ${pendientes.length ? pendientes.map(despachoCard).join('') : '<div class="empty-state">No hay despachos pendientes.</div>'}
    ${entregados.length ? `
      <div class="section-title">Entregados recientemente</div>
      ${entregados.slice(0, 10).map(despachoCard).join('')}
    ` : ''}
  `;

  document.getElementById('btn-scan-salida').addEventListener('click', openScanSalidaModal);
  document.getElementById('btn-entrega-manual').addEventListener('click', openConfirmarEntregaModal);
  content.querySelectorAll('[data-despacho]').forEach((card) => {
    card.addEventListener('click', () => openDespachoDetalle(card.dataset.despacho));
  });
}

function despachoCard(d) {
  return `
    <div class="card" data-despacho="${d.id}">
      <div class="card-title">${escapeHtml(d.numeroFactura || ('Despacho #' + d.id))} ${estadoBadge(d.estado)}</div>
      <div class="card-row"><span>Cliente</span><strong>${escapeHtml((d.cliente && d.cliente.nombre) || '')}</strong></div>
      <div class="card-row"><span>Direccion</span><strong>${escapeHtml(d.direccionEnvio || '')}</strong></div>
      <div class="card-row"><span>Celular</span><strong>${escapeHtml(d.celularEnvio || '')}</strong></div>
    </div>
  `;
}

function openDespachoDetalle(id) {
  const d = despachosCache.find((x) => String(x.id) === String(id));
  if (!d) return;
  showModal(`
    <h2>${escapeHtml(d.numeroFactura || '')}</h2>
    <p>${estadoBadge(d.estado)}</p>
    <div class="card-row"><span>Cliente</span><strong>${escapeHtml((d.cliente && d.cliente.nombre) || '')}</strong></div>
    <div class="card-row"><span>CC/NIT</span><strong>${escapeHtml(d.cedulaEnvio || '')}</strong></div>
    <div class="card-row"><span>Direccion</span><strong>${escapeHtml(d.direccionEnvio || '')}</strong></div>
    <div class="card-row"><span>Referencia</span><strong>${escapeHtml(d.descripcionEnvio || '')}</strong></div>
    <div class="card-row"><span>Celular</span><strong>${escapeHtml(d.celularEnvio || '')}</strong></div>
    <div class="card-row"><span>Codigo QR</span><strong>${escapeHtml(d.codigo || '')}</strong></div>
    <div class="card-row"><span>Codigo de entrega</span><strong>${escapeHtml(d.codigoEntrega || '')}</strong></div>
    <div class="card-row"><span>Total</span><strong>${money(d.total)}</strong></div>
    <div class="modal-actions">
      <button class="btn" id="btn-cerrar-detalle">Cerrar</button>
    </div>
  `, () => {
    document.getElementById('btn-cerrar-detalle').addEventListener('click', closeModal);
  });
}

function openScanSalidaModal() {
  showModal(`
    <h2>Escanear salida</h2>
    <div class="scan-hint">Apunta la camara al codigo QR pegado en el paquete.</div>
    <div id="qr-reader"></div>
    <div class="form-group">
      <label>O escribe el codigo manualmente</label>
      <input type="text" id="codigo-manual" placeholder="DESP-..." />
    </div>
    <div class="modal-actions">
      <button class="btn" id="btn-cerrar-scan">Cancelar</button>
      <button class="btn btn-primary" id="btn-confirmar-manual">Confirmar</button>
    </div>
  `, () => {
    document.getElementById('btn-cerrar-scan').addEventListener('click', closeModal);
    document.getElementById('btn-confirmar-manual').addEventListener('click', () => {
      const val = document.getElementById('codigo-manual').value.trim();
      if (val) verificarSalida(val);
    });
    startScanner('qr-reader', (decodedText) => verificarSalida(decodedText));
  });
}

function openConfirmarEntregaModal() {
  showModal(`
    <h2>Confirmar entrega</h2>
    <div class="scan-hint">Pide al cliente el codigo de 4 digitos que le llego por WhatsApp.</div>
    <div class="form-group">
      <label>Codigo de entrega</label>
      <input type="text" id="codigo-entrega" inputmode="numeric" placeholder="Ej: 4821" />
    </div>
    <div class="modal-actions">
      <button class="btn" id="btn-cerrar-entrega">Cancelar</button>
      <button class="btn btn-primary" id="btn-confirmar-entrega">Confirmar entrega</button>
    </div>
  `, () => {
    document.getElementById('btn-cerrar-entrega').addEventListener('click', closeModal);
    document.getElementById('btn-confirmar-entrega').addEventListener('click', () => {
      const val = document.getElementById('codigo-entrega').value.trim();
      if (val) verificarEntrega(val);
    });
  });
}

function startScanner(elementId, onDecoded) {
  if (typeof Html5Qrcode === 'undefined') {
    toast('No se pudo cargar el escaner de camara', 'error');
    return;
  }
  qrScanner = new Html5Qrcode(elementId);
  qrScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 220 },
    (decodedText) => { onDecoded(decodedText); },
    () => {}
  ).catch(() => toast('No se pudo acceder a la camara', 'error'));
}
function stopScanner() {
  if (qrScanner) {
    qrScanner.stop().catch(() => {}).finally(() => { qrScanner = null; });
  }
}

async function verificarSalida(codigo) {
  try {
    const q = query(collection(db, 'despachos'), where('codigo', '==', codigo.trim()));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error('Codigo QR no encontrado');
    const docRef = snap.docs[0].ref;
    let numeroFactura = '';
    await runTransaction(db, async (tx) => {
      const fresh = await tx.get(docRef);
      const data = fresh.data();
      if (data.estado !== 'pendiente') throw new Error(`Este pedido ya fue marcado como "${data.estado}"`);
      numeroFactura = data.numeroFactura;
      tx.update(docRef, { estado: 'en_camino', fechaSalida: new Date().toISOString(), updatedAt: serverTimestamp() });
    });
    closeModal();
    showSuccessOverlay('Iniciando entrega', numeroFactura ? `Pedido ${numeroFactura}` : '');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function verificarEntrega(codigoEntrega) {
  try {
    const q = query(collection(db, 'despachos'), where('codigoEntrega', '==', codigoEntrega.trim()));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error('Codigo de entrega no encontrado');
    const docRef = snap.docs[0].ref;
    let numeroFactura = '';
    await runTransaction(db, async (tx) => {
      const fresh = await tx.get(docRef);
      const data = fresh.data();
      if (data.estado !== 'en_camino') throw new Error(`Este pedido esta en estado "${data.estado}", no se puede finalizar la entrega`);
      numeroFactura = data.numeroFactura;
      tx.update(docRef, { estado: 'entregado', fechaEntrega: new Date().toISOString(), updatedAt: serverTimestamp() });
    });
    closeModal();
    showSuccessOverlay('Finalizo entrega', numeroFactura ? `Pedido ${numeroFactura}` : '');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Cartera
// ---------------------------------------------------------------------------
function renderCartera() {
  const content = document.getElementById('content');
  const morosos = creditosCache.filter((c) => esMoroso(c));
  const activos = creditosCache.filter((c) => c.estado === 'activo' && !esMoroso(c));
  const pagados = creditosCache.filter((c) => c.estado === 'pagado');

  content.innerHTML = `
    ${morosos.length ? `
      <div class="section-title">⚠️ Morosos (${morosos.length})</div>
      ${morosos.map((c) => creditoCard(c, true)).join('')}
    ` : ''}
    <div class="section-title">Al dia (${activos.length})</div>
    ${activos.length ? activos.map((c) => creditoCard(c, false)).join('') : '<div class="empty-state">No hay creditos activos al dia.</div>'}
    ${pagados.length ? `
      <div class="section-title">Pagados</div>
      ${pagados.slice(0, 10).map((c) => creditoCard(c, false)).join('')}
    ` : ''}
  `;

  content.querySelectorAll('[data-credito]').forEach((card) => {
    card.addEventListener('click', () => openCreditoDetalle(card.dataset.credito));
  });
}

function creditoCard(c, moroso) {
  return `
    <div class="card ${moroso ? 'moroso-row' : ''}" data-credito="${c.id}">
      <div class="card-title">${escapeHtml((c.cliente && c.cliente.nombre) || '')} ${moroso ? '<span class="badge badge-red">Moroso</span>' : ''}</div>
      <div class="card-row"><span>Factura</span><strong>${escapeHtml(c.numeroFactura || '')}</strong></div>
      <div class="card-row"><span>Saldo pendiente</span><strong>${money(c.saldoPendiente)}</strong></div>
      <div class="card-row"><span>Proximo pago</span><strong>${fmtDate(c.fechaProximoPago)}</strong></div>
    </div>
  `;
}

function openCreditoDetalle(id) {
  const c = creditosCache.find((x) => String(x.id) === String(id));
  if (!c) return;
  showModal(`
    <h2>${escapeHtml((c.cliente && c.cliente.nombre) || '')}</h2>
    <div class="card-row"><span>Factura</span><strong>${escapeHtml(c.numeroFactura || '')}</strong></div>
    <div class="card-row"><span>Saldo pendiente</span><strong>${money(c.saldoPendiente)}</strong></div>
    <div class="card-row"><span>Total con interes</span><strong>${money(c.totalConInteres)}</strong></div>
    <div class="card-row"><span>Cuotas</span><strong>${(c.pagos || []).length} / ${c.cuotas}</strong></div>
    <div class="card-row"><span>Estado</span><strong>${c.estado === 'pagado' ? 'Pagado' : (esMoroso(c) ? 'Moroso' : 'Activo')}</strong></div>

    ${(c.pagos || []).length ? `
      <div class="section-title">Abonos</div>
      ${c.pagos.map((p) => `
        <div class="card-row">
          <span>Cuota ${p.numeroCuota} &middot; ${fmtDateTime(p.fecha)}</span>
          <strong>${money(p.monto)} ${p.verificado ? '' : '<span class="badge badge-yellow">Por revisar</span>'}</strong>
        </div>
      `).join('')}
    ` : ''}

    ${c.estado !== 'pagado' ? `
      <div class="section-title">Registrar abono</div>
      <div class="form-group">
        <label>Monto (COP)</label>
        <input type="number" id="abono-monto" min="1" max="${c.saldoPendiente}" />
      </div>
      <div class="form-group">
        <label>Medio de pago</label>
        <select id="abono-medio">
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
        </select>
      </div>
      <div class="form-group" id="abono-comprobante-group" style="display:none">
        <label>Foto del comprobante</label>
        <input type="file" id="abono-comprobante" accept="image/*" capture="environment" />
      </div>
      <div class="modal-actions">
        <button class="btn" id="btn-cerrar-credito">Cerrar</button>
        <button class="btn btn-primary" id="btn-registrar-abono">Registrar abono</button>
      </div>
    ` : `
      <div class="modal-actions">
        <button class="btn" id="btn-cerrar-credito">Cerrar</button>
      </div>
    `}
  `, () => {
    document.getElementById('btn-cerrar-credito').addEventListener('click', closeModal);
    const medioSelect = document.getElementById('abono-medio');
    if (medioSelect) {
      medioSelect.addEventListener('change', () => {
        document.getElementById('abono-comprobante-group').style.display = medioSelect.value === 'transferencia' ? 'block' : 'none';
      });
    }
    const btnAbono = document.getElementById('btn-registrar-abono');
    if (btnAbono) {
      btnAbono.addEventListener('click', () => registrarAbono(c.id));
    }
  });
}

async function registrarAbono(creditoId) {
  const montoInput = document.getElementById('abono-monto');
  const medio = document.getElementById('abono-medio').value;
  const fileInput = document.getElementById('abono-comprobante');
  const monto = Number(montoInput.value);

  if (!monto || monto <= 0) { toast('Ingresa un monto de abono valido', 'error'); return; }

  const btn = document.getElementById('btn-registrar-abono');
  btn.disabled = true;
  try {
    let comprobanteUrl = null;
    if (medio === 'transferencia' && fileInput.files[0]) {
      try {
        const file = fileInput.files[0];
        const path = `comprobantes/${creditoId}/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        comprobanteUrl = await getDownloadURL(storageRef);
      } catch (uploadErr) {
        // Storage puede no estar activado en el proyecto de Firebase (requiere
        // el plan de pago); el abono se registra igual, solo que sin foto.
        toast('No se pudo subir la foto del comprobante, el abono se registrara sin ella', 'error');
      }
    }

    const docRef = doc(db, 'creditos', String(creditoId));
    await runTransaction(db, async (tx) => {
      const fresh = await tx.get(docRef);
      const data = fresh.data();
      if (!data) throw new Error('Credito no encontrado');
      if (data.estado === 'pagado') throw new Error('Este credito ya esta pagado en su totalidad');
      if (monto > data.saldoPendiente) throw new Error('El abono no puede ser mayor al saldo pendiente');

      const pagos = data.pagos || [];
      const numeroCuota = pagos.length + 1;
      const nuevoPago = {
        numeroCuota,
        fecha: new Date().toISOString(),
        monto,
        medioPago: medio,
        comprobante: null,
        comprobanteUrl,
        origen: 'web',
        verificado: !(medio === 'transferencia' && comprobanteUrl)
      };
      const nuevoSaldo = data.saldoPendiente - monto;
      const actualizacion = {
        pagos: [...pagos, nuevoPago],
        saldoPendiente: Math.max(0, nuevoSaldo),
        updatedAt: serverTimestamp()
      };
      if (nuevoSaldo <= 0) {
        actualizacion.estado = 'pagado';
      } else {
        actualizacion.fechaProximoPago = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      }
      tx.update(docRef, actualizacion);
    });

    closeModal();
    toast('Abono registrado correctamente', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
