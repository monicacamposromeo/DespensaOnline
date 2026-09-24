/* ==========================================================================
   DespensaOnline - Lista de la Compra (generación y render)
   Ver DOCUMENTACIÓN-TECNICA.md §5 para la explicación del algoritmo.
   ========================================================================== */

// Pregunta si generar solo con el menú de la semana que se está viendo o con el de todas
// las semanas planificadas, y lanza la generación correspondiente.
function handleGenerarListaClick() {
    const todas = confirm(
        '¿Generar la lista con el menú de TODAS las semanas planificadas?\n\n' +
        'Aceptar: todas las semanas.\nCancelar: solo la semana que estás viendo ahora.'
    );
    return todas ? generarListaCompraTodas() : generarListaCompraSemana();
}

async function generarListaCompraSemana() {
    const dias = getWeekDates(state.selectedWeekStart);
    await generarListaCompra(dias[0], dias[6]);
    renderListaCompra();
    showToast('Lista de la compra generada a partir del menú de esta semana', 'success');
}

// Sin fechaFin: no hay límite superior, así que cubre todo el menú planificado a futuro
// (fechaInicio se sigue anclando a hoy más abajo, igual que en generarListaCompraSemana).
async function generarListaCompraTodas() {
    await generarListaCompra();
    renderListaCompra();
    showToast('Lista de la compra generada a partir de todo el menú planificado', 'success');
}

// fechaInicio nunca cuenta días ya pasados: si se pide generar una semana que ya empezó
// (p. ej. hoy es miércoles y la semana visible arrancaba el lunes), lo comido/planificado
// en días anteriores a hoy no debe generar necesidad de compra retroactiva. Sin fechaFin,
// no se limita por arriba (usado por generarListaCompraTodas()).
async function generarListaCompra(fechaInicio, fechaFin) {
    const hoy = todayISO();
    if (!fechaInicio || fechaInicio < hoy) fechaInicio = hoy;

    const necesidades = {}; // productoId -> cantidad total necesaria

    state.menuSemanal
        .filter(e => e.activa && e.fecha >= fechaInicio && (!fechaFin || e.fecha <= fechaFin))
        .forEach(entrada => {
            const receta = getReceta(entrada.recetaId);
            if (!receta) return;
            const factor = (parseFloat(entrada.comensales) || 1) / (parseFloat(receta.comensales_base) || 1);
            getIngredientesReceta(receta.id).forEach(ing => {
                const cantidad = (parseFloat(ing.cantidad) || 0) * factor;
                necesidades[ing.productoId] = (necesidades[ing.productoId] || 0) + cantidad;
            });
        });

    // Incluye también los productos del menú que ya tenían una fila pendiente en la lista,
    // por si ahora ya no hacen falta (para poder eliminarlos) o hacen falta menos/más.
    const productoIdsRelevantes = new Set([
        ...Object.keys(necesidades),
        ...state.listaCompra.filter(li => li.origen === 'menu' && !li.comprado).map(li => String(li.productoId))
    ]);

    for (const productoId of productoIdsRelevantes) {
        const cantidadNecesaria = necesidades[productoId] || 0;
        const disponible = getStockDisponible(productoId);
        const aComprar = round2(Math.max(0, cantidadNecesaria - disponible));
        const existente = state.listaCompra.find(li => li.origen === 'menu' && !li.comprado && String(li.productoId) === String(productoId));

        if (aComprar > 0) {
            if (existente) {
                await apiRequest('editar_lista_compra_item', 'PATCH', { id: existente.id, cantidad: aComprar });
            } else {
                await apiRequest('lista_compra_item', 'POST', { productoId, cantidad: aComprar, origen: 'menu' });
            }
        } else if (existente) {
            await apiRequest('eliminar_lista_compra_item', 'DELETE', { id: existente.id });
        }
    }
}

// Reposición automática: productos con productos.stock_minimo configurado cuyo stock
// actual (getStockDisponible()) ha caído por debajo. Independiente del menú semanal —
// se recalcula cada vez que cambia la despensa o el catálogo de productos (ver los
// puntos donde se llama: renderDespensa(), altas/ediciones de producto en js/config.js).
// Mismo patrón de upsert por Set que generarListaCompra(), con origen='minimo'.
async function actualizarListaReposicion() {
    const productoIdsRelevantes = new Set([
        ...state.productos.filter(p => p.activa && parseFloat(p.stock_minimo) > 0).map(p => String(p.id)),
        ...state.listaCompra.filter(li => li.origen === 'minimo' && !li.comprado).map(li => String(li.productoId))
    ]);

    for (const productoId of productoIdsRelevantes) {
        const producto = getProducto(productoId);
        const minimo = producto ? (parseFloat(producto.stock_minimo) || 0) : 0;
        const disponible = getStockDisponible(productoId);
        const faltante = round2(Math.max(0, minimo - disponible));
        const existente = state.listaCompra.find(li => li.origen === 'minimo' && !li.comprado && String(li.productoId) === String(productoId));

        if (faltante > 0) {
            if (existente) {
                if (existente.cantidad !== faltante) await apiRequest('editar_lista_compra_item', 'PATCH', { id: existente.id, cantidad: faltante });
            } else {
                await apiRequest('lista_compra_item', 'POST', { productoId, cantidad: faltante, origen: 'minimo' });
            }
        } else if (existente) {
            await apiRequest('eliminar_lista_compra_item', 'DELETE', { id: existente.id });
        }
    }
}

