// Tienda publica: pagina sin login para armar un pedido y comprarlo por
// WhatsApp (sin pasarela de pago propia). Lee la misma coleccion "catalogo"
// de Firestore que la pagina de Catalogo (ver electron/firebaseSync.js ->
// publicarCatalogo, y Catalogo en el menu del escritorio), asi que siempre
// refleja el inventario real que el Dueño publico.
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

// Numero de WhatsApp donde llegan los pedidos (fijo, igual que en catalogo.js).
const WHATSAPP_TIENDA = '3135639329';
const CARRITO_KEY = 'tz_carrito';

const firebaseConfig = window.TECHZONE_FIREBASE_CONFIG || {};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

let productos = [];
let meta = {};
let categoriaActiva = 'Todos';
let carrito = cargarCarritoGuardado();

function cargarCarritoGuardado() {
  try {
    const guardado = localStorage.getItem(CARRITO_KEY);
    return guardado ? JSON.parse(guardado) : [];
  } catch (err) {
    return [];
  }
}
function guardarCarrito() {
  try {
    localStorage.setItem(CARRITO_KEY, JSON.stringify(carrito));
  } catch (err) {
    // Almacenamiento no disponible (privado/bloqueado): el carrito sigue
    // funcionando en memoria durante esta visita, solo no se recuerda.
  }
}

async function cargar() {
  const grid = document.getElementById('tienda-grid');
  try {
    const snap = await getDocs(collection(db, 'catalogo'));
    productos = [];
    snap.docs.forEach((d) => {
      if (d.id === '_meta') meta = d.data();
      else productos.push({ id: d.id, ...d.data() });
    });
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">No se pudo cargar la tienda (${escapeHtml(err.message)}).</div>`;
    return;
  }

  if (meta.nombreTienda) {
    document.getElementById('tienda-nombre').textContent = meta.nombreTienda;
    document.getElementById('tienda-footer-nombre').textContent = meta.nombreTienda;
    document.title = 'Tienda - ' + meta.nombreTienda;
  }
  if (meta.eslogan) document.getElementById('tienda-eslogan').textContent = meta.eslogan;
  if (meta.telefono) {
    document.getElementById('tienda-footer-tel').textContent = '📱 WhatsApp de la tienda: ' + meta.telefono;
  }

  if (!productos.length) {
    grid.innerHTML = `<div class="empty-state">Todavia no hay productos publicados.</div>`;
    document.getElementById('tienda-categorias').innerHTML = '';
    document.getElementById('tienda-categorias-tiles').innerHTML = '';
    return;
  }

  // Si algo del carrito guardado ya no existe (o se agoto), se limpia.
  carrito = carrito.filter((item) => productos.some((p) => p.id === item.id && p.stock > 0));
  guardarCarrito();

  pintarCategoriaTiles();
  pintarCategorias();
  pintarGrid();
  actualizarBotonFlotante();

  document.getElementById('tienda-buscar').addEventListener('input', pintarGrid);
  document.getElementById('btn-ver-carrito').addEventListener('click', mostrarCarritoModal);
  document.getElementById('btn-carrito-header').addEventListener('click', mostrarCarritoModal);
}

