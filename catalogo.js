// Catalogo publico de productos: pagina sin login que lee la coleccion
// "catalogo" de Firestore (publicada desde la app de escritorio, ver
// Catalogo en el menu). Cualquiera con el link puede verla. Comparte el
// carrito (localStorage) con tienda.js, asi que agregar productos aqui o
// alla es lo mismo pedido.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getFirestore, collection, getDocs, doc, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

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

// Numero de WhatsApp para consultas y para comprar el pedido (fijo, no
// depende de la config de la tienda).
const WHATSAPP_PRODUCTO = '3135639329';
const CARRITO_KEY = 'tz_carrito';
const CODIGO_KEY = 'tz_codigo_descuento';

// Un codigo de descuento por dispositivo/navegador: se genera la primera
// vez que alguien entra (si el Dueño configuro un % de descuento web) y se
// reutiliza en visitas siguientes, guardado en Firestore para que el Dueño
// lo pueda ver y marcar como usado en Monitoreo.
function generarCodigoAleatorio() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = 'TZ-';
  for (let i = 0; i < 6; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
  return codigo;
}
async function obtenerOCrearCodigoDescuento(porcentaje) {
  try {
    const guardado = localStorage.getItem(CODIGO_KEY);
    if (guardado) return JSON.parse(guardado);
  } catch (err) {
    // sin acceso a localStorage: se sigue sin codigo, no rompe la pagina.
  }
  if (!porcentaje) return null;

  const registro = { codigo: generarCodigoAleatorio(), porcentaje, creadoEn: new Date().toISOString(), usado: false };
  try {
    await setDoc(doc(db, 'descuentos', registro.codigo), registro);
  } catch (err) {
    return null;
  }
  try { localStorage.setItem(CODIGO_KEY, JSON.stringify(registro)); } catch (err) {}
  return registro;
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

const firebaseConfig = window.TECHZONE_FIREBASE_CONFIG || {};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

let productos = [];
let meta = {};
let categoriaActiva = 'Todos';
let carrito = cargarCarritoGuardado();
let codigoDescuento = null;

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

  codigoDescuento = await obtenerOCrearCodigoDescuento(meta.descuentoWebPorcentaje || 0);
  pintarBannerDescuento();

  // Si algo del carrito guardado ya no existe (o se agoto), se limpia.
  carrito = carrito.filter((item) => productos.some((p) => p.id === item.id && p.stock > 0));
  guardarCarrito();

  pintarCategorias();
  pintarGrid();
  actualizarBotonFlotante();

  document.getElementById('catalogo-buscar').addEventListener('input', pintarGrid);
  document.getElementById('btn-ver-carrito').addEventListener('click', mostrarCarritoModal);
  document.getElementById('btn-carrito-header').addEventListener('click', mostrarCarritoModal);
}

function pintarBannerDescuento() {
  const cont = document.getElementById('codigo-descuento-banner');
  if (!cont) return;
  if (!codigoDescuento) {
    cont.innerHTML = '';
    return;
  }
  cont.innerHTML = `
    <div class="codigo-descuento-card">
      <div class="codigo-descuento-icono">🎁</div>
      <div class="codigo-descuento-texto">
        Tu codigo de descuento (${codigoDescuento.porcentaje}% OFF), menciónalo al comprar:<br />
        <span class="codigo-descuento-valor">${escapeHtml(codigoDescuento.codigo)}</span>
      </div>
      <button class="btn btn-sm codigo-descuento-copiar" id="btn-copiar-codigo-descuento">📋</button>
    </div>
  `;
  document.getElementById('btn-copiar-codigo-descuento').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codigoDescuento.codigo);
    } catch (err) {
      // sin acceso al portapapeles: el codigo ya esta visible en pantalla igual.
    }
  });
}

function tieneOferta(p) {
  return p.precioAnterior && p.precioAnterior > p.precioVenta;
}

function pintarCategorias() {
  const hayOfertas = productos.some(tieneOferta);
  const categorias = [...(hayOfertas ? ['Ofertas'] : []), 'Todos', ...new Set(productos.map((p) => p.categoria || 'Otros'))];
  const cont = document.getElementById('catalogo-categorias');
  cont.innerHTML = categorias.map((c) => `<button class="cat-chip ${c === categoriaActiva ? 'active' : ''} ${c === 'Ofertas' ? 'cat-chip-oferta' : ''}" data-cat="${escapeHtml(c)}">${c === 'Ofertas' ? '🔥 ' : ''}${escapeHtml(c)}</button>`).join('');
  cont.querySelectorAll('[data-cat]').forEach((btn) => btn.addEventListener('click', () => {
    categoriaActiva = btn.dataset.cat;
    pintarCategorias();
    pintarGrid();
  }));
}

function cantidadEnCarrito(id) {
  const item = carrito.find((i) => i.id === id);
  return item ? item.cantidad : 0;
}

