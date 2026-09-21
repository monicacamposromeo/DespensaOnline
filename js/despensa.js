/* ==========================================================================
   DespensaOnline - Pantalla Despensa
   ========================================================================== */

function renderDespensa() {
    renderAlertasCaducidad();

    const search = state.despensaFiltro.search.trim().toLowerCase();
    const ubicacionId = state.despensaFiltro.ubicacion;

    const lotesActivos = state.despensa.filter(l => l.activa);
    const lotesFiltrados = lotesActivos
        .filter(l => ubicacionId === 'todas' || String(l.ubicacionId) === String(ubicacionId))
        .filter(l => {
            if (!search) return true;
            const producto = getProducto(l.productoId);
            return producto && producto.nombre.toLowerCase().includes(search);
        });

    DOM.despensaEmpty.classList.toggle('hidden', lotesActivos.length > 0);

    if (lotesActivos.length > 0 && lotesFiltrados.length === 0) {
        DOM.despensaList.innerHTML = '<p class="empty-state-inline">No hay productos que coincidan con el filtro.</p>';
    } else {
        // Varios lotes del mismo producto+ubicación+detalle se fusionan en una sola fila
        // (misma cantidad total, caducidad más próxima como aviso) para no repetir el
        // producto en el listado; los lotes individuales siguen intactos por debajo.
        const grupos = agruparLotesPorProductoYSitio(lotesFiltrados);
        DOM.despensaList.innerHTML = ubicacionId === 'todas'
            ? agruparPorUbicacionHtml(grupos)
            : agruparPorDetalleHtml(grupos);
    }

    DOM.despensaList.querySelectorAll('[data-lote-ids]').forEach(row => {
        row.addEventListener('click', () => {
            const ids = row.dataset.loteIds.split(',');
            const lotes = ids.map(id => state.despensa.find(l => String(l.id) === id)).filter(Boolean);
            if (lotes.length === 1) openLoteModal(lotes[0]);
            else if (lotes.length > 1) openLoteGrupoModal(lotes);
        });
    });

    renderAlertasBadge();

    // La reposición automática (stock mínimo por producto) depende del stock de la
    // despensa, así que se recalcula cada vez que esta cambia; no bloquea el render
    // de la propia despensa, solo actualiza la Lista de la Compra al terminar.
    actualizarListaReposicion().then(renderListaCompra);
}

// Junta los lotes que son, a efectos de visualización, "el mismo sitio": mismo producto,
// misma ubicación y mismo detalle de ubicación. La caducidad no entra en la clave: si hay
// varias fechas se muestra la más próxima (loteReferencia) y un aviso "+N lote(s)".
function agruparLotesPorProductoYSitio(lotes) {
    const mapa = new Map();
    lotes.forEach(l => {
        const key = `${l.productoId}|${l.ubicacionId}|${(l.detalle_ubicacion || '').trim().toLowerCase()}`;
        if (!mapa.has(key)) mapa.set(key, []);
        mapa.get(key).push(l);
    });

    return [...mapa.values()].map(grupoLotes => {
        // Ordenados por caducidad ascendente (sin fecha al final) para que el primero
        // sea siempre el más urgente de mostrar como referencia del grupo.
        const ordenados = grupoLotes.slice().sort((a, b) =>
            (a.fecha_caducidad || '9999-99-99').localeCompare(b.fecha_caducidad || '9999-99-99')
        );
        const loteReferencia = ordenados[0];
        return {
            productoId: loteReferencia.productoId,
            ubicacionId: loteReferencia.ubicacionId,
            detalle_ubicacion: loteReferencia.detalle_ubicacion,
            lotes: ordenados,
            loteReferencia,
            cantidadTotal: grupoLotes.reduce((sum, l) => sum + (parseFloat(l.cantidad) || 0), 0)
        };
    });
}

// Sub-agrupa por "detalle de ubicación" (el sitio exacto, p. ej. "Cajón 2") dentro de
// lo que se le pase (toda la despensa o ya filtrada a una ubicación): un <h3> por
// detalle, en orden alfabético y con "Sin sitio concreto" al final, para clasificar el
// listado por sitio igual que ya se hace por ubicación.
function agruparPorDetalleHtml(grupos) {
    const porDetalle = new Map();
    grupos.forEach(g => {
        const key = (g.detalle_ubicacion || '').trim().toLowerCase();
        if (!porDetalle.has(key)) porDetalle.set(key, []);
        porDetalle.get(key).push(g);
    });

    const claves = [...porDetalle.keys()].sort((a, b) => {
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b, 'es', { sensitivity: 'base' });
    });

    return claves.map(key => {
        const gruposDetalle = porDetalle.get(key).slice()
            .sort((a, b) => (getProducto(a.productoId)?.nombre || '').localeCompare(getProducto(b.productoId)?.nombre || ''));
        const titulo = key ? gruposDetalle[0].detalle_ubicacion : 'Sin sitio concreto';
        return `<h3 class="section-subtitle">${escapeHtml(titulo)}</h3>` + gruposDetalle.map(grupoLoteRowHtml).join('');
    }).join('');
}