// Comprados al final (como antes) y, dentro de cada grupo, alfabético por nombre de
// producto — para que la clasificación por categoría de abajo tenga un orden estable.
function compararItemsCompra(a, b) {
    if (a.comprado !== b.comprado) return a.comprado ? 1 : -1;
    const nombreA = getProducto(a.productoId)?.nombre || '';
    const nombreB = getProducto(b.productoId)?.nombre || '';
    return nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base' });
}

// Sub-agrupa una sección de la lista de la compra por categoría del producto
// (productos.categoria), mismo patrón de clasificación que la Despensa
// (agruparPorDetalleHtml(), js/despensa.js): un <h3 class="section-subtitle"> por
// categoría, en orden alfabético y "Sin categoría" al final.
function agruparCompraPorCategoriaHtml(items) {
    const porCategoria = new Map();
    items.forEach(item => {
        const key = (getProducto(item.productoId)?.categoria || '').trim().toLowerCase();
        if (!porCategoria.has(key)) porCategoria.set(key, []);
        porCategoria.get(key).push(item);
    });

    const claves = [...porCategoria.keys()].sort((a, b) => {
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b, 'es', { sensitivity: 'base' });
    });

    return claves.map(key => {
        const itemsCategoria = porCategoria.get(key);
        const titulo = key ? getProducto(itemsCategoria[0].productoId).categoria : 'Sin categoría';
        return `<h3 class="section-subtitle">${escapeHtml(titulo)}</h3>` + itemsCategoria.map(compraItemHtml).join('');
    }).join('');
}

function renderListaCompra() {
    const menuItems = state.listaCompra.filter(li => li.origen === 'menu').sort(compararItemsCompra);
    const minimoItems = state.listaCompra.filter(li => li.origen === 'minimo').sort(compararItemsCompra);
    const manualItems = state.listaCompra.filter(li => li.origen === 'manual').sort(compararItemsCompra);

    DOM.compraEmpty.classList.toggle('hidden', state.listaCompra.length > 0);
    DOM.compraListMenu.innerHTML = menuItems.length > 0
        ? agruparCompraPorCategoriaHtml(menuItems)
        : '<p class="empty-state-inline">Genera la lista desde el menú semanal.</p>';
    DOM.compraListMinimo.innerHTML = minimoItems.length > 0
        ? agruparCompraPorCategoriaHtml(minimoItems)
        : '<p class="empty-state-inline">Ningún producto con stock mínimo está por debajo de lo configurado.</p>';
    DOM.compraListManual.innerHTML = manualItems.length > 0
        ? agruparCompraPorCategoriaHtml(manualItems)
        : '<p class="empty-state-inline">Sin productos añadidos a mano.</p>';

    [DOM.compraListMenu, DOM.compraListMinimo, DOM.compraListManual].forEach(container => {
        container.querySelectorAll('[data-compra-checkbox]').forEach(cb => {
            cb.addEventListener('change', () => toggleCompradoCompra(cb.dataset.compraCheckbox, cb.checked));
        });
        container.querySelectorAll('[data-compra-delete]').forEach(btn => {
            btn.addEventListener('click', () => deleteCompraItem(btn.dataset.compraDelete));
        });
        container.querySelectorAll('[data-compra-info]').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = state.listaCompra.find(li => String(li.id) === btn.dataset.compraInfo);
                if (item) openCompraInfoModal(item);
            });
        });
    });
}

// Para las filas de "Reposición automática" (origen='minimo'): cuál es el mínimo
// configurado en productos.stock_minimo y cuánto hay ahora mismo en la despensa, para
// no tener que ir a Configuración a comprobar por qué ha saltado esta reposición.
function compraMinimoMetaHtml(productoId, producto) {
    const minimo = parseFloat(producto.stock_minimo) || 0;
    const disponible = getStockDisponible(productoId);
    return `Mínimo ${escapeHtml(formatCantidad(minimo, producto.unidad))} · Tienes ${escapeHtml(formatCantidad(disponible, producto.unidad))}`;
}

