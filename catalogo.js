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

// Numero de WhatsApp para consultas sobre un producto especifico del
// catalogo (fijo, no depende de la config de la tienda).
const WHATSAPP_PRODUCTO = '3135639329';

function showModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" id="modal-overlay"><div class="modal">${html}</div></div>`;
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
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
    <div class="cat-card" data-producto="${escapeHtml(p.id)}">
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

  grid.querySelectorAll('[data-producto]').forEach((card) => {
    card.addEventListener('click', () => mostrarDetalleProducto(filtrados.find((p) => p.id === card.dataset.producto)));
  });
}

function mostrarDetalleProducto(p) {
  if (!p) return;
  showModal(`
    <div class="cat-img-wrap" style="border-radius:12px; aspect-ratio:1.3">
      ${p.imagen ? `<img src="${p.imagen}" alt="" />` : `<span class="cat-img-empty" style="font-size:48px">📦</span>`}
    </div>
    <div class="cat-cat" style="margin-top:14px">${escapeHtml(p.categoria || 'Otros')}</div>
    <h2 style="margin:4px 0">${escapeHtml(p.nombre)}</h2>
    ${p.descripcion ? `<p class="text-dim" style="font-size:13.5px">${escapeHtml(p.descripcion)}</p>` : ''}
    <div class="cat-price" style="font-size:24px; margin-top:8px">${money(p.precioVenta)}</div>
    ${p.stock <= 0 ? '<span class="badge badge-red" style="margin-top:6px">Agotado</span>' : '<span class="badge badge-green" style="margin-top:6px">Disponible</span>'}
    <div class="modal-actions">
      <button class="btn btn-sm" id="btn-cerrar-detalle">Cerrar</button>
      <button class="btn btn-primary" id="btn-contactar-producto">📱 Contactanos</button>
    </div>
  `);
  document.getElementById('btn-cerrar-detalle').addEventListener('click', closeModal);
  document.getElementById('btn-contactar-producto').addEventListener('click', () => {
    const mensaje = `Hola! Quiero mas informacion sobre "${p.nombre}" del catalogo.`;
    window.open(buildWhatsappLink(WHATSAPP_PRODUCTO, mensaje), '_blank');
  });
}

cargar();