// Una tarjeta grande por categoria (con la foto del primer producto de esa
// categoria que tenga imagen), al estilo de las tiendas de tecnologia: mas
// facil de tocar en el celular que una lista de texto.
function pintarCategoriaTiles() {
  const categorias = [...new Set(productos.map((p) => p.categoria || 'Otros'))];
  const cont = document.getElementById('tienda-categorias-tiles');
  cont.innerHTML = categorias.map((c) => {
    const ejemplo = productos.find((p) => (p.categoria || 'Otros') === c && p.imagen);
    return `
      <div class="shop-cat-tile ${c === categoriaActiva ? 'active' : ''}" data-cat-tile="${escapeHtml(c)}">
        <div class="shop-cat-tile-img">${ejemplo ? `<img src="${ejemplo.imagen}" alt="" loading="lazy" />` : '📦'}</div>
        <div class="shop-cat-tile-label">${escapeHtml(c)}</div>
      </div>
    `;
  }).join('');
  cont.querySelectorAll('[data-cat-tile]').forEach((tile) => tile.addEventListener('click', () => {
    categoriaActiva = tile.dataset.catTile;
    pintarCategorias();
    pintarGrid();
    document.getElementById('tienda-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function pintarCategorias() {
  const categorias = ['Todos', ...new Set(productos.map((p) => p.categoria || 'Otros'))];
  const cont = document.getElementById('tienda-categorias');
  cont.innerHTML = categorias.map((c) => `<button class="cat-chip ${c === categoriaActiva ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
  cont.querySelectorAll('[data-cat]').forEach((btn) => btn.addEventListener('click', () => {
    categoriaActiva = btn.dataset.cat;
    pintarCategorias();
    pintarCategoriaTiles();
    pintarGrid();
  }));
}

function cantidadEnCarrito(id) {
  const item = carrito.find((i) => i.id === id);
  return item ? item.cantidad : 0;
}

function pintarGrid() {
  const q = (document.getElementById('tienda-buscar').value || '').toLowerCase();
  const filtrados = productos.filter((p) =>
    (categoriaActiva === 'Todos' || (p.categoria || 'Otros') === categoriaActiva) &&
    (!q || (p.nombre || '').toLowerCase().includes(q))
  );

  const grid = document.getElementById('tienda-grid');
  if (!filtrados.length) {
    grid.innerHTML = `<div class="empty-state">No hay productos que coincidan.</div>`;
    return;
  }

  grid.innerHTML = `<div class="cat-grid">${filtrados.map((p) => {
    const cant = cantidadEnCarrito(p.id);
    const agotado = p.stock <= 0;
    return `
    <div class="cat-card" data-producto="${escapeHtml(p.id)}">
      <div class="cat-img-wrap">
        ${p.imagen ? `<img src="${p.imagen}" alt="" loading="lazy" />` : `<span class="cat-img-empty">📦</span>`}
      </div>
      <div class="cat-info">
        <div class="cat-cat">${escapeHtml(p.categoria || 'Otros')}</div>
        <div class="cat-name">${escapeHtml(p.nombre)}</div>
        <div class="cat-price">${money(p.precioVenta)}</div>
        ${agotado ? '<span class="badge badge-red" style="margin-top:6px">Agotado</span>' : ''}
      </div>
      <div class="tienda-card-actions" data-frenar-click="1">
        ${agotado ? '' : cant > 0 ? `
          <div class="tienda-qty">
            <button data-restar="${escapeHtml(p.id)}">-</button>
            <span>${cant}</span>
            <button data-sumar="${escapeHtml(p.id)}" ${cant >= p.stock ? 'disabled' : ''}>+</button>
          </div>
        ` : `<button class="btn btn-sm btn-primary" style="width:100%" data-agregar="${escapeHtml(p.id)}">+ Agregar</button>`}
      </div>
    </div>
  `;
  }).join('')}</div>`;

  grid.querySelectorAll('[data-producto]').forEach((card) => {
    card.addEventListener('click', () => mostrarDetalleProducto(filtrados.find((p) => p.id === card.dataset.producto)));
  });
  grid.querySelectorAll('[data-frenar-click]').forEach((el) => el.addEventListener('click', (e) => e.stopPropagation()));
  grid.querySelectorAll('[data-agregar]').forEach((btn) => btn.addEventListener('click', () => cambiarCantidad(btn.dataset.agregar, 1)));
  grid.querySelectorAll('[data-sumar]').forEach((btn) => btn.addEventListener('click', () => cambiarCantidad(btn.dataset.sumar, 1)));
  grid.querySelectorAll('[data-restar]').forEach((btn) => btn.addEventListener('click', () => cambiarCantidad(btn.dataset.restar, -1)));
}

function mostrarDetalleProducto(p) {
  if (!p) return;
  const cant = cantidadEnCarrito(p.id);
  const agotado = p.stock <= 0;
  showModal(`
    <div class="cat-img-wrap" style="border-radius:12px; aspect-ratio:1.3">
      ${p.imagen ? `<img src="${p.imagen}" alt="" />` : `<span class="cat-img-empty" style="font-size:48px">📦</span>`}
    </div>
    <div class="cat-cat" style="margin-top:14px">${escapeHtml(p.categoria || 'Otros')}</div>
    <h2 style="margin:4px 0">${escapeHtml(p.nombre)}</h2>
    ${p.descripcion ? `<p class="text-dim" style="font-size:13.5px">${escapeHtml(p.descripcion)}</p>` : ''}
    <div class="cat-price" style="font-size:24px; margin-top:8px">${money(p.precioVenta)}</div>
    ${agotado ? '<span class="badge badge-red" style="margin-top:6px">Agotado</span>' : '<span class="badge badge-green" style="margin-top:6px">Disponible</span>'}
    ${agotado ? '' : `
      <div style="margin-top:14px">
        ${cant > 0 ? `
          <div class="tienda-qty" style="max-width:160px">
            <button data-restar-detalle="${escapeHtml(p.id)}">-</button>
            <span>${cant}</span>
            <button data-sumar-detalle="${escapeHtml(p.id)}" ${cant >= p.stock ? 'disabled' : ''}>+</button>
          </div>
        ` : `<button class="btn btn-primary btn-block" data-agregar-detalle="${escapeHtml(p.id)}">+ Agregar al pedido</button>`}
      </div>
    `}
    <div class="modal-actions">
      <button class="btn btn-sm" id="btn-cerrar-detalle">Cerrar</button>
      <button class="btn btn-primary" id="btn-contactar-producto">📱 Contactanos</button>
    </div>
  `);
  document.getElementById('btn-cerrar-detalle').addEventListener('click', closeModal);
  document.getElementById('btn-contactar-producto').addEventListener('click', () => {
    const mensaje = `Hola! Quiero mas informacion sobre "${p.nombre}".`;
    window.open(buildWhatsappLink(WHATSAPP_TIENDA, mensaje), '_blank');
  });
  const btnAgregar = document.querySelector('[data-agregar-detalle]');
  if (btnAgregar) btnAgregar.addEventListener('click', () => { cambiarCantidad(p.id, 1); mostrarDetalleProducto(p); });
  const btnSumar = document.querySelector('[data-sumar-detalle]');
  if (btnSumar) btnSumar.addEventListener('click', () => { cambiarCantidad(p.id, 1); mostrarDetalleProducto(p); });
  const btnRestar = document.querySelector('[data-restar-detalle]');
  if (btnRestar) btnRestar.addEventListener('click', () => { cambiarCantidad(p.id, -1); mostrarDetalleProducto(p); });
}

function cambiarCantidad(id, delta) {
  const producto = productos.find((p) => p.id === id);
  if (!producto) return;
  let item = carrito.find((i) => i.id === id);
  if (!item) {
    if (delta <= 0) return;
    item = { id, nombre: producto.nombre, precioVenta: producto.precioVenta, imagen: producto.imagen || null, cantidad: 0 };
    carrito.push(item);
  }
  item.cantidad = Math.max(0, Math.min(producto.stock, item.cantidad + delta));
  if (item.cantidad === 0) carrito = carrito.filter((i) => i.id !== id);
  guardarCarrito();
  pintarGrid();
  actualizarBotonFlotante();
}

function totalCarrito() {
  return carrito.reduce((s, i) => s + i.precioVenta * i.cantidad, 0);
}
function cantidadTotalCarrito() {
  return carrito.reduce((s, i) => s + i.cantidad, 0);
}

function actualizarBotonFlotante() {
  const cont = document.getElementById('carrito-flotante');
  const btn = document.getElementById('btn-ver-carrito');
  const badge = document.getElementById('carrito-badge');
  const n = cantidadTotalCarrito();

  badge.hidden = n === 0;
  badge.textContent = n;

  if (n === 0) {
    cont.hidden = true;
    return;
  }
  cont.hidden = false;
  btn.textContent = `🛒 Ver pedido (${n}) · ${money(totalCarrito())}`;
}

function mostrarCarritoModal() {
  if (!carrito.length) {
    showModal(`
      <div class="carrito-header"><span>🛒</span> Tu pedido</div>
      <div class="empty-state">Aun no has agregado productos.</div>
      <div class="modal-actions"><button class="btn btn-sm" id="btn-cerrar-carrito">Cerrar</button></div>
    `);
    document.getElementById('btn-cerrar-carrito').addEventListener('click', closeModal);
    return;
  }

  showModal(`
    <div class="carrito-header"><span>🛒</span> Tu pedido <span class="carrito-header-count">${cantidadTotalCarrito()} articulo${cantidadTotalCarrito() === 1 ? '' : 's'}</span></div>
    <div class="carrito-lista">
      ${carrito.map((i) => `
        <div class="carrito-item">
          <div class="carrito-item-img">${i.imagen ? `<img src="${i.imagen}" alt="" />` : '📦'}</div>
          <div class="carrito-item-info">
            <div class="carrito-item-nombre">${escapeHtml(i.nombre)}</div>
            <div class="carrito-item-precio">${money(i.precioVenta)} c/u</div>
            <div class="carrito-item-subtotal">${money(i.precioVenta * i.cantidad)}</div>
          </div>
          <div class="tienda-qty">
            <button data-restar-modal="${escapeHtml(i.id)}">-</button>
            <span>${i.cantidad}</span>
            <button data-sumar-modal="${escapeHtml(i.id)}">+</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="carrito-total-row"><span>Total</span><span>${money(totalCarrito())}</span></div>
    <div class="modal-actions">
      <button class="btn btn-sm" id="btn-vaciar-carrito">Vaciar</button>
      <button class="btn btn-sm" id="btn-cerrar-carrito">Seguir viendo</button>
    </div>
    <button class="btn btn-primary btn-block" id="btn-comprar-whatsapp" style="margin-top:10px">📱 Comprar por WhatsApp</button>
  `);

  document.getElementById('btn-cerrar-carrito').addEventListener('click', closeModal);
  document.getElementById('btn-vaciar-carrito').addEventListener('click', () => {
    if (!confirm('¿Vaciar todo el pedido?')) return;
    carrito = [];
    guardarCarrito();
    closeModal();
    pintarGrid();
    actualizarBotonFlotante();
  });
  document.querySelectorAll('[data-sumar-modal]').forEach((btn) => btn.addEventListener('click', () => { cambiarCantidad(btn.dataset.sumarModal, 1); mostrarCarritoModal(); }));
  document.querySelectorAll('[data-restar-modal]').forEach((btn) => btn.addEventListener('click', () => { cambiarCantidad(btn.dataset.restarModal, -1); mostrarCarritoModal(); }));
  document.getElementById('btn-comprar-whatsapp').addEventListener('click', () => {
    const lineas = carrito.map((i) => `- ${i.cantidad}x ${i.nombre} (${money(i.precioVenta)} c/u) = ${money(i.precioVenta * i.cantidad)}`);
    const mensaje = `Hola! Quiero hacer este pedido:\n${lineas.join('\n')}\n\nTotal: ${money(totalCarrito())}`;
    window.open(buildWhatsappLink(WHATSAPP_TIENDA, mensaje), '_blank');
  });
}

cargar();
