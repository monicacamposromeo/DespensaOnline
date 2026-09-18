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
        })
        .sort((a, b) => (getProducto(a.productoId)?.nombre || '').localeCompare(getProducto(b.productoId)?.nombre || ''));

    DOM.despensaEmpty.classList.toggle('hidden', lotesActivos.length > 0);

    if (lotesActivos.length > 0 && lotesFiltrados.length === 0) {
        DOM.despensaList.innerHTML = '<p class="empty-state-inline">No hay productos que coincidan con el filtro.</p>';
    } else {
        DOM.despensaList.innerHTML = lotesFiltrados.map(loteRowHtml).join('');
    }

    DOM.despensaList.querySelectorAll('[data-lote-id]').forEach(card => {
        card.addEventListener('click', () => {
            const lote = state.despensa.find(l => l.id == card.dataset.loteId);
            if (lote) openLoteModal(lote);
        });
    });
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

function caducidadStatusHtml(lote) {
    if (!lote.fecha_caducidad) {
        return '<span class="status-pill neutral">Sin caducidad</span>';
    }
    const info = getLotesPorCaducar().find(a => a.lote.id === lote.id);
    if (info?.estado === 'caducado') {
        return `<span class="status-pill danger">Caducó · ${formatDate(lote.fecha_caducidad)}</span>`;
    }
    if (info?.estado === 'proximo') {
        return `<span class="status-pill warn">Caduca · ${formatDate(lote.fecha_caducidad)}</span>`;
    }
    return `<span class="status-pill neutral">${formatDate(lote.fecha_caducidad)}</span>`;
}

function loteRowHtml(lote) {
    const producto = getProducto(lote.productoId);
    if (!producto) return '';

    const ubicacion = getUbicacion(lote.ubicacionId);
    const ubicacionLabel = ubicacion ? escapeHtml(ubicacion.nombre) : '—';
    const detalle = lote.detalle_ubicacion ? ` · ${escapeHtml(lote.detalle_ubicacion)}` : '';

    return `
        <button type="button" class="item-row" data-lote-id="${lote.id}">
            <span class="mono">${escapeHtml(monogramLetter(producto.nombre))}</span>
            <span class="item-main">
                <span class="item-name">${escapeHtml(producto.nombre)}</span>
                <span class="item-meta">${ubicacionLabel}${detalle} · ${formatCantidad(lote.cantidad, producto.unidad)}</span>
            </span>
            ${caducidadStatusHtml(lote)}
        </button>
    `;
}

function openLoteModal(lote = null) {
    if (state.productos.filter(p => p.activa).length === 0) {
        showToast('Primero debes crear al menos un producto en Configuración.', 'error');
        return;
    }
    if (state.ubicaciones.filter(u => u.activa).length === 0) {
        showToast('Primero debes crear al menos una ubicación en Configuración.', 'error');
        return;
    }
    state.editingLoteId = lote ? lote.id : null;
    DOM.modalLoteTitle.textContent = lote ? 'Editar producto en despensa' : 'Añadir producto a la despensa';
    DOM.inLoteId.value = lote ? lote.id : '';
    DOM.inLoteProducto.value = lote ? lote.productoId : (state.productos.find(p => p.activa)?.id || '');
    DOM.inLoteCantidad.value = lote ? lote.cantidad : '';
    DOM.inLoteUbicacion.value = lote ? lote.ubicacionId : (state.ubicaciones.find(u => u.activa)?.id || '');
    DOM.inLoteDetalleUbicacion.value = lote ? (lote.detalle_ubicacion || '') : '';
    DOM.inLoteFechaEntrada.value = lote ? lote.fecha_entrada : todayISO();
    DOM.inLoteFechaCaducidad.value = lote ? (lote.fecha_caducidad || '') : '';
    DOM.btnDeleteLote.classList.toggle('hidden', !lote);
    DOM.modalLote.classList.remove('hidden');
}

function closeLoteModal() {
    DOM.modalLote.classList.add('hidden');
    state.editingLoteId = null;
}

async function handleLoteFormSubmit(e) {
    e.preventDefault();
    const payload = {
        productoId: DOM.inLoteProducto.value,
        cantidad: DOM.inLoteCantidad.value,
        ubicacionId: DOM.inLoteUbicacion.value,
        detalle_ubicacion: DOM.inLoteDetalleUbicacion.value || null,
        fecha_entrada: DOM.inLoteFechaEntrada.value || todayISO(),
        fecha_caducidad: DOM.inLoteFechaCaducidad.value || null
    };

    const result = state.editingLoteId
        ? await apiRequest('editar_despensa_lote', 'PATCH', { id: state.editingLoteId, ...payload })
        : await apiRequest('despensa_lote', 'POST', payload);

    if (result && result.success) {
        showToast(result.message, 'success');
        closeLoteModal();
        renderDespensa();
        renderListaCompra();
    } else {
        showToast(result?.error || 'Error al guardar', 'error');
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
