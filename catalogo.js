// Catalogo publico de productos: pagina sin login que lee la coleccion
// "catalogo" de Firestore (publicada desde la app de escritorio, ver
// Catalogo en el menu). Cualquiera con el link puede verla.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

function money(n) {
  return '$ ' + Math.round(n || 0).toLocaleString('es-CO');
}
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function buildWhatsappLink(celular, mensaje) {
  let digits = String(celular || '').replace(/\D/g, '');
  if (digits.length === 10) digits = '57' + digits;
  return `https://wa.me/${digits}?text=${encodeURIComponent(mensaje)}`;
}

const firebaseConfig = window.TECHZONE_FIREBASE_CONFIG || {};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

let productos = [];
let meta = {};
let categoriaActiva = 'Todos';

async function cargar() {
  const grid = document.getElementById('catalogo-grid');
  try {
    const snap = await getDocs(collection(db, 'catalogo'));
    productos = [];
    snap.docs.forEach((d) => {
      if (d.id === '_meta') meta = d.data();
      else productos.push({ id: d.id, ...d.data() });
    });
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">No se pudo cargar el catalogo (${escapeHtml(err.message)}).</div>`;
    return;
  }

  if (meta.nombreTienda) {
    document.getElementById('catalogo-nombre').textContent = meta.nombreTienda;
    document.title = 'Catalogo - ' + meta.nombreTienda;
  }
  if (meta.eslogan) document.getElementById('catalogo-eslogan').textContent = meta.eslogan;
  if (meta.telefono) {
    const btn = document.getElementById('btn-contactar');
    btn.hidden = false;
    btn.addEventListener('click', () => {
      window.open(buildWhatsappLink(meta.telefono, 'Hola! Quiero mas informacion sobre sus productos.'), '_blank');
    });
  }

  if (!productos.length) {
    grid.innerHTML = `<div class="empty-state">Este catalogo todavia no tiene productos publicados.</div>`;
    document.getElementById('catalogo-categorias').innerHTML = '';
    return;
  }

  pintarCategorias();
  pintarGrid();

  document.getElementById('catalogo-buscar').addEventListener('input', pintarGrid);
}

function pintarCategorias() {
  const categorias = ['Todos', ...new Set(productos.map((p) => p.categoria || 'Otros'))];
  const cont = document.getElementById('catalogo-categorias');
  cont.innerHTML = categorias.map((c) => `<button class="cat-chip ${c === categoriaActiva ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
  cont.querySelectorAll('[data-cat]').forEach((btn) => btn.addEventListener('click', () => {
    categoriaActiva = btn.dataset.cat;
    pintarCategorias();
    pintarGrid();
  }));
}

function pintarGrid() {
  const q = (document.getElementById('catalogo-buscar').value || '').toLowerCase();
  const filtrados = productos.filter((p) =>
    (categoriaActiva === 'Todos' || (p.categoria || 'Otros') === categoriaActiva) &&
    (!q || (p.nombre || '').toLowerCase().includes(q))
  );

  const grid = document.getElementById('catalogo-grid');
  if (!filtrados.length) {
    grid.innerHTML = `<div class="empty-state">No hay productos que coincidan.</div>`;
    return;
  }

  grid.innerHTML = `<div class="cat-grid">${filtrados.map((p) => `
    <div class="cat-card">
      <div class="cat-img-wrap">
        ${p.imagen ? `<img src="${p.imagen}" alt="" loading="lazy" />` : `<span class="cat-img-empty">📦</span>`}
      </div>
      <div class="cat-info">
        <div class="cat-cat">${escapeHtml(p.categoria || 'Otros')}</div>
        <div class="cat-name">${escapeHtml(p.nombre)}</div>
        <div class="cat-price">${money(p.precioVenta)}</div>
        ${p.stock <= 0 ? '<span class="badge badge-red" style="margin-top:6px">Agotado</span>' : ''}
      </div>
    </div>
  `).join('')}</div>`;
}

cargar();