function compraItemHtml(item) {
    const producto = getProducto(item.productoId);
    if (!producto) return '';
    const checkboxId = `compra-cb-${item.id}`;
    // Del menú: el nombre/cantidad abre el desglose por receta (botón). A mano: no hay
    // receta que mostrar, así que el nombre/cantidad sigue marcando comprado como antes
    // (una <label> más, apuntando al mismo checkbox).
    const infoTag = item.origen === 'menu' ? 'button' : 'label';
    const infoAttrs = item.origen === 'menu' ? `type="button" data-compra-info="${item.id}"` : `for="${checkboxId}"`;
    const nombreHtml = item.origen === 'minimo'
        ? `<span class="item-main"><span class="item-name">${escapeHtml(producto.nombre)}</span><span class="item-meta">${compraMinimoMetaHtml(item.productoId, producto)}</span></span>`
        : `<span class="compra-item-nombre">${escapeHtml(producto.nombre)}</span>`;
    return `
        <div class="compra-item ${item.comprado ? 'comprado' : ''}">
            <label class="compra-item-checkbox">
                <input type="checkbox" id="${checkboxId}" data-compra-checkbox="${item.id}" ${item.comprado ? 'checked' : ''}>
            </label>
            <${infoTag} class="compra-item-info" ${infoAttrs}>
                <span class="mono mono-sm">${escapeHtml(monogramLetter(producto.nombre))}</span>
                ${nombreHtml}
                <span class="compra-item-cantidad">${formatCantidad(item.cantidad, producto.unidad)}</span>
            </${infoTag}>
            <button type="button" class="row-delete" data-compra-delete="${item.id}" title="Quitar"><svg class="icon-sm"><use href="#ic-x"/></svg></button>
        </div>
    `;
}

/* ==========================================================================
   Modal: en qué recetas del menú se necesita un producto (solo para filas
   origen='menu' — las de "a mano" no vienen de ninguna receta).
   ========================================================================== */
function compraInfoRowHtml(uso, unidad) {
    return `
        <div class="item-row item-row-static">
            <span class="mono mono-qty" title="${escapeHtml(formatCantidad(uso.cantidadNecesaria, unidad))}">${escapeHtml(formatCantidadCompacta(uso.cantidadNecesaria, unidad))}</span>
            <span class="item-main">
                <span class="item-name">${escapeHtml(uso.receta.nombre)}</span>
                <span class="item-meta">${TIPO_COMIDA_LABELS[uso.entrada.tipo_comida] || uso.entrada.tipo_comida} · ${formatDate(uso.entrada.fecha)}</span>
            </span>
        </div>
    `;
}

function openCompraInfoModal(item) {
    const producto = getProducto(item.productoId);
    if (!producto) return;

    DOM.modalCompraInfoTitle.textContent = producto.nombre;

    const usos = getUsosDeProductoEnMenu(item.productoId);
    if (usos.length === 0) {
        DOM.compraInfoResumen.textContent = 'Ya no aparece en el menú actual (puede que el menú haya cambiado desde que se generó la lista).';
        DOM.compraInfoList.innerHTML = '';
    } else {
        const necesario = round2(usos.reduce((sum, u) => sum + u.cantidadNecesaria, 0));
        const disponible = getStockDisponible(item.productoId);
        DOM.compraInfoResumen.textContent =
            `Necesario en total: ${formatCantidad(necesario, producto.unidad)} · Ya tienes: ${formatCantidad(disponible, producto.unidad)} · A comprar: ${formatCantidad(item.cantidad, producto.unidad)}`;
        DOM.compraInfoList.innerHTML = usos.map(u => compraInfoRowHtml(u, producto.unidad)).join('');
    }

    DOM.modalCompraInfo.classList.remove('hidden');
}

function closeCompraInfoModal() {
    DOM.modalCompraInfo.classList.add('hidden');
}

async function toggleCompradoCompra(id, comprado) {
    await apiRequest('editar_lista_compra_item', 'PATCH', { id, comprado });
    renderListaCompra();
}

async function deleteCompraItem(id) {
    await apiRequest('eliminar_lista_compra_item', 'DELETE', { id });
    renderListaCompra();
}

async function handleAddManualCompra(e) {
    e.preventDefault();
    const productoId = DOM.inCompraProducto.value;
    const cantidad = DOM.inCompraCantidad.value;
    if (!productoId || !cantidad || parseFloat(cantidad) <= 0) return;

    const result = await apiRequest('lista_compra_item', 'POST', { productoId, cantidad, origen: 'manual' });
    if (result && result.success) {
        DOM.formAddManualCompra.reset();
        renderListaCompra();
    }
}

async function handleLimpiarComprados() {
    const comprados = state.listaCompra.filter(li => li.comprado);
    if (comprados.length === 0) return;
    for (const item of comprados) {
        await apiRequest('eliminar_lista_compra_item', 'DELETE', { id: item.id });
    }
    renderListaCompra();
    showToast('Productos comprados eliminados de la lista', 'success');
}
