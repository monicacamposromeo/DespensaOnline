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

// Comprados al final; el resto ordenado por categoría del producto (productos.categoria,
// alfabética y "sin categoría" al final) y, dentro de cada categoría, por nombre. No se
// pintan encabezados de categoría (ocupaban mucho al usar la lista en la tienda): la
// categoría va como detalle de cada fila (compraItemMetaHtml()), y el orden basta para
// que lo de la misma sección del súper quede junto.
function compararItemsCompra(a, b) {
    if (a.comprado !== b.comprado) return a.comprado ? 1 : -1;
    const productoA = getProducto(a.productoId);
    const productoB = getProducto(b.productoId);
    const categoriaA = (productoA?.categoria || '').trim();
    const categoriaB = (productoB?.categoria || '').trim();
    if (categoriaA !== categoriaB) {
        if (!categoriaA) return 1;
        if (!categoriaB) return -1;
        const cmp = categoriaA.localeCompare(categoriaB, 'es', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
    }
    return (productoA?.nombre || '').localeCompare(productoB?.nombre || '', 'es', { sensitivity: 'base' });
}

// ¿Hace falta comprarlo ya? 'hoy' / 'manana' si el menú de hoy o de mañana necesita más de
// lo que hay (mismo cálculo que la alerta "Compra X para hoy" y su simulación de mañana en
// Próximas alertas: getNecesidadesDelDia() + getStockProyectado(), js/alertas.js). Vale
// para cualquier fila, venga del menú, de la reposición o añadida a mano: lo urgente es
// el producto, no el motivo por el que está en la lista.
function getUrgenciaCompra(productoId) {
    const hoy = todayISO();
    for (const [fecha, urgencia] of [[hoy, 'hoy'], [addDaysToISO(hoy, 1), 'manana']]) {
        const necesaria = getNecesidadesDelDia(fecha)[productoId] || 0;
        if (round2(necesaria - getStockProyectado(productoId, fecha)) > 0) return urgencia;
    }
    return null;
}

function compraUrgenciaHtml(item) {
    if (item.comprado) return '';
    const urgencia = getUrgenciaCompra(String(item.productoId));
    if (urgencia === 'hoy') return '<span class="status-pill danger" title="Lo necesitas para el menú de hoy">Hoy</span>';
    if (urgencia === 'manana') return '<span class="status-pill warn" title="Lo necesitas para el menú de mañana">Mañana</span>';
    return '';
}

// Filtro por supermercado (productos.supermercado): 'todos', 'sin' (productos sin súper
// asignado) o el nombre de un supermercado.
const SUPERMERCADO_FILTRO_SIN = '__sin__';

function pasaFiltroSupermercado(item) {
    const filtro = state.compraFiltro.supermercado;
    if (filtro === 'todos') return true;
    const supermercado = getProducto(item.productoId)?.supermercado || '';
    return filtro === SUPERMERCADO_FILTRO_SIN ? !supermercado : supermercado === filtro;
}

// Chips Todos / cada supermercado / Sin supermercado. Solo se muestran si algún producto
// tiene supermercado asignado; si el filtro activo ya no existe, vuelve a "Todos".
function renderCompraChipsSupermercado() {
    const supermercados = getSupermercadosUnicos();
    DOM.compraChipsSupermercado.classList.toggle('hidden', supermercados.length === 0);
    const valores = ['todos', ...supermercados, SUPERMERCADO_FILTRO_SIN];
    if (!valores.includes(state.compraFiltro.supermercado)) state.compraFiltro.supermercado = 'todos';

    const etiqueta = v => v === 'todos' ? 'Todos' : v === SUPERMERCADO_FILTRO_SIN ? 'Sin supermercado' : v;
    DOM.compraChipsSupermercado.innerHTML = valores.map(v =>
        `<button type="button" class="chip ${v === state.compraFiltro.supermercado ? 'active' : ''}" data-value="${escapeHtml(v)}">${escapeHtml(etiqueta(v))}</button>`
    ).join('');
}

function renderListaCompra() {
    renderCompraChipsSupermercado();
    const filtrando = state.compraFiltro.supermercado !== 'todos';
    const visibles = state.listaCompra.filter(pasaFiltroSupermercado);
    const menuItems = visibles.filter(li => li.origen === 'menu').sort(compararItemsCompra);
    const minimoItems = visibles.filter(li => li.origen === 'minimo').sort(compararItemsCompra);
    const manualItems = visibles.filter(li => li.origen === 'manual').sort(compararItemsCompra);
    const vacioFiltrado = '<p class="empty-state-inline">Nada de este supermercado en esta sección.</p>';

    DOM.compraEmpty.classList.toggle('hidden', state.listaCompra.length > 0);
    DOM.compraListMenu.innerHTML = menuItems.length > 0
        ? menuItems.map(compraItemHtml).join('')
        : filtrando ? vacioFiltrado : '<p class="empty-state-inline">Genera la lista desde el menú semanal.</p>';
    DOM.compraListMinimo.innerHTML = minimoItems.length > 0
        ? minimoItems.map(compraItemHtml).join('')
        : filtrando ? vacioFiltrado : '<p class="empty-state-inline">Ningún producto con stock mínimo está por debajo de lo configurado.</p>';
    DOM.compraListManual.innerHTML = manualItems.length > 0
        ? manualItems.map(compraItemHtml).join('')
        : filtrando ? vacioFiltrado : '<p class="empty-state-inline">Sin productos añadidos a mano.</p>';

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

// Detalle bajo el nombre: la categoría del producto (sustituye a los encabezados de
// categoría), su supermercado como etiqueta y, en "Reposición automática", el mínimo y
// lo que tienes.
function compraItemMetaHtml(item, producto) {
    const partes = [];
    if (producto.supermercado) partes.push(`<span class="tag-supermercado">${escapeHtml(producto.supermercado)}</span>`);
    if (producto.categoria) partes.push(escapeHtml(producto.categoria));
    if (item.origen === 'minimo') partes.push(compraMinimoMetaHtml(item.productoId, producto));
    return partes.length > 0 ? `<span class="item-meta">${partes.join(' · ')}</span>` : '';
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
    const nombreHtml = `<span class="item-main"><span class="item-name">${escapeHtml(producto.nombre)}</span>${compraItemMetaHtml(item, producto)}</span>`;
    return `
        <div class="compra-item ${item.comprado ? 'comprado' : ''}">
            <label class="compra-item-checkbox">
                <input type="checkbox" id="${checkboxId}" data-compra-checkbox="${item.id}" ${item.comprado ? 'checked' : ''}>
            </label>
            <${infoTag} class="compra-item-info" ${infoAttrs}>
                <span class="mono mono-sm">${escapeHtml(monogramLetter(producto.nombre))}</span>
                ${nombreHtml}
                ${compraUrgenciaHtml(item)}
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
