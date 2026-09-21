/* ==========================================================================
   DespensaOnline - Pantalla Configuración y catálogo de productos
   ========================================================================== */

// Orden alfabético por defecto; el usuario puede cambiarlo desde el selector de orden.
function renderProductosConfig() {
    const { search, sort } = state.productosFiltro;
    const q = search.trim().toLowerCase();

    let productos = state.productos.filter(p => p.activa);
    if (q) productos = productos.filter(p => p.nombre.toLowerCase().includes(q));

    const [campo, direccion] = sort.split('-');
    const valorOrden = p => (campo === 'categoria' ? (p.categoria || '') : campo === 'unidad' ? p.unidad : p.nombre) || '';
    productos = productos.slice().sort((a, b) => {
        const cmp = valorOrden(a).localeCompare(valorOrden(b), 'es', { sensitivity: 'base' });
        return direccion === 'desc' ? -cmp : cmp;
    });

    DOM.productosList.innerHTML = productos.length > 0
        ? productos.map(p => {
            const minimo = parseFloat(p.stock_minimo) || 0;
            const metaMinimo = minimo > 0 ? ` · mín. ${formatCantidad(minimo, p.unidad)}` : '';
            return `
            <div class="catalog-row catalog-row-clickable" data-producto-edit="${p.id}" title="Editar producto">
                <span class="mono mono-sm">${escapeHtml(monogramLetter(p.nombre))}</span>
                <span class="catalog-name">${escapeHtml(p.nombre)}</span>
                <span class="catalog-meta">${escapeHtml(p.categoria || '')}${p.categoria ? ' · ' : ''}${escapeHtml(p.unidad)}${metaMinimo}</span>
                <button type="button" class="row-delete" data-producto-delete="${p.id}" title="Desactivar producto"><svg class="icon-sm"><use href="#ic-x"/></svg></button>
            </div>
        `;
        }).join('')
        : '<p class="empty-state-inline">No hay productos que coincidan con la búsqueda.</p>';

    DOM.productosList.querySelectorAll('[data-producto-edit]').forEach(row => {
        row.addEventListener('click', () => {
            const producto = getProducto(row.dataset.productoEdit);
            if (producto) openProductoEdit(producto);
        });
    });
    DOM.productosList.querySelectorAll('[data-producto-delete]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleDeleteProducto(btn.dataset.productoDelete);
        });
    });
}

// Rellena el formulario de alta con los datos del producto para editarlo en el sitio
// (mismo formulario, en "modo edición" hasta guardar o cancelar).
function openProductoEdit(producto) {
    state.editingProductoId = producto.id;
    DOM.inProductoNombre.value = producto.nombre;
    DOM.inProductoCategoria.value = producto.categoria || '';
    DOM.inProductoCategoriaNueva.value = '';
    DOM.inProductoCategoriaNueva.classList.add('hidden');
    DOM.inProductoUnidad.value = producto.unidad;
    DOM.inProductoStockMinimo.value = producto.stock_minimo || '';
    DOM.inProductoIcono.value = producto.icono || '';
    DOM.btnSubmitProducto.textContent = 'Guardar cambios';
    DOM.btnCancelEditProducto.classList.remove('hidden');
    DOM.inProductoNombre.focus();
}

function cancelarEdicionProducto() {
    state.editingProductoId = null;
    DOM.formNuevoProducto.reset();
    DOM.inProductoCategoriaNueva.classList.add('hidden');
    DOM.btnSubmitProducto.textContent = 'Añadir';
    DOM.btnCancelEditProducto.classList.add('hidden');
}

// Opción especial que permite crear un producto al vuelo desde el selector, sin pasar por Configuración.
const PRODUCTO_NUEVO_VALUE = '__nuevo__';

function buildProductoOptionsHtml(selectedId = null, { incluirNuevo = false } = {}) {
    const productos = state.productos.filter(p => p.activa).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    let html = productos.map(p => `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(p.nombre)}</option>`).join('');
    if (incluirNuevo) html += `<option value="${PRODUCTO_NUEVO_VALUE}">+ Crear producto nuevo…</option>`;
    return html;
}

function populateProductoSelectors() {
    if (DOM.inLoteProducto) {
        const actual = DOM.inLoteProducto.value;
        DOM.inLoteProducto.innerHTML = buildProductoOptionsHtml(null, { incluirNuevo: true });
        if (actual && DOM.inLoteProducto.querySelector(`option[value="${actual}"]`)) DOM.inLoteProducto.value = actual;
    }
    if (DOM.inCompraProducto) DOM.inCompraProducto.innerHTML = buildProductoOptionsHtml();
}