// Une un encabezado (nombre de la ubicación) con sus filas ya clasificadas por detalle,
// como hermanos directos dentro de #despensa-list (necesario para que la rejilla de
// 2 columnas en escritorio siga funcionando: ver .section-title en style.css).
function agruparPorUbicacionHtml(grupos) {
    const porUbicacion = new Map();
    grupos.forEach(g => {
        const key = String(g.ubicacionId);
        if (!porUbicacion.has(key)) porUbicacion.set(key, []);
        porUbicacion.get(key).push(g);
    });

    const ubicacionesConLotes = state.ubicaciones
        .filter(u => porUbicacion.has(String(u.id)))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

    return ubicacionesConLotes
        .map(u => `<h2 class="section-title">${escapeHtml(u.nombre)}</h2>` + agruparPorDetalleHtml(porUbicacion.get(String(u.id))))
        .join('');
}

function renderAlertasCaducidad() {
    const alertas = getLotesPorCaducar();
    if (alertas.length === 0) {
        DOM.despensaAlertas.innerHTML = '';
        return;
    }
    const caducados = alertas.filter(a => a.estado === 'caducado');
    const proximos = alertas.filter(a => a.estado === 'proximo');

    let html = '';
    if (caducados.length > 0) {
        const nombres = caducados.map(a => getProducto(a.lote.productoId)?.nombre || '?').join(', ');
        html += `<div class="alert-strip alert-danger">Caducado(s): ${escapeHtml(nombres)}</div>`;
    }
    if (proximos.length > 0) {
        const nombres = proximos.map(a => getProducto(a.lote.productoId)?.nombre || '?').join(', ');
        html += `<div class="alert-strip alert-warn">A punto de caducar: ${escapeHtml(nombres)}</div>`;
    }
    DOM.despensaAlertas.innerHTML = html;
}

function caducidadStatusHtml(lote, otrosLotes = 0) {
    const sufijo = otrosLotes > 0 ? ` (+${otrosLotes} lote${otrosLotes > 1 ? 's' : ''})` : '';
    if (!lote.fecha_caducidad) {
        return `<span class="status-pill neutral">Sin caducidad${sufijo}</span>`;
    }
    const info = getLotesPorCaducar().find(a => a.lote.id === lote.id);
    if (info?.estado === 'caducado') {
        return `<span class="status-pill danger">Caducó · ${formatDate(lote.fecha_caducidad)}${sufijo}</span>`;
    }
    if (info?.estado === 'proximo') {
        return `<span class="status-pill warn">Caduca · ${formatDate(lote.fecha_caducidad)}${sufijo}</span>`;
    }
    return `<span class="status-pill neutral">${formatDate(lote.fecha_caducidad)}${sufijo}</span>`;
}

// Fila de despensa: representa un grupo (uno o varios lotes fusionados visualmente por
// ser el mismo producto+ubicación+detalle). data-lote-ids lleva todos los ids del grupo,
// separados por coma, para que el click sepa si abrir el lote directo o el selector.
function grupoLoteRowHtml(grupo) {
    const producto = getProducto(grupo.productoId);
    if (!producto) return '';

    const ubicacion = getUbicacion(grupo.ubicacionId);
    const ubicacionLabel = ubicacion ? escapeHtml(ubicacion.nombre) : '—';
    const detalle = grupo.detalle_ubicacion ? ` · ${escapeHtml(grupo.detalle_ubicacion)}` : '';
    const loteIds = grupo.lotes.map(l => l.id).join(',');

    return `
        <button type="button" class="item-row" data-lote-ids="${loteIds}">
            <span class="mono mono-qty" title="${escapeHtml(formatCantidad(grupo.cantidadTotal, producto.unidad))}">${escapeHtml(formatCantidadCompacta(grupo.cantidadTotal, producto.unidad))}</span>
            <span class="item-main">
                <span class="item-name">${escapeHtml(producto.nombre)}</span>
                <span class="item-meta">${ubicacionLabel}${detalle}</span>
            </span>
            ${caducidadStatusHtml(grupo.loteReferencia, grupo.lotes.length - 1)}
        </button>
    `;
}

