/* ==========================================================================
   DespensaOnline - Pantalla Recetas
   ========================================================================== */

function renderRecetas() {
    const categoria = state.recetasFiltro.categoria;
    const recetasActivas = state.recetas.filter(r => r.activa);
    const recetasFiltradas = recetasActivas.filter(r => categoria === 'todas' || r.categoria === categoria);

    DOM.recetasEmpty.classList.toggle('hidden', recetasActivas.length > 0);

    if (recetasActivas.length > 0 && recetasFiltradas.length === 0) {
        DOM.recetasList.innerHTML = '<p class="empty-state-inline">No hay recetas en esta categoría.</p>';
    } else if (categoria === 'todas') {
        // Sin filtro de categoría: agrupar por categoría para verlo todo de un vistazo.
        DOM.recetasList.innerHTML = agruparRecetasPorCategoriaHtml(recetasFiltradas);
    } else {
        DOM.recetasList.innerHTML = recetasFiltradas.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(recetaCardHtml).join('');
    }

    DOM.recetasList.querySelectorAll('[data-receta-id]').forEach(card => {
        card.addEventListener('click', () => {
            const receta = getReceta(card.dataset.recetaId);
            if (receta) openRecetaModal(receta);
        });
    });
}

// Une un encabezado (nombre de la categoría, en el orden natural de las comidas) con
// las tarjetas de esa categoría, como hermanos directos dentro de #recetas-list.
function agruparRecetasPorCategoriaHtml(recetas) {
    const grupos = new Map();
    recetas.forEach(r => {
        const key = r.categoria || '';
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key).push(r);
    });

    const ordenPreferido = ['desayuno', 'comida', 'cena', 'postre', 'snack'];
    const claves = [...grupos.keys()].sort((a, b) => {
        const ia = ordenPreferido.indexOf(a), ib = ordenPreferido.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });

    return claves
        .map(key => {
            const titulo = CATEGORIA_RECETA_LABELS[key] || key || 'Sin categoría';
            const tarjetas = grupos.get(key).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(recetaCardHtml).join('');
            return `<h2 class="section-title">${escapeHtml(titulo)}</h2>${tarjetas}`;
        })
        .join('');
}

function recetaCardHtml(receta) {
    const ingredientesReceta = getIngredientesReceta(receta.id);
    const nombresIngredientes = ingredientesReceta
        .map(ri => getProducto(ri.productoId)?.nombre)
        .filter(Boolean)
        .join(', ');

    const tipoPrecocinado = getTipoPrecocinado(receta);
    const meta = [
        receta.tiempo_preparacion_min ? `${receta.tiempo_preparacion_min} min` : null,
        `${receta.comensales_base} comensales`,
        tipoPrecocinado === 'fin_de_semana' ? 'Precocinar el finde'
            : tipoPrecocinado === 'dia_anterior' ? 'Tupper: la víspera'
            : recetaRequierePrecocinado(receta) ? null : 'Listo para servir'
    ].filter(Boolean).join(' · ');

    return `
        <div class="recipe-card" data-receta-id="${receta.id}">
            <div class="recipe-top">
                <span class="recipe-name">${escapeHtml(receta.nombre)}</span>
                <span class="recipe-cat">${CATEGORIA_RECETA_LABELS[receta.categoria] || receta.categoria}</span>
            </div>
            <p class="recipe-meta">${meta}</p>
            <p class="recipe-desc">${escapeHtml(nombresIngredientes || 'Sin ingredientes')}</p>
        </div>
    `;
}

function openRecetaModal(receta = null) {
    state.editingRecetaId = receta ? receta.id : null;
    DOM.modalRecetaTitle.textContent = receta ? 'Editar receta' : 'Nueva receta';
    DOM.inRecetaId.value = receta ? receta.id : '';
    DOM.inRecetaNombre.value = receta ? receta.nombre : '';
    DOM.inRecetaCategoria.value = receta ? receta.categoria : 'comida';
    DOM.inRecetaTiempo.value = receta ? (receta.tiempo_preparacion_min || '') : '';
    DOM.inRecetaComensales.value = receta ? receta.comensales_base : 2;
    DOM.inRecetaTipoPrecocinado.value = receta ? (getTipoPrecocinado(receta) || '') : 'fin_de_semana';
    DOM.inRecetaInstrucciones.value = receta ? (receta.instrucciones || '') : '';
    DOM.inRecetaTupperProducto.value = receta && receta.producto_tupper_id ? receta.producto_tupper_id : '';
    actualizarCampoTupperReceta();
    DOM.btnDeleteReceta.classList.toggle('hidden', !receta);
    DOM.btnDuplicateReceta.classList.toggle('hidden', !receta);

    DOM.ingredientesRows.innerHTML = '';
    const ingredientes = receta ? getIngredientesReceta(receta.id) : [];
    ingredientes.forEach(ing => addIngredienteRow(ing.productoId, ing.cantidad, ing.requiere_cocinado === true));

    DOM.modalReceta.classList.remove('hidden');
}

