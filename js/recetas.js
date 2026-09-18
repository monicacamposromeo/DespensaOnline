/* ==========================================================================
   DespensaOnline - Pantalla Recetas
   ========================================================================== */

function renderRecetas() {
    const categoria = state.recetasFiltro.categoria;
    const recetasActivas = state.recetas.filter(r => r.activa);
    const recetasFiltradas = recetasActivas
        .filter(r => categoria === 'todas' || r.categoria === categoria)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

    DOM.recetasEmpty.classList.toggle('hidden', recetasActivas.length > 0);

    if (recetasActivas.length > 0 && recetasFiltradas.length === 0) {
        DOM.recetasList.innerHTML = '<p class="empty-state-inline">No hay recetas en esta categoría.</p>';
    } else {
        DOM.recetasList.innerHTML = recetasFiltradas.map(recetaCardHtml).join('');
    }

    DOM.recetasList.querySelectorAll('[data-receta-id]').forEach(card => {
        card.addEventListener('click', () => {
            const receta = getReceta(card.dataset.recetaId);
            if (receta) openRecetaModal(receta);
        });
    });
}

function recetaCardHtml(receta) {
    const nombresIngredientes = getIngredientesReceta(receta.id)
        .map(ri => getProducto(ri.productoId)?.nombre)
        .filter(Boolean)
        .join(', ');

    const meta = [
        receta.tiempo_preparacion_min ? `${receta.tiempo_preparacion_min} min` : null,
        `${receta.comensales_base} comensales`
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
    if (state.productos.filter(p => p.activa).length === 0) {
        showToast('Primero debes crear al menos un producto en Configuración.', 'error');
        return;
    }
    state.editingRecetaId = receta ? receta.id : null;
    DOM.modalRecetaTitle.textContent = receta ? 'Editar receta' : 'Nueva receta';
    DOM.inRecetaId.value = receta ? receta.id : '';
    DOM.inRecetaNombre.value = receta ? receta.nombre : '';
    DOM.inRecetaCategoria.value = receta ? receta.categoria : 'comida';
    DOM.inRecetaTiempo.value = receta ? (receta.tiempo_preparacion_min || '') : '';
    DOM.inRecetaComensales.value = receta ? receta.comensales_base : 2;
    DOM.inRecetaInstrucciones.value = receta ? (receta.instrucciones || '') : '';
    DOM.btnDeleteReceta.classList.toggle('hidden', !receta);

    DOM.ingredientesRows.innerHTML = '';
    const ingredientes = receta ? getIngredientesReceta(receta.id) : [];
    if (ingredientes.length > 0) {
        ingredientes.forEach(ing => addIngredienteRow(ing.productoId, ing.cantidad));
    } else {
        addIngredienteRow();
    }

    DOM.modalReceta.classList.remove('hidden');
}

function closeRecetaModal() {
    DOM.modalReceta.classList.add('hidden');
    state.editingRecetaId = null;
}

function addIngredienteRow(productoId = null, cantidad = '') {
    const row = document.createElement('div');
    row.className = 'ingrediente-row';

    const options = state.productos
        .filter(p => p.activa)
        .map(p => `<option value="${p.id}" ${String(p.id) === String(productoId) ? 'selected' : ''}>${escapeHtml(p.nombre)} (${escapeHtml(p.unidad)})</option>`)
        .join('');

    row.innerHTML = `
        <select class="form-select ingrediente-producto">${options}</select>
        <input type="number" class="form-input ingrediente-cantidad" min="0" step="0.01" placeholder="Cantidad" value="${cantidad}">
        <button type="button" class="btn-icon-only btn-remove-ingrediente" title="Quitar ingrediente">×</button>
    `;
    row.querySelector('.btn-remove-ingrediente').addEventListener('click', () => row.remove());
    DOM.ingredientesRows.appendChild(row);
}

function collectIngredientesFromForm() {
    return Array.from(DOM.ingredientesRows.querySelectorAll('.ingrediente-row'))
        .map(row => ({
            productoId: row.querySelector('.ingrediente-producto').value,
            cantidad: row.querySelector('.ingrediente-cantidad').value
        }))
        .filter(ing => ing.productoId && parseFloat(ing.cantidad) > 0);
}

async function handleRecetaFormSubmit(e) {
    e.preventDefault();
    const ingredientes = collectIngredientesFromForm();
    if (ingredientes.length === 0) {
        showToast('Añade al menos un ingrediente con cantidad mayor que 0.', 'error');
        return;
    }

    const payload = {
        nombre: DOM.inRecetaNombre.value,
        categoria: DOM.inRecetaCategoria.value,
        tiempo_preparacion_min: DOM.inRecetaTiempo.value || null,
        comensales_base: DOM.inRecetaComensales.value,
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