// Muestra/oculta los campos de alta rápida de producto según lo elegido en el selector.
function updateLoteNuevoProductoVisibility() {
    DOM.loteNuevoProductoFields.classList.toggle('hidden', DOM.inLoteProducto.value !== PRODUCTO_NUEVO_VALUE);
}

/* ==========================================================================
   Detalle de ubicación: desplegable que depende de la ubicación elegida (solo
   ofrece los detalles ya usados dentro de esa ubicación) + opción de escribir
   uno nuevo, mismo patrón genérico que categorías (js/config.js).
   ========================================================================== */
const DETALLE_NUEVO_VALUE = '__nuevo_detalle__';

function buildDetalleOptionsHtml(ubicacionId, selectedValue = '') {
    const opciones = getDetallesUnicosPorUbicacion(ubicacionId)
        .map(d => `<option value="${escapeHtml(d)}" ${d === selectedValue ? 'selected' : ''}>${escapeHtml(d)}</option>`)
        .join('');
    return `<option value="">Sin detalle específico</option>${opciones}<option value="${DETALLE_NUEVO_VALUE}">+ Nuevo detalle…</option>`;
}

// Se llama al abrir el modal y cada vez que cambia la ubicación elegida (los detalles
// de una ubicación no tienen sentido en otra: "Cajón 3" es del Congelador, no de la Nevera).
function populateDetalleUbicacionSelector(ubicacionId, selectedValue = '') {
    DOM.inLoteDetalleUbicacion.innerHTML = buildDetalleOptionsHtml(ubicacionId, selectedValue);
    DOM.inLoteDetalleUbicacionNueva.value = '';
    DOM.inLoteDetalleUbicacionNueva.classList.add('hidden');
}

// prefill (opcional): { productoId, ubicacionId, detalle_ubicacion } para preseleccionar
// al añadir "otro lote más" del mismo producto+sitio desde el modal de grupo.
function openLoteModal(lote = null, prefill = null) {
    if (state.ubicaciones.filter(u => u.activa).length === 0) {
        showToast('Primero debes crear al menos una ubicación en Configuración.', 'error');
        return;
    }
    state.editingLoteId = lote ? lote.id : null;
    DOM.modalLoteTitle.textContent = lote ? 'Editar producto en despensa' : 'Añadir producto a la despensa';
    DOM.inLoteId.value = lote ? lote.id : '';
    DOM.inLoteProducto.value = lote ? lote.productoId : (prefill?.productoId ?? (state.productos.find(p => p.activa)?.id ?? PRODUCTO_NUEVO_VALUE));
    DOM.inLoteNuevoProductoNombre.value = '';
    DOM.inLoteNuevoProductoCategoria.value = '';
    DOM.inLoteNuevoProductoCategoriaNueva.value = '';
    DOM.inLoteNuevoProductoCategoriaNueva.classList.add('hidden');
    DOM.inLoteNuevoProductoUnidad.value = 'ud';
    updateLoteNuevoProductoVisibility();
    DOM.inLoteCantidad.value = lote ? lote.cantidad : '';
    DOM.inLotePaquetes.value = '1';
    DOM.lotePaquetesField.classList.toggle('hidden', !!lote); // solo tiene sentido al añadir, no al editar un lote ya existente
    DOM.inLoteUbicacion.value = lote ? lote.ubicacionId : (prefill?.ubicacionId ?? (state.ubicaciones.find(u => u.activa)?.id || ''));
    populateDetalleUbicacionSelector(DOM.inLoteUbicacion.value, lote ? (lote.detalle_ubicacion || '') : (prefill?.detalle_ubicacion || ''));
    DOM.inLoteFechaEntrada.value = lote ? lote.fecha_entrada : todayISO();
    DOM.inLoteFechaCaducidad.value = lote ? (lote.fecha_caducidad || '') : '';
    DOM.btnDeleteLote.classList.toggle('hidden', !lote);
    DOM.modalLote.classList.remove('hidden');
}

function closeLoteModal() {
    DOM.modalLote.classList.add('hidden');
    state.editingLoteId = null;
}

/* ==========================================================================
   Modal de grupo: cuando varios lotes se fusionan en una fila (mismo producto,
   ubicación y detalle), aquí se elige cuál de ellos editar/eliminar, o se añade
   uno nuevo más al mismo sitio.
   ========================================================================== */