// Crea un producto al vuelo a partir de los campos "nuevo producto" de un formulario
// y devuelve su id, o null si faltaba el nombre o falló la creación (con su propio toast de error).
async function crearProductoDesdeCampos(nombre, categoria, unidad) {
    nombre = (nombre || '').trim();
    if (!nombre) return null;
    const res = await apiRequest('producto', 'POST', { nombre, categoria, unidad });
    if (!res || !res.success) {
        showToast(res?.error || `No se pudo crear el producto "${nombre}"`, 'error');
        return null;
    }
    populateProductoSelectors();
    populateCategoriaSelectors();
    renderProductosConfig();
    return res.id;
}

function populateRecetaSelectors() {
    const recetas = state.recetas.filter(r => r.activa).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    const options = recetas.map(r => `<option value="${r.id}">${escapeHtml(r.nombre)}</option>`).join('');
    if (DOM.inMenuEntryReceta) DOM.inMenuEntryReceta.innerHTML = options;
}

async function handleNuevoProductoSubmit(e) {
    e.preventDefault();
    const payload = {
        nombre: DOM.inProductoNombre.value,
        categoria: resolveCategoriaValue(DOM.inProductoCategoria, DOM.inProductoCategoriaNueva),
        unidad: DOM.inProductoUnidad.value,
        stock_minimo: DOM.inProductoStockMinimo.value || null,
        icono: DOM.inProductoIcono.value || ''
    };

    if (state.editingProductoId) {
        const original = getProducto(state.editingProductoId);
        if (original && original.unidad !== payload.unidad && productoEstaEnUso(original.id)) {
            const confirmado = confirm(
                `Vas a cambiar la unidad de "${original.nombre}" de "${original.unidad}" a "${payload.unidad}".\n\n` +
                'Las cantidades ya guardadas en la despensa y en las recetas que usan este producto no se convierten: ' +
                `seguirán siendo el mismo número, pero pasarán a interpretarse en "${payload.unidad}" en vez de en "${original.unidad}". ` +
                'Revísalas después de guardar.\n\n¿Continuar?'
            );
            if (!confirmado) return;
        }

        const result = await apiRequest('editar_producto', 'PATCH', { id: state.editingProductoId, ...payload });
        if (result && result.success) {
            cancelarEdicionProducto();
            renderProductosConfig();
            populateProductoSelectors();
            populateCategoriaSelectors();
            renderDespensa(); // ya recalcula la reposición automática al terminar (stock_minimo pudo cambiar)
            renderRecetas();
            showToast(result.message, 'success');
        } else {
            showToast(result?.error || 'Error al guardar', 'error');
        }
        return;
    }

    const result = await apiRequest('producto', 'POST', payload);
    if (result && result.success) {
        DOM.formNuevoProducto.reset();
        DOM.inProductoCategoriaNueva.classList.add('hidden');
        renderProductosConfig();
        populateProductoSelectors();
        populateCategoriaSelectors();
        await actualizarListaReposicion();
        renderListaCompra();
        showToast(result.message, 'success');
    } else {
        showToast(result?.error || 'Error al guardar', 'error');
    }
}

async function handleDeleteProducto(id) {
    if (!confirm('¿Desactivar este producto? No se borrará su historial en despensa/recetas.')) return;
    const result = await apiRequest('eliminar_producto', 'DELETE', { id });
    if (result && result.success) {
        if (String(state.editingProductoId) === String(id)) cancelarEdicionProducto();
        renderProductosConfig();
        populateProductoSelectors();
        populateCategoriaSelectors();
        renderDespensa(); // ya recalcula la reposición automática al terminar
        renderRecetas();
        showToast(result.message, 'success');
    }
}

/* ==========================================================================
   Patrón genérico "desplegable + escribir uno nuevo": un <select> con valores ya
   usados en algún sitio (categorías, detalles de ubicación...) más una opción
   centinela que revela un <input> de texto adyacente para escribir uno nuevo.
   ========================================================================== */
function wireSelectConNuevo(select, nuevaInput, valorNuevo) {
    const sync = () => nuevaInput.classList.toggle('hidden', select.value !== valorNuevo);
    select.addEventListener('change', sync);
    sync();
}