/* ==========================================================================
   Producto de los tuppers congelados de la receta (recetas.producto_tupper_id)
   Solo se ofrece en platos de fin de semana (guisos). Sin enlace explícito, la app usa un
   producto ya existente con el nombre de la receta + "congelado"/"tupper" (buscarProductoTupper(),
   js/tuppers.js); al apuntar tuppers tras precocinar se enlaza solo.
   ========================================================================== */
function actualizarCampoTupperReceta() {
    const visible = DOM.inRecetaTipoPrecocinado.value === 'fin_de_semana' || !!DOM.inRecetaTupperProducto.value;
    DOM.recetaTupperField.classList.toggle('hidden', !visible);

    const enlazado = DOM.inRecetaTupperProducto.value ? getProducto(DOM.inRecetaTupperProducto.value) : null;
    // Por nombre solo se sugiere con la receta ya guardada (el nombre del formulario puede cambiar).
    const porNombre = !enlazado && state.editingRecetaId ? buscarProductoTupper(getReceta(state.editingRecetaId)) : null;
    DOM.recetaTupperNombre.textContent = enlazado ? enlazado.nombre : porNombre ? porNombre.nombre : 'Ninguno';
    DOM.recetaTupperMeta.textContent = enlazado ? 'Enlazado a esta receta'
        : porNombre ? 'Detectado por su nombre'
        : 'Se creará al apuntar los tuppers tras precocinar';
    DOM.btnRecetaTupperQuitar.classList.toggle('hidden', !enlazado);
}

function abrirSelectorProductoTupper() {
    abrirSelector({
        titulo: 'Producto de los tuppers',
        items: state.productos.filter(p => p.activa).map(p => ({ id: p.id, nombre: p.nombre, categoria: p.categoria, meta: `Unidad: ${p.unidad}` })),
        multi: false,
        onConfirm: seleccion => {
            DOM.inRecetaTupperProducto.value = [...seleccion.keys()][0];
            actualizarCampoTupperReceta();
        }
    });
}

function closeRecetaModal() {
    DOM.modalReceta.classList.add('hidden');
    state.editingRecetaId = null;
}

// requiereCocinado (por defecto false): marca la EXCEPCIÓN de que este ingrediente concreto
// necesita precocinado por separado (p. ej. el arroz de unas fajitas), independientemente
// del interruptor general de la receta (recetaRequierePrecocinado(), js/state.js) — no
// hace falta marcar cada ingrediente de un guiso, para eso está el interruptor general.
//
// El producto se elige en el selector (abrirSelectorIngredientes()) y la fila lo muestra
// como texto fijo. Sin productoId (nuevoNombre, aunque sea ''), la fila es de un producto
// que aún no existe: lleva los campos para crearlo y se crea al guardar la receta.
function addIngredienteRow(productoId = null, cantidad = '', requiereCocinado = false, nuevoNombre = null) {
    const item = document.createElement('div');
    item.className = 'ingrediente-item';
    const esNuevo = productoId === null;
    item.dataset.productoId = esNuevo ? '' : String(productoId);
    const producto = esNuevo ? null : getProducto(productoId);

    item.innerHTML = `
        <div class="ingrediente-row">
            <span class="ingrediente-nombre">${esNuevo ? 'Producto nuevo' : escapeHtml(producto?.nombre || '?')}</span>
            <input type="number" class="form-input ingrediente-cantidad" min="0" step="0.01" placeholder="Cantidad" value="${escapeHtml(cantidad)}">
            ${producto ? `<span class="ingrediente-unidad">${escapeHtml(producto.unidad)}</span>` : ''}
            <label class="ingrediente-precocinado" title="Requiere precocinado">
                <input type="checkbox" class="ingrediente-requiere-cocinado" ${requiereCocinado ? 'checked' : ''}>
                <span>Precocinar</span>
            </label>
            <button type="button" class="btn-icon-only btn-remove-ingrediente" title="Quitar ingrediente">×</button>
        </div>
        <div class="nuevo-producto-fields ${esNuevo ? '' : 'hidden'}">
            <input type="text" class="form-input nuevo-producto-nombre" placeholder="Nombre del producto nuevo" value="${escapeHtml(nuevoNombre || '')}">
            <div class="form-row">
                <div class="field-with-add">
                    <select class="form-select nuevo-producto-categoria">${buildCategoriaOptionsHtml()}</select>
                    <input type="text" class="form-input nuevo-producto-categoria-nueva hidden" placeholder="Nombre de la categoría nueva">
                </div>
                <select class="form-select nuevo-producto-unidad">
                    <option value="ud">ud</option>
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="l">l</option>
                </select>
            </div>
        </div>
    `;

    wireCategoriaSelect(item.querySelector('.nuevo-producto-categoria'), item.querySelector('.nuevo-producto-categoria-nueva'));

    item.querySelector('.btn-remove-ingrediente').addEventListener('click', () => item.remove());
    DOM.ingredientesRows.appendChild(item);
    return item;
}

