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

    const meta = [
        receta.tiempo_preparacion_min ? `${receta.tiempo_preparacion_min} min` : null,
        `${receta.comensales_base} comensales`,
        recetaRequierePrecocinado(receta) ? null : 'Listo para servir'
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
    DOM.inRecetaRequiereCocinado.checked = receta ? receta.requiere_cocinado !== false : true;
    DOM.inRecetaInstrucciones.value = receta ? (receta.instrucciones || '') : '';
    DOM.btnDeleteReceta.classList.toggle('hidden', !receta);

    DOM.ingredientesRows.innerHTML = '';
    const ingredientes = receta ? getIngredientesReceta(receta.id) : [];
    if (ingredientes.length > 0) {
        ingredientes.forEach(ing => addIngredienteRow(ing.productoId, ing.cantidad, ing.requiere_cocinado === true));
    } else {
        addIngredienteRow();
    }

    DOM.modalReceta.classList.remove('hidden');
}

function closeRecetaModal() {
    DOM.modalReceta.classList.add('hidden');
    state.editingRecetaId = null;
}

// requiereCocinado (por defecto false): marca la EXCEPCIÓN de que este ingrediente concreto
// necesita precocinado por separado (p. ej. el arroz de unas fajitas), independientemente
// del interruptor general de la receta (recetaRequierePrecocinado(), js/state.js) — no
// hace falta marcar cada ingrediente de un guiso, para eso está el interruptor general.
function addIngredienteRow(productoId = null, cantidad = '', requiereCocinado = false) {
    const item = document.createElement('div');
    item.className = 'ingrediente-item';

    const options = state.productos
        .filter(p => p.activa)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
        .map(p => `<option value="${p.id}" ${String(p.id) === String(productoId) ? 'selected' : ''}>${escapeHtml(p.nombre)} (${escapeHtml(p.unidad)})</option>`)
        .join('') + `<option value="${PRODUCTO_NUEVO_VALUE}">+ Crear producto nuevo…</option>`;

    item.innerHTML = `
        <div class="ingrediente-row">
            <select class="form-select ingrediente-producto">${options}</select>
            <input type="number" class="form-input ingrediente-cantidad" min="0" step="0.01" placeholder="Cantidad" value="${cantidad}">
            <label class="ingrediente-precocinado" title="Requiere precocinado">
                <input type="checkbox" class="ingrediente-requiere-cocinado" ${requiereCocinado ? 'checked' : ''}>
                <span>Precocinar</span>
            </label>
            <button type="button" class="btn-icon-only btn-remove-ingrediente" title="Quitar ingrediente">×</button>
        </div>
        <div class="nuevo-producto-fields hidden">
            <input type="text" class="form-input nuevo-producto-nombre" placeholder="Nombre del producto nuevo">
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

    const select = item.querySelector('.ingrediente-producto');
    const nuevoFields = item.querySelector('.nuevo-producto-fields');
    const syncNuevoVisibility = () => nuevoFields.classList.toggle('hidden', select.value !== PRODUCTO_NUEVO_VALUE);
    select.addEventListener('change', syncNuevoVisibility);
    syncNuevoVisibility();

    wireCategoriaSelect(item.querySelector('.nuevo-producto-categoria'), item.querySelector('.nuevo-producto-categoria-nueva'));

    item.querySelector('.btn-remove-ingrediente').addEventListener('click', () => item.remove());
    DOM.ingredientesRows.appendChild(item);
}

// Async porque, si una fila pide crear un producto nuevo, hay que esperar a que se cree
// antes de poder usar su id como ingrediente de la receta.
async function collectIngredientesFromForm() {
    const items = Array.from(DOM.ingredientesRows.querySelectorAll('.ingrediente-item'));
    const ingredientes = [];

    for (const item of items) {
        const cantidad = item.querySelector('.ingrediente-cantidad').value;
        if (!(parseFloat(cantidad) > 0)) continue;

        let productoId = item.querySelector('.ingrediente-producto').value;
        if (productoId === PRODUCTO_NUEVO_VALUE) {
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
        requiere_cocinado: DOM.inRecetaRequiereCocinado.checked,
        instrucciones: DOM.inRecetaInstrucciones.value,
        ingredientes
    };

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