function resolveSelectConNuevo(select, nuevaInput, valorNuevo) {
    return select.value === valorNuevo ? nuevaInput.value.trim() : select.value;
}

/* ==========================================================================
   Categorías de producto: no son una tabla propia, son los valores ya usados
   en productos.categoria, ofrecidos como desplegable con opción de escribir
   una nueva (mismo patrón que "+ Crear producto nuevo…").
   ========================================================================== */
const CATEGORIA_NUEVA_VALUE = '__nueva_categoria__';

function buildCategoriaOptionsHtml(selectedValue = '') {
    const opciones = getCategoriasUnicas()
        .map(c => `<option value="${escapeHtml(c)}" ${c === selectedValue ? 'selected' : ''}>${escapeHtml(c)}</option>`)
        .join('');
    return `<option value="">Sin categoría</option>${opciones}<option value="${CATEGORIA_NUEVA_VALUE}">+ Nueva categoría…</option>`;
}

// Enlaza un <select> de categoría con su input de texto adyacente ("+ Nueva categoría…").
function wireCategoriaSelect(select, nuevaInput) {
    wireSelectConNuevo(select, nuevaInput, CATEGORIA_NUEVA_VALUE);
}

function resolveCategoriaValue(select, nuevaInput) {
    return resolveSelectConNuevo(select, nuevaInput, CATEGORIA_NUEVA_VALUE);
}

function populateCategoriaSelectors() {
    if (DOM.inProductoCategoria) {
        const actual = DOM.inProductoCategoria.value;
        DOM.inProductoCategoria.innerHTML = buildCategoriaOptionsHtml();
        if (Array.from(DOM.inProductoCategoria.options).some(o => o.value === actual)) DOM.inProductoCategoria.value = actual;
    }
    if (DOM.inLoteNuevoProductoCategoria) {
        DOM.inLoteNuevoProductoCategoria.innerHTML = buildCategoriaOptionsHtml();
    }
}

/* ==========================================================================
   Catálogo de ubicaciones de la despensa (Despensa/Nevera/Congelador + las que
   el usuario añada, p. ej. "Trastero"). Ver DOCUMENTACIÓN-TECNICA.md §3.
   ========================================================================== */
function renderUbicacionesConfig() {
    const ubicaciones = state.ubicaciones.filter(u => u.activa).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    DOM.ubicacionesList.innerHTML = ubicaciones.map(u => `
        <div class="catalog-row">
            <span class="mono mono-sm">${escapeHtml(monogramLetter(u.nombre))}</span>
            <span class="catalog-name">${escapeHtml(u.nombre)}</span>
            <button type="button" class="row-delete" data-ubicacion-delete="${u.id}" title="Desactivar ubicación"><svg class="icon-sm"><use href="#ic-x"/></svg></button>
        </div>
    `).join('');

    DOM.ubicacionesList.querySelectorAll('[data-ubicacion-delete]').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteUbicacion(btn.dataset.ubicacionDelete));
    });
}

function populateUbicacionSelectors() {
    const ubicaciones = state.ubicaciones.filter(u => u.activa).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    const options = ubicaciones.map(u => `<option value="${u.id}">${escapeHtml(u.nombre)}</option>`).join('');
    if (DOM.inLoteUbicacion) DOM.inLoteUbicacion.innerHTML = options;
    renderDespensaUbicacionChips(ubicaciones);
}

// Chips de ubicación del filtro de Despensa (reemplazan al desplegable de la versión anterior).
function renderDespensaUbicacionChips(ubicaciones) {
    if (!DOM.despensaChipsUbicacion) return;
    const existeFiltroActual = ubicaciones.some(u => String(u.id) === String(state.despensaFiltro.ubicacion));
    if (!existeFiltroActual) state.despensaFiltro.ubicacion = 'todas';

    const chipsHtml = [`<button type="button" class="chip" data-value="todas">Todas</button>`]
        .concat(ubicaciones.map(u => `<button type="button" class="chip" data-value="${u.id}">${escapeHtml(u.nombre)}</button>`));
    DOM.despensaChipsUbicacion.innerHTML = chipsHtml.join('');

    const activo = DOM.despensaChipsUbicacion.querySelector(`[data-value="${state.despensaFiltro.ubicacion}"]`);
    if (activo) activo.classList.add('active');
}

async function handleNuevaUbicacionSubmit(e) {
    e.preventDefault();
    const payload = {
        nombre: DOM.inUbicacionNombre.value,
        icono: DOM.inUbicacionIcono.value || ''
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
