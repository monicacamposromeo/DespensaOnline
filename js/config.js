/* ==========================================================================
   DespensaOnline - Pantalla Configuración y catálogo de productos
   ========================================================================== */

function renderProductosConfig() {
    const productos = state.productos.filter(p => p.activa).sort((a, b) => a.nombre.localeCompare(b.nombre));
    DOM.productosList.innerHTML = productos.map(p => `
        <div class="producto-row">
            <span class="producto-icono">${escapeHtml(p.icono || '🍽️')}</span>
            <span class="producto-nombre">${escapeHtml(p.nombre)}</span>
            <span class="producto-categoria">${escapeHtml(p.categoria || '')}</span>
            <span class="producto-unidad">${escapeHtml(p.unidad)}</span>
            <button type="button" class="btn-icon-only producto-delete" data-producto-delete="${p.id}" title="Desactivar producto">🗑️</button>
        </div>
    `).join('');

    DOM.productosList.querySelectorAll('[data-producto-delete]').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteProducto(btn.dataset.productoDelete));
    });
}

function populateProductoSelectors() {
    const productos = state.productos.filter(p => p.activa).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const options = productos.map(p => `<option value="${p.id}">${escapeHtml(p.icono || '')} ${escapeHtml(p.nombre)}</option>`).join('');
    if (DOM.inLoteProducto) DOM.inLoteProducto.innerHTML = options;
    if (DOM.inCompraProducto) DOM.inCompraProducto.innerHTML = options;
}

function populateRecetaSelectors() {
    const recetas = state.recetas.filter(r => r.activa).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const options = recetas.map(r => `<option value="${r.id}">${escapeHtml(r.nombre)}</option>`).join('');
    if (DOM.inMenuEntryReceta) DOM.inMenuEntryReceta.innerHTML = options;
}

async function handleNuevoProductoSubmit(e) {
    e.preventDefault();
    const payload = {
        nombre: DOM.inProductoNombre.value,
        categoria: DOM.inProductoCategoria.value,
        unidad: DOM.inProductoUnidad.value,
        icono: DOM.inProductoIcono.value || '🍽️'
    };
    const result = await apiRequest('producto', 'POST', payload);
    if (result && result.success) {
        DOM.formNuevoProducto.reset();
        renderProductosConfig();
        populateProductoSelectors();
        showToast(result.message, 'success');
    } else {
        showToast(result?.error || 'Error al guardar', 'error');
    }
}

async function handleDeleteProducto(id) {
    if (!confirm('¿Desactivar este producto? No se borrará su historial en despensa/recetas.')) return;
    const result = await apiRequest('eliminar_producto', 'DELETE', { id });
    if (result && result.success) {
        renderProductosConfig();
        populateProductoSelectors();
        renderDespensa();
        renderRecetas();
        showToast(result.message, 'success');
    }
}

/* ==========================================================================
   Catálogo de ubicaciones de la despensa (Despensa/Nevera/Congelador + las que
   el usuario añada, p. ej. "Trastero"). Ver DOCUMENTACIÓN-TECNICA.md §3.
   ========================================================================== */
function renderUbicacionesConfig() {
    const ubicaciones = state.ubicaciones.filter(u => u.activa).sort((a, b) => a.nombre.localeCompare(b.nombre));
    DOM.ubicacionesList.innerHTML = ubicaciones.map(u => `
        <div class="producto-row">
            <span class="producto-icono">${escapeHtml(u.icono || '📍')}</span>
            <span class="producto-nombre">${escapeHtml(u.nombre)}</span>
            <button type="button" class="btn-icon-only ubicacion-delete" data-ubicacion-delete="${u.id}" title="Desactivar ubicación">🗑️</button>
        </div>
    `).join('');

    DOM.ubicacionesList.querySelectorAll('[data-ubicacion-delete]').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteUbicacion(btn.dataset.ubicacionDelete));
    });
}

function populateUbicacionSelectors() {
    const ubicaciones = state.ubicaciones.filter(u => u.activa).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const options = ubicaciones.map(u => `<option value="${u.id}">${escapeHtml(u.icono || '')} ${escapeHtml(u.nombre)}</option>`).join('');
    if (DOM.inLoteUbicacion) DOM.inLoteUbicacion.innerHTML = options;

    if (DOM.despensaFilterUbicacion) {
        const currentValue = DOM.despensaFilterUbicacion.value || 'todas';
        DOM.despensaFilterUbicacion.innerHTML = `<option value="todas">Todas las ubicaciones</option>${options}`;
        DOM.despensaFilterUbicacion.value = currentValue;
    }
}

async function handleNuevaUbicacionSubmit(e) {
    e.preventDefault();
    const payload = {
        nombre: DOM.inUbicacionNombre.value,
        icono: DOM.inUbicacionIcono.value || '📍'
    };
    const result = await apiRequest('ubicacion', 'POST', payload);
    if (result && result.success) {
        DOM.formNuevaUbicacion.reset();
        renderUbicacionesConfig();
        populateUbicacionSelectors();
        showToast(result.message, 'success');
    } else {
        showToast(result?.error || 'Error al guardar', 'error');
    }
}

async function handleDeleteUbicacion(id) {
    if (!confirm('¿Desactivar esta ubicación? Los lotes que ya la usan la conservarán en su historial.')) return;
    const result = await apiRequest('eliminar_ubicacion', 'DELETE', { id });
    if (result && result.success) {
        renderUbicacionesConfig();
        populateUbicacionSelectors();
        renderDespensa();
        showToast(result.message, 'success');
    }
}
