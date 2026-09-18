/* ==========================================================================
   DespensaOnline - Lista de la Compra (generación y render)
   Ver DOCUMENTACIÓN-TECNICA.md §5 para la explicación del algoritmo.
   ========================================================================== */

async function generarListaCompraSemana() {
    const dias = getWeekDates(state.selectedWeekStart);
    await generarListaCompra(dias[0], dias[6]);
    renderListaCompra();
    showToast('Lista de la compra generada a partir del menú de esta semana', 'success');
}

async function generarListaCompra(fechaInicio, fechaFin) {
    const necesidades = {}; // productoId -> cantidad total necesaria

    state.menuSemanal
        .filter(e => e.activa && e.fecha >= fechaInicio && e.fecha <= fechaFin)
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

function renderListaCompra() {
    const menuItems = state.listaCompra.filter(li => li.origen === 'menu').sort((a, b) => a.comprado - b.comprado);
    const manualItems = state.listaCompra.filter(li => li.origen === 'manual').sort((a, b) => a.comprado - b.comprado);

    DOM.compraEmpty.classList.toggle('hidden', state.listaCompra.length > 0);
    DOM.compraListMenu.innerHTML = menuItems.length > 0
        ? menuItems.map(compraItemHtml).join('')
        : '<p class="empty-state-inline">Genera la lista desde el menú semanal.</p>';
    DOM.compraListManual.innerHTML = manualItems.length > 0
        ? manualItems.map(compraItemHtml).join('')
        : '<p class="empty-state-inline">Sin productos añadidos a mano.</p>';

    DOM.compraListMenu.querySelectorAll('[data-compra-checkbox]').forEach(cb => {
        cb.addEventListener('change', () => toggleCompradoCompra(cb.dataset.compraCheckbox, cb.checked));
    });
    DOM.compraListManual.querySelectorAll('[data-compra-checkbox]').forEach(cb => {
        cb.addEventListener('change', () => toggleCompradoCompra(cb.dataset.compraCheckbox, cb.checked));
    });
    DOM.compraListMenu.querySelectorAll('[data-compra-delete]').forEach(btn => {
        btn.addEventListener('click', () => deleteCompraItem(btn.dataset.compraDelete));
    });
    DOM.compraListManual.querySelectorAll('[data-compra-delete]').forEach(btn => {
        btn.addEventListener('click', () => deleteCompraItem(btn.dataset.compraDelete));
    });
}

function compraItemHtml(item) {
    const producto = getProducto(item.productoId);
    if (!producto) return '';
    return `
        <div class="compra-item ${item.comprado ? 'comprado' : ''}">
            <label class="compra-item-label">
                <input type="checkbox" data-compra-checkbox="${item.id}" ${item.comprado ? 'checked' : ''}>
                <span class="mono mono-sm">${escapeHtml(monogramLetter(producto.nombre))}</span>
                <span class="compra-item-nombre">${escapeHtml(producto.nombre)}</span>
                <span class="compra-item-cantidad">${formatCantidad(item.cantidad, producto.unidad)}</span>
            </label>
            <button type="button" class="row-delete" data-compra-delete="${item.id}" title="Quitar"><svg class="icon-sm"><use href="#ic-x"/></svg></button>
        </div>
    `;
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