/* ==========================================================================
   Selector de ingredientes (js/selector.js): se marcan varios productos a la vez
   y a cada uno se le pone su cantidad y, si hace falta, "Precocinar".
   ========================================================================== */
function abrirSelectorIngredientes() {
    const yaEnReceta = new Set(
        [...DOM.ingredientesRows.querySelectorAll('.ingrediente-item')].map(i => i.dataset.productoId).filter(Boolean)
    );

    // "Más usados": los productos que más aparecen como ingrediente en todas las recetas.
    const usos = new Map();
    state.recetaIngredientes.forEach(ri => usos.set(String(ri.productoId), (usos.get(String(ri.productoId)) || 0) + 1));
    const masUsados = [...usos.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id)
        .filter(id => getProducto(id)?.activa)
        .slice(0, 8);

    abrirSelector({
        titulo: 'Añadir ingredientes',
        items: state.productos.filter(p => p.activa).map(p => ({
            id: p.id,
            nombre: p.nombre,
            categoria: p.categoria,
            meta: `Unidad: ${p.unidad}${yaEnReceta.has(String(p.id)) ? ' · ya está en la receta' : ''}`
        })),
        recientes: masUsados,
        recientesLabel: 'Más usados',
        multi: true,
        contador: false,
        panel: {
            inicial: () => ({ cantidad: '', requiereCocinado: false }),
            html: (id, v) => {
                const unidad = getProducto(id)?.unidad || '';
                return `
                    <div class="selector-campos">
                        <label class="selector-campo">
                            <span>Cantidad${unidad ? ` (${escapeHtml(unidad)})` : ''}</span>
                            <input type="number" class="form-input" data-campo="cantidad" min="0" step="0.01" value="${escapeHtml(v.cantidad)}">
                        </label>
                        <label class="selector-campo selector-campo-check">
                            <input type="checkbox" data-campo="requiereCocinado" ${v.requiereCocinado ? 'checked' : ''}>
                            <span>Precocinar aparte</span>
                        </label>
                    </div>`;
            }
        },
        validar: (seleccion, valores) => {
            for (const id of seleccion.keys()) {
                if (!(parseFloat(valores.get(String(id)).cantidad) > 0)) return `Indica la cantidad de ${getProducto(id)?.nombre || 'el ingrediente'}.`;
            }
            return null;
        },
        confirmarLabel: total => `Añadir a la receta (${total})`,
        onConfirm: (seleccion, valores) => {
            seleccion.forEach((_, id) => {
                const v = valores.get(String(id));
                addIngredienteRow(id, v.cantidad, v.requiereCocinado);
            });
        },
        onCrear: nombre => {
            const fila = addIngredienteRow(null, '', false, nombre);
            fila.scrollIntoView({ block: 'nearest' });
        }
    });
}

