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
            const receta = getRecetaDeEntrada(entrada);
            if (!receta) return;
            const factor = (parseFloat(entrada.comensales) || 1) / (parseFloat(receta.comensales_base) || 1);
            getIngredientesEfectivos(receta).forEach(ing => {
                if (esProductoTupper(ing.productoId)) return; // un tupper se hace en casa, no se compra
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
    return compararProductosPorCategoria(getProducto(a.productoId), getProducto(b.productoId));
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

// La lista muestra UNA fila por producto aunque esté por varios motivos (menú,
// reposición, a mano): las filas de lista_compra del mismo producto se agrupan
// (agruparListaCompra()). La fila enseña todas las etiquetas de origen y la MAYOR de sus
// cantidades (no la suma: cada motivo ya cuenta con lo que hay en la despensa, así que
// comprar la mayor cubre a todos); al tocarla, la ventana detalla cada motivo con su
// cantidad. Lo ya comprado se agrupa aparte, para no mezclar una fila tachada con una
// pendiente del mismo producto.
let compraGruposActuales = new Map();

// Orden de los motivos dentro de un grupo y del color del borde de la fila (el primero manda).
const ORDEN_ORIGEN_COMPRA = ['menu', 'minimo', 'manual'];

function agruparListaCompra(items) {
    const grupos = new Map();
    items.forEach(item => {
        const key = `${item.productoId}|${item.comprado ? 1 : 0}`;
        if (!grupos.has(key)) grupos.set(key, { key, productoId: item.productoId, comprado: !!item.comprado, filas: [] });
        grupos.get(key).filas.push(item);
    });
    grupos.forEach(g => {
        g.filas.sort((a, b) => ORDEN_ORIGEN_COMPRA.indexOf(a.origen) - ORDEN_ORIGEN_COMPRA.indexOf(b.origen));
        g.cantidad = Math.max(...g.filas.map(f => parseFloat(f.cantidad) || 0));
    });
    return [...grupos.values()];
}

function renderListaCompra() {
    renderCompraChipsSupermercado();
    const filtrando = state.compraFiltro.supermercado !== 'todos';
    // Una única lista, sin separar por origen: una fila por producto, ordenada por
    // categoría y nombre (compararItemsCompra()), con lo comprado al final.
    const grupos = agruparListaCompra(state.listaCompra.filter(pasaFiltroSupermercado)).sort(compararItemsCompra);
    compraGruposActuales = new Map(grupos.map(g => [g.key, g]));

    DOM.compraEmpty.classList.toggle('hidden', state.listaCompra.length > 0);
    DOM.compraList.innerHTML = grupos.length > 0
        ? grupos.map(compraGrupoHtml).join('')
        : filtrando && state.listaCompra.length > 0
            ? '<p class="empty-state-inline">Nada de este supermercado en la lista.</p>'
            : '';

    DOM.compraList.querySelectorAll('[data-compra-checkbox]').forEach(cb => {
        cb.addEventListener('change', () => toggleCompradoCompra(cb.dataset.compraCheckbox, cb.checked));
    });
    DOM.compraList.querySelectorAll('[data-compra-delete]').forEach(btn => {
        btn.addEventListener('click', () => deleteCompraGrupo(btn.dataset.compraDelete));
    });
    DOM.compraList.querySelectorAll('[data-compra-info]').forEach(btn => {
        btn.addEventListener('click', () => {
            const grupo = compraGruposActuales.get(btn.dataset.compraInfo);
            if (grupo) openCompraInfoModal(grupo);
        });
    });
}

// Etiqueta y clase de color de cada origen de una fila de la lista de la compra.
const ORIGEN_COMPRA = {
    menu: { etiqueta: 'Menú', clase: 'origen-menu' },
    minimo: { etiqueta: 'Reposición', clase: 'origen-minimo' },
    manual: { etiqueta: 'A mano', clase: 'origen-manual' }
};

function getOrigenCompra(item) {
    return ORIGEN_COMPRA[item.origen] || ORIGEN_COMPRA.manual;
}

function tagOrigenHtml(item) {
    const origen = getOrigenCompra(item);
    return `<span class="tag-origen ${origen.clase}">${origen.etiqueta}</span>`;
}

// Una etiqueta por motivo distinto (si hay dos filas "A mano", una sola etiqueta).
function tagsOrigenGrupoHtml(grupo) {
    const vistos = new Set();
    return grupo.filas
        .filter(f => {
            if (vistos.has(f.origen)) return false;
            vistos.add(f.origen);
            return true;
        })
        .map(tagOrigenHtml)
        .join(' ');
}

// Para los motivos de "Reposición automática" (origen='minimo'): cuál es el mínimo
// configurado en productos.stock_minimo y cuánto hay ahora mismo en la despensa, para
// no tener que ir a Configuración a comprobar por qué ha saltado esta reposición.
function compraMinimoMetaHtml(productoId, producto) {
    const minimo = parseFloat(producto.stock_minimo) || 0;
    const disponible = getStockDisponible(productoId);
    return `Mínimo ${escapeHtml(formatCantidad(minimo, producto.unidad))} · Tienes ${escapeHtml(formatCantidad(disponible, producto.unidad))}`;
}

// Detalle bajo el nombre: las etiquetas de origen, el supermercado, la categoría del
// producto (sustituye a los encabezados de categoría) y, si uno de los motivos es la
// reposición automática, el mínimo y lo que tienes.
function compraItemMetaHtml(grupo, producto) {
    const partes = [tagsOrigenGrupoHtml(grupo)];
    if (producto.supermercado) partes.push(`<span class="tag-supermercado">${escapeHtml(producto.supermercado)}</span>`);
    if (producto.categoria) partes.push(escapeHtml(producto.categoria));
    if (grupo.filas.some(f => f.origen === 'minimo')) partes.push(compraMinimoMetaHtml(grupo.productoId, producto));
    return `<span class="item-meta">${partes.join(' · ')}</span>`;
}

function compraGrupoHtml(grupo) {
    const producto = getProducto(grupo.productoId);
    if (!producto) return '';
    // Solo el checkbox marca como comprado (todas las filas del producto a la vez). El
    // resto de la fila (botón) abre siempre la ventana con el detalle de cada motivo
    // (openCompraInfoModal()). El borde izquierdo toma el color del motivo principal.
    const nombreHtml = `<span class="item-main"><span class="item-name">${escapeHtml(producto.nombre)}</span>${compraItemMetaHtml(grupo, producto)}</span>`;
    const varios = grupo.filas.length > 1;
    return `
        <div class="compra-item ${getOrigenCompra(grupo.filas[0]).clase} ${grupo.comprado ? 'comprado' : ''}">
            <label class="compra-item-checkbox" title="Marcar como comprado">
                <input type="checkbox" data-compra-checkbox="${grupo.key}" ${grupo.comprado ? 'checked' : ''} aria-label="Comprado">
            </label>
            <button type="button" class="compra-item-info" data-compra-info="${grupo.key}">
                <span class="mono mono-sm">${escapeHtml(monogramLetter(producto.nombre))}</span>
                ${nombreHtml}
                ${compraUrgenciaHtml(grupo)}
                <span class="compra-item-cantidad"${varios ? ' title="La mayor de las cantidades de sus motivos; toca para ver el detalle"' : ''}>${formatCantidad(grupo.cantidad, producto.unidad)}</span>
            </button>
            <button type="button" class="row-delete" data-compra-delete="${grupo.key}" title="${varios ? 'Quitar (todos sus motivos)' : 'Quitar'}"><svg class="icon-sm"><use href="#ic-x"/></svg></button>
        </div>
    `;
}

/* ==========================================================================
   Modal: de dónde viene un producto de la lista (se abre al tocar cualquier
   fila). Un bloque por motivo, cada uno con su cantidad. Del menú: en qué
   recetas se necesita y cuánto. Reposición: mínimo y lo que tienes. A mano:
   cuándo se añadió.
   ========================================================================== */
function compraInfoRowHtml(uso, unidad) {
    return `
        <div class="item-row item-row-static">
            <span class="mono mono-qty" title="${escapeHtml(formatCantidad(uso.cantidadNecesaria, unidad))}">${escapeHtml(formatCantidadCompacta(uso.cantidadNecesaria, unidad))}</span>
            <span class="item-main">
                <span class="item-name">${escapeHtml(uso.receta.nombre)}</span>
                <span class="item-meta">${TIPO_COMIDA_LABELS[uso.entrada.tipo_comida] || uso.entrada.tipo_comida} · ${nombreDiaSemana(uso.entrada.fecha).toLowerCase()} ${formatDate(uso.entrada.fecha)}</span>
            </span>
        </div>
    `;
}

function compraMotivoHtml(item, producto) {
    const unidad = producto.unidad;
    const disponible = getStockDisponible(item.productoId);
    let explicacion;
    let detalle = '';

    if (item.origen === 'menu') {
        // Desglose por receta del menú (recalculado contra el menú actual).
        const usos = getUsosDeProductoEnMenu(item.productoId);
        if (usos.length === 0) {
            explicacion = 'Ya no aparece en el menú actual (puede que el menú haya cambiado desde que se generó la lista).';
        } else {
            const necesario = round2(usos.reduce((sum, u) => sum + u.cantidadNecesaria, 0));
            explicacion = `Necesario en total: ${formatCantidad(necesario, unidad)} · Ya tienes: ${formatCantidad(disponible, unidad)}`;
            detalle = usos.map(u => compraInfoRowHtml(u, unidad)).join('');
        }
    } else if (item.origen === 'minimo') {
        const minimo = parseFloat(producto.stock_minimo) || 0;
        explicacion = `Tienes ${formatCantidad(disponible, unidad)} y tu mínimo es ${formatCantidad(minimo, unidad)}. ` +
            'Se actualiza sola al cambiar la despensa; el mínimo se cambia en Ajustes → Catálogo de productos.';
    } else {
        const fecha = (item.fecha_creacion || '').slice(0, 10);
        explicacion = fecha ? `Lo añadiste a mano el ${nombreDiaSemana(fecha).toLowerCase()} ${formatDate(fecha)}.` : 'Lo añadiste a mano.';
    }

    return `
        <div class="compra-info-motivo">
            <p class="compra-info-motivo-cabecera">${tagOrigenHtml(item)} <strong>A comprar: ${escapeHtml(formatCantidad(item.cantidad, unidad))}</strong></p>
            <p class="config-hint">${escapeHtml(explicacion)}</p>
            ${detalle ? `<div class="lotes-list-modal">${detalle}</div>` : ''}
        </div>
    `;
}

function openCompraInfoModal(grupo) {
    const producto = getProducto(grupo.productoId);
    if (!producto) return;

    DOM.modalCompraInfoTitle.textContent = producto.nombre;
    DOM.compraInfoOrigenes.innerHTML = tagsOrigenGrupoHtml(grupo);
    DOM.compraInfoResumen.textContent = grupo.filas.length > 1
        ? `Está en la lista por ${grupo.filas.length} motivos. En la lista se muestra la mayor cantidad (${formatCantidad(grupo.cantidad, producto.unidad)}), que ya cubre a todos.`
        : '';
    DOM.compraInfoResumen.classList.toggle('hidden', grupo.filas.length <= 1);
    DOM.compraInfoList.innerHTML = grupo.filas.map(f => compraMotivoHtml(f, producto)).join('');
    DOM.modalCompraInfo.classList.remove('hidden');
}

function closeCompraInfoModal() {
    DOM.modalCompraInfo.classList.add('hidden');
}

// Ubicación de la despensa donde caen los productos según se van marcando en la tienda.
// Se crea sola la primera vez; luego se llevan a su sitio desde la despensa.
const UBICACION_CARRO_NOMBRE = 'Carro de compra';

async function getUbicacionCarroId() {
    const existente = state.ubicaciones.find(u => u.activa && u.nombre.trim().toLowerCase() === UBICACION_CARRO_NOMBRE.toLowerCase());
    if (existente) return existente.id;
    const res = await apiRequest('ubicacion', 'POST', { nombre: UBICACION_CARRO_NOMBRE, icono: '🛒' });
    if (!res || !res.success) return null;
    populateUbicacionSelectors();
    return res.id;
}

// Marcar/desmarcar un producto afecta a todas sus filas (todos sus motivos). Al marcarlo
// se apunta en la despensa, en "Carro de compra"; al desmarcarlo se retira de allí (si
// sigue en el carro).
async function toggleCompradoCompra(grupoKey, comprado) {
    const grupo = compraGruposActuales.get(grupoKey);
    if (!grupo) return;
    for (const fila of grupo.filas) {
        await apiRequest('editar_lista_compra_item', 'PATCH', { id: fila.id, comprado });
    }

    let cambioDespensa = false;
    const ubicacionId = await getUbicacionCarroId();
    if (ubicacionId) {
        if (comprado) {
            const res = await apiRequest('despensa_lote', 'POST', {
                productoId: grupo.productoId,
                cantidad: grupo.cantidad,
                ubicacionId,
                fecha_entrada: todayISO()
            });
            if (res && res.success) cambioDespensa = true;
            else showToast(res?.error || 'No se pudo añadir al carro de compra', 'error');
        } else {
            const enCarro = state.despensa
                .filter(l => l.activa && String(l.productoId) === String(grupo.productoId) && String(l.ubicacionId) === String(ubicacionId))
                .sort((a, b) => b.id - a.id)[0];
            if (enCarro) {
                await apiRequest('eliminar_despensa_lote', 'DELETE', { id: enCarro.id });
                cambioDespensa = true;
            }
        }
    }
    if (cambioDespensa) renderDespensa();
    renderListaCompra();
}

// Quitar un producto quita todas sus filas. Lo del menú vuelve si se regenera la lista
// desde el menú, y lo de reposición vuelve solo mientras siga por debajo del mínimo.
async function deleteCompraGrupo(grupoKey) {
    const grupo = compraGruposActuales.get(grupoKey);
    if (!grupo) return;
    for (const fila of grupo.filas) {
        await apiRequest('eliminar_lista_compra_item', 'DELETE', { id: fila.id });
    }
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