function loteGrupoItemHtml(lote, producto) {
    return `
        <button type="button" class="item-row" data-lote-id="${lote.id}">
            <span class="mono mono-qty" title="${escapeHtml(formatCantidad(lote.cantidad, producto.unidad))}">${escapeHtml(formatCantidadCompacta(lote.cantidad, producto.unidad))}</span>
            <span class="item-main">
                <span class="item-name">Entrada: ${escapeHtml(formatDate(lote.fecha_entrada) || '—')}</span>
                <span class="item-meta">Tocar para editar o eliminar este lote</span>
            </span>
            ${caducidadStatusHtml(lote)}
        </button>
    `;
}

function openLoteGrupoModal(lotes) {
    const producto = getProducto(lotes[0].productoId);
    if (!producto) return;

    state.editingLoteGrupoPrefill = {
        productoId: lotes[0].productoId,
        ubicacionId: lotes[0].ubicacionId,
        detalle_ubicacion: lotes[0].detalle_ubicacion
    };
    DOM.modalLoteGrupoTitle.textContent = producto.nombre;

    const ordenados = lotes.slice().sort((a, b) => (a.fecha_caducidad || '9999-99-99').localeCompare(b.fecha_caducidad || '9999-99-99'));
    DOM.loteGrupoList.innerHTML = ordenados.map(l => loteGrupoItemHtml(l, producto)).join('');
    DOM.loteGrupoList.querySelectorAll('[data-lote-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const lote = state.despensa.find(l => l.id == btn.dataset.loteId);
            closeLoteGrupoModal();
            if (lote) openLoteModal(lote);
        });
    });

    DOM.modalLoteGrupo.classList.remove('hidden');
}

function closeLoteGrupoModal() {
    DOM.modalLoteGrupo.classList.add('hidden');
}

function handleAddLoteAlGrupo() {
    const prefill = state.editingLoteGrupoPrefill;
    closeLoteGrupoModal();
    openLoteModal(null, prefill);
}

async function handleLoteFormSubmit(e) {
    e.preventDefault();

    let productoId = DOM.inLoteProducto.value;
    if (productoId === PRODUCTO_NUEVO_VALUE) {
        productoId = await crearProductoDesdeCampos(
            DOM.inLoteNuevoProductoNombre.value,
            resolveCategoriaValue(DOM.inLoteNuevoProductoCategoria, DOM.inLoteNuevoProductoCategoriaNueva),
            DOM.inLoteNuevoProductoUnidad.value
        );
        if (!productoId) {
            if (!DOM.inLoteNuevoProductoNombre.value.trim()) showToast('Escribe el nombre del producto nuevo.', 'error');
            return;
        }
    }

    const payload = {
        productoId,
        cantidad: DOM.inLoteCantidad.value,
        ubicacionId: DOM.inLoteUbicacion.value,
        detalle_ubicacion: resolveSelectConNuevo(DOM.inLoteDetalleUbicacion, DOM.inLoteDetalleUbicacionNueva, DETALLE_NUEVO_VALUE) || null,
        fecha_entrada: DOM.inLoteFechaEntrada.value || todayISO(),
        fecha_caducidad: DOM.inLoteFechaCaducidad.value || null
    };

    if (state.editingLoteId) {
        const result = await apiRequest('editar_despensa_lote', 'PATCH', { id: state.editingLoteId, ...payload });
        if (result && result.success) {
            showToast(result.message, 'success');
            closeLoteModal();
            renderDespensa();
            renderListaCompra();
        } else {
            showToast(result?.error || 'Error al guardar', 'error');
        }
        return;
    }

    // Cada paquete es un lote independiente (mismo producto/sitio/cantidad, pero editable
    // y "gastable" por separado más adelante); el listado los junta visualmente en una fila.
    const paquetes = Math.max(1, parseInt(DOM.inLotePaquetes.value, 10) || 1);
    let resultado = null;
    for (let i = 0; i < paquetes; i++) {
        resultado = await apiRequest('despensa_lote', 'POST', payload);
        if (!resultado || !resultado.success) break;
    }

    if (resultado && resultado.success) {
        showToast(paquetes > 1 ? `${paquetes} paquetes añadidos a la despensa` : resultado.message, 'success');
        closeLoteModal();
        renderDespensa();
        renderListaCompra();
    } else {
        showToast(resultado?.error || 'Error al guardar', 'error');
    }
}

async function handleDeleteLote() {
    if (!state.editingLoteId) return;
    if (!confirm('¿Eliminar este producto de la despensa?')) return;
    const result = await apiRequest('eliminar_despensa_lote', 'DELETE', { id: state.editingLoteId });
    if (result && result.success) {
        showToast(result.message, 'success');
        closeLoteModal();
        renderDespensa();
        renderListaCompra();
    }
}