// Async porque, si una fila pide crear un producto nuevo, hay que esperar a que se cree
// antes de poder usar su id como ingrediente de la receta.
async function collectIngredientesFromForm() {
    const items = Array.from(DOM.ingredientesRows.querySelectorAll('.ingrediente-item'));
    const ingredientes = [];

    for (const item of items) {
        const cantidad = item.querySelector('.ingrediente-cantidad').value;
        if (!(parseFloat(cantidad) > 0)) continue;

        let productoId = item.dataset.productoId;
        if (!productoId) {
            productoId = await crearProductoDesdeCampos(
                item.querySelector('.nuevo-producto-nombre').value,
                resolveCategoriaValue(item.querySelector('.nuevo-producto-categoria'), item.querySelector('.nuevo-producto-categoria-nueva')),
                item.querySelector('.nuevo-producto-unidad').value
            );
            if (!productoId) continue;
        }
        const requiereCocinado = item.querySelector('.ingrediente-requiere-cocinado').checked;
        ingredientes.push({ productoId, cantidad, requiere_cocinado: requiereCocinado });
    }
    return ingredientes;
}

async function handleRecetaFormSubmit(e) {
    e.preventDefault();
    const ingredientes = await collectIngredientesFromForm();
    if (ingredientes.length === 0) {
        showToast('Añade al menos un ingrediente con cantidad mayor que 0.', 'error');
        return;
    }

    const payload = {
        nombre: DOM.inRecetaNombre.value,
        categoria: DOM.inRecetaCategoria.value,
        tiempo_preparacion_min: DOM.inRecetaTiempo.value || null,
        comensales_base: DOM.inRecetaComensales.value,
        // El desplegable guarda dos columnas: requiere_cocinado (sí/no, como antes) y
        // tipo_precocinado ('fin_de_semana' | 'dia_anterior', null si no lleva).
        requiere_cocinado: DOM.inRecetaTipoPrecocinado.value !== '',
        tipo_precocinado: DOM.inRecetaTipoPrecocinado.value || null,
        instrucciones: DOM.inRecetaInstrucciones.value,
        ingredientes
    };
    // Solo se envía si hay enlace (o lo había y se quita): así, si nunca se usa, no hace falta
    // que exista la columna recetas.producto_tupper_id en la base de datos.
    const tupperProductoId = DOM.inRecetaTupperProducto.value;
    if (tupperProductoId || getReceta(state.editingRecetaId)?.producto_tupper_id) payload.producto_tupper_id = tupperProductoId || null;

    const result = state.editingRecetaId
        ? await apiRequest('editar_receta', 'PATCH', { id: state.editingRecetaId, ...payload })
        : await apiRequest('receta', 'POST', payload);

    if (result && result.success) {
        showToast(result.message, 'success');
        closeRecetaModal();
        renderRecetas();
        populateRecetaSelectors();
        renderMenuSemanal();
    } else {
        showToast(result?.error || 'Error al guardar', 'error');
    }
}

async function handleDeleteReceta() {
    if (!state.editingRecetaId) return;
    if (!confirm('¿Eliminar esta receta? También se quitará de cualquier menú donde esté asignada.')) return;
    const result = await apiRequest('eliminar_receta', 'DELETE', { id: state.editingRecetaId });
    if (result && result.success) {
        showToast(result.message, 'success');
        closeRecetaModal();
        renderRecetas();
        populateRecetaSelectors();
        renderMenuSemanal();
    }
}

// Crea una receta nueva con el mismo nombre (+ "(copia)"), datos e ingredientes que la
// que se está editando: la original se deja intacta, para partir de ella con variaciones.
async function handleDuplicateReceta() {
    if (!state.editingRecetaId) return;
    const receta = getReceta(state.editingRecetaId);
    if (!receta) return;

    const ingredientes = getIngredientesReceta(receta.id).map(ing => ({
        productoId: ing.productoId,
        cantidad: ing.cantidad,
        requiere_cocinado: !!ing.requiere_cocinado
    }));

    const result = await apiRequest('receta', 'POST', {
        nombre: `${receta.nombre} (copia)`,
        categoria: receta.categoria,
        tiempo_preparacion_min: receta.tiempo_preparacion_min || null,
        comensales_base: receta.comensales_base,
        requiere_cocinado: receta.requiere_cocinado !== false,
        tipo_precocinado: getTipoPrecocinado(receta),
        instrucciones: receta.instrucciones || '',
        ingredientes
    });

    if (result && result.success) {
        showToast('Receta duplicada', 'success');
        closeRecetaModal();
        renderRecetas();
        populateRecetaSelectors();
        renderMenuSemanal();
    } else {
        showToast(result?.error || 'Error al duplicar', 'error');
    }
}
