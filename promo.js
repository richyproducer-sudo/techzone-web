// Pagina de la promocion "10% OFF en compras superiores a $500.000" a la
// que llega el cliente desde el QR/link que comparte la tienda. Genera un
// codigo de descuento unico por visitante (igual que en catalogo.js/tienda.js)
// pero con una compra minima exigida, y lo guarda en Firestore para que se
// pueda validar despues en Punto de Venta.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

function money(n) {
  return '$ ' + Math.round(n || 0).toLocaleString('es-CO');
}

const PROMO_PORCENTAJE = 10;
const PROMO_MONTO_MINIMO = 500000;
const CODIGO_KEY = 'tz_codigo_promo10';

function generarCodigoAleatorio() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = 'TZ-';
  for (let i = 0; i < 6; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
  return codigo;
}

const firebaseConfig = window.TECHZONE_FIREBASE_CONFIG || {};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

async function obtenerOCrearCodigoPromo() {
  try {
    const guardado = localStorage.getItem(CODIGO_KEY);
    if (guardado) {
      const registro = JSON.parse(guardado);
      // Si ya se uso, se revisa en Firestore por si sigue vigente o se debe avisar que ya se canjeo.
      const snap = await getDoc(doc(db, 'descuentos', registro.codigo));
      if (snap.exists()) return { ...registro, usado: snap.data().usado };
      return registro;
    }
  } catch (err) {
    // sin acceso a localStorage o a Firestore: se genera uno nuevo igual.
  }

  const registro = {
    codigo: generarCodigoAleatorio(),
    porcentaje: PROMO_PORCENTAJE,
    montoMinimo: PROMO_MONTO_MINIMO,
    creadoEn: new Date().toISOString(),
    usado: false,
    origen: 'promo-qr'
  };
  try {
    await setDoc(doc(db, 'descuentos', registro.codigo), registro);
  } catch (err) {
    return null;
  }
  try { localStorage.setItem(CODIGO_KEY, JSON.stringify(registro)); } catch (err) {}
  return registro;
}

async function cargar() {
  document.getElementById('promo-pct-titulo').textContent = `${PROMO_PORCENTAJE}% OFF`;
  document.getElementById('promo-sub-titulo').textContent = `En compras superiores a ${money(PROMO_MONTO_MINIMO)}`;

  const cont = document.getElementById('promo-contenido');
  const registro = await obtenerOCrearCodigoPromo();
  if (!registro) {
    cont.innerHTML = `<div class="promo-loading">No se pudo generar tu codigo. Intenta de nuevo mas tarde.</div>`;
    return;
  }
  if (registro.usado) {
    cont.innerHTML = `
      <div class="promo-codigo" style="opacity:0.5; text-decoration:line-through">${registro.codigo}</div>
      <div class="text-dim" style="font-size:13px">Este codigo ya fue usado.</div>
    `;
    return;
  }
  cont.innerHTML = `
    <div class="text-dim" style="font-size:12px">Tu codigo</div>
    <div class="promo-codigo" id="promo-codigo-valor">${registro.codigo}</div>
    <button class="btn btn-primary btn-block" id="btn-copiar-promo">📋 Copiar codigo</button>
  `;
  document.getElementById('btn-copiar-promo').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(registro.codigo);
      e.target.textContent = '✅ Copiado';
      setTimeout(() => { e.target.textContent = '📋 Copiar codigo'; }, 1800);
    } catch (err) {
      // sin acceso al portapapeles: el codigo ya esta visible en pantalla igual.
    }
  });
}

cargar();