function pintarGrid() {
  const q = (document.getElementById('catalogo-buscar').value || '').toLowerCase();
  const filtrados = productos.filter((p) =>
    (categoriaActiva === 'Todos' || (categoriaActiva === 'Ofertas' ? tieneOferta(p) : (p.categoria || 'Otros') === categoriaActiva)) &&
    (!q || (p.nombre || '').toLowerCase().includes(q))
  );

  const grid = document.getElementById('catalogo-grid');
  if (!filtrados.length) {
    grid.innerHTML = `<div class="empty-state">No hay productos que coincidan.</div>`;
    return;
  }

  grid.innerHTML = `<div class="cat-grid">${filtrados.map((p) => {
    const cant = cantidadEnCarrito(p.id);
    const agotado = p.stock <= 0;
    const oferta = tieneOferta(p);
    const pctOferta = oferta ? Math.round((1 - p.precioVenta / p.precioAnterior) * 100) : 0;
    return `
    <div class="cat-card" data-producto="${escapeHtml(p.id)}">
      <div class="cat-img-wrap">
        ${oferta ? `<span class="cat-badge-oferta">-${pctOferta}%</span>` : ''}
        ${p.imagen ? `<img src="${p.imagen}" alt="" loading="lazy" />` : `<span class="cat-img-empty">📦</span>`}
      </div>
      <div class="cat-info">
        <div class="cat-cat">${escapeHtml(p.categoria || 'Otros')}</div>
        <div class="cat-name">${escapeHtml(p.nombre)}</div>
        <div class="cat-price">
          ${oferta ? `<span class="cat-price-antes">${money(p.precioAnterior)}</span>` : ''}
          <span class="${oferta ? 'cat-price-oferta' : ''}">${money(p.precioVenta)}</span>
        </div>
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
  // El area de agregar/cantidad esta dentro de la tarjeta, pero no debe abrir
  // el detalle del producto al tocarla.
  grid.querySelectorAll('[data-frenar-click]').forEach((el) => el.addEventListener('click', (e) => e.stopPropagation()));
  grid.querySelectorAll('[data-agregar]').forEach((btn) => btn.addEventListener('click', () => cambiarCantidad(btn.dataset.agregar, 1)));
  grid.querySelectorAll('[data-sumar]').forEach((btn) => btn.addEventListener('click', () => cambiarCantidad(btn.dataset.sumar, 1)));
  grid.querySelectorAll('[data-restar]').forEach((btn) => btn.addEventListener('click', () => cambiarCantidad(btn.dataset.restar, -1)));
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
    let mensaje = `Hola! Quiero hacer este pedido:\n${lineas.join('\n')}\n\nTotal: ${money(totalCarrito())}`;
    if (codigoDescuento) mensaje += `\n\nMi codigo de descuento: ${codigoDescuento.codigo} (${codigoDescuento.porcentaje}% OFF)`;
    window.open(buildWhatsappLink(WHATSAPP_PRODUCTO, mensaje), '_blank');
  });
}

function mostrarDetalleProducto(p) {
  if (!p) return;
  const cant = cantidadEnCarrito(p.id);
  const agotado = p.stock <= 0;
  const oferta = tieneOferta(p);
  const pctOferta = oferta ? Math.round((1 - p.precioVenta / p.precioAnterior) * 100) : 0;
  showModal(`
    <div class="cat-img-wrap" style="border-radius:12px; aspect-ratio:1.3">
      ${oferta ? `<span class="cat-badge-oferta">-${pctOferta}%</span>` : ''}
      ${p.imagen ? `<img src="${p.imagen}" alt="" />` : `<span class="cat-img-empty" style="font-size:48px">📦</span>`}
    </div>
    <div class="cat-cat" style="margin-top:14px">${escapeHtml(p.categoria || 'Otros')}</div>
    <h2 style="margin:4px 0">${escapeHtml(p.nombre)}</h2>
    ${p.descripcion ? `<p class="text-dim" style="font-size:13.5px">${escapeHtml(p.descripcion)}</p>` : ''}
    <div class="cat-price" style="font-size:24px; margin-top:8px">
      ${oferta ? `<span class="cat-price-antes" style="font-size:15px">${money(p.precioAnterior)}</span>` : ''}
      <span class="${oferta ? 'cat-price-oferta' : ''}">${money(p.precioVenta)}</span>
    </div>
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
    const mensaje = `Hola! Quiero mas informacion sobre "${p.nombre}" del catalogo.`;
    window.open(buildWhatsappLink(WHATSAPP_PRODUCTO, mensaje), '_blank');
  });
  const btnAgregar = document.querySelector('[data-agregar-detalle]');
  if (btnAgregar) btnAgregar.addEventListener('click', () => { cambiarCantidad(p.id, 1); mostrarDetalleProducto(p); });
  const btnSumar = document.querySelector('[data-sumar-detalle]');
  if (btnSumar) btnSumar.addEventListener('click', () => { cambiarCantidad(p.id, 1); mostrarDetalleProducto(p); });
  const btnRestar = document.querySelector('[data-restar-detalle]');
  if (btnRestar) btnRestar.addEventListener('click', () => { cambiarCantidad(p.id, -1); mostrarDetalleProducto(p); });
}

cargar();
