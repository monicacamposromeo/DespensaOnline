/* ==========================================================================
   DespensaOnline - Pantalla Menú Semanal
   ========================================================================== */

function getWeekDates(weekStart) {
    return Array.from({ length: 7 }, (_, i) => addDaysToISO(weekStart, i));
}

function renderMenuSemanal() {
    const dias = getWeekDates(state.selectedWeekStart);
    const hoy = todayISO();
    DOM.weekRangeLabel.textContent = `${formatDate(dias[0])} - ${formatDate(dias[6])}`;

    let html = '<div class="menu-grid-inner">';
    html += '<div class="menu-grid-corner"></div>';
    dias.forEach((fecha, i) => {
        const claseHoy = fecha === hoy ? ' today' : '';
        html += `<div class="menu-grid-day-header${claseHoy}">${DIAS_SEMANA_LABELS[i]}<br><span class="menu-grid-day-date">${formatDate(fecha)}</span></div>`;
    });

    TIPOS_COMIDA.forEach(tipo => {
        html += `<div class="menu-grid-row-header">${TIPO_COMIDA_LABELS[tipo]}</div>`;
        dias.forEach(fecha => {
            const entradas = state.menuSemanal.filter(m => m.activa && m.fecha === fecha && m.tipo_comida === tipo);
            html += menuCellHtml(fecha, tipo, entradas);
        });
    });
    html += '</div>';
    DOM.menuGrid.innerHTML = html;

    DOM.menuGrid.querySelectorAll('[data-menu-add]').forEach(btn => {
        btn.addEventListener('click', () => openMenuEntryModal(btn.dataset.fecha, btn.dataset.tipo, null));
    });
    DOM.menuGrid.querySelectorAll('[data-entrada-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const entrada = state.menuSemanal.find(m => String(m.id) === btn.dataset.entradaId);
            if (entrada) openMenuEntryModal(entrada.fecha, entrada.tipo_comida, entrada);
        });
    });

    renderDayStrip();
    renderAgendaDia();
    renderAlertasBadge();
}

// Un hueco (fecha+comida) puede tener varios platos asignados (varios comensales comiendo
// cosas distintas, o primer y segundo plato): entradas es un array, no una única entrada.
function menuCellHtml(fecha, tipo, entradas) {
    if (entradas.length === 0) {
        return `<button type="button" class="menu-grid-cell menu-grid-cell-empty" data-menu-add data-fecha="${fecha}" data-tipo="${tipo}">+ Añadir</button>`;
    }
    const platos = entradas.map(entrada => {
        const receta = getReceta(entrada.recetaId);
        const nombre = receta ? receta.nombre : 'Receta eliminada';
        return `
            <button type="button" class="menu-grid-entry" data-entrada-id="${entrada.id}">
                <strong title="${escapeHtml(nombre)}">${escapeHtml(nombre)}</strong>
                <span class="menu-grid-comensales">${entrada.comensales} comensales${precocinadoSufijo(entrada, receta)}</span>
            </button>
        `;
    }).join('');
    return `
        <div class="menu-grid-cell">
            ${platos}
            <button type="button" class="menu-grid-add-more" data-menu-add data-fecha="${fecha}" data-tipo="${tipo}">+ Añadir plato</button>
        </div>
    `;
}

/* ==========================================================================
   Vista móvil: un día a la vez (tira de fechas + agenda de comidas del día)
   ========================================================================== */
function renderDayStrip() {
    const dias = getWeekDates(state.selectedWeekStart);
    const hoy = todayISO();

    DOM.menuDaystrip.innerHTML = dias.map((fecha, i) => {
        const dia = parseInt(fecha.split('-')[2], 10);
        const clases = ['daychip', fecha === hoy ? 'today' : '', fecha === state.selectedDayISO ? 'active' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${clases}" data-fecha="${fecha}">
            <span class="dow">${DIAS_SEMANA_LABELS[i].slice(0, 3)}</span><span class="num">${dia}</span>
        </button>`;
    }).join('');

    DOM.menuDaystrip.querySelectorAll('[data-fecha]').forEach(chip => {
        chip.addEventListener('click', () => {
            state.selectedDayISO = chip.dataset.fecha;
            renderDayStrip();
            renderAgendaDia();
        });
    });
}

// Un encabezado por comida (Desayuno/Comida/Cena) con una fila por plato asignado ese
// día (puede haber varios) y un enlace para añadir otro más al mismo hueco.
function renderAgendaDia() {
    const fecha = state.selectedDayISO;
    DOM.menuAgenda.innerHTML = TIPOS_COMIDA.map(tipo => {
        const entradas = state.menuSemanal.filter(m => m.activa && m.fecha === fecha && m.tipo_comida === tipo);

        const platos = entradas.length > 0
            ? entradas.map(entrada => {
                const receta = getReceta(entrada.recetaId);
                return `<button type="button" class="meal-row" data-entrada-id="${entrada.id}">
                    <span class="meal-value">${escapeHtml(receta ? receta.nombre : 'Receta eliminada')}${precocinadoSufijo(entrada, receta)}</span>
                    <svg class="icon-sm"><use href="#ic-chev-right"/></svg>
                </button>`;
            }).join('')
            : `<button type="button" class="meal-row" data-fecha="${fecha}" data-tipo="${tipo}">
                <span class="meal-value empty">Añadir receta</span>
                <svg class="icon-sm"><use href="#ic-chev-right"/></svg>
            </button>`;

        const addMas = entradas.length > 0
            ? `<button type="button" class="text-btn meal-add-mas" data-fecha="${fecha}" data-tipo="${tipo}">+ Añadir otro plato</button>`
            : '';

        return `<h3 class="section-subtitle">${TIPO_COMIDA_LABELS[tipo]}</h3>${platos}${addMas}`;
    }).join('');

    DOM.menuAgenda.querySelectorAll('[data-entrada-id]').forEach(row => {
        row.addEventListener('click', () => {
            const entrada = state.menuSemanal.find(m => String(m.id) === row.dataset.entradaId);
            if (entrada) openMenuEntryModal(entrada.fecha, entrada.tipo_comida, entrada);
        });
    });
    DOM.menuAgenda.querySelectorAll('[data-fecha]').forEach(row => {
        row.addEventListener('click', () => {
            const { fecha, tipo } = row.dataset;
            openMenuEntryModal(fecha, tipo, null);
        });
    });
}

function openMenuEntryModal(fecha, tipoComida, entrada = null) {
    if (state.recetas.filter(r => r.activa).length === 0) {
        showToast('Primero debes crear al menos una receta.', 'error');
        return;
    }
    state.editingMenuEntry = entrada ? entrada.id : null;
    DOM.modalMenuEntryTitle.textContent = `${TIPO_COMIDA_LABELS[tipoComida]} · ${formatDate(fecha)}`;
    DOM.inMenuEntryId.value = entrada ? entrada.id : '';
    DOM.inMenuEntryFecha.value = fecha;
    DOM.inMenuEntryTipo.value = tipoComida;
    DOM.inMenuEntryReceta.value = entrada ? entrada.recetaId : (state.recetas.find(r => r.activa)?.id || '');
    DOM.inMenuEntryComensales.value = entrada ? entrada.comensales : (getReceta(DOM.inMenuEntryReceta.value)?.comensales_base || 2);
    DOM.inMenuEntryPrecocinado.checked = !!(entrada && entrada.precocinado);
    updateMenuEntryPrecocinadoVisibility();
    renderMenuEntryDescongelados();
    DOM.btnDeleteMenuEntry.classList.toggle('hidden', !entrada);
    DOM.modalMenuEntry.classList.remove('hidden');
}

// Casillas "Ya descongelado" por ingrediente (menu_semanal.descongelados), solo al editar
// un plato ya planificado: se listan los ingredientes de la receta elegida que tienes en el
// congelador (getLotesCongelados(), js/alertas.js) o que ya estaban marcados. Si se cambia
// de receta en el modal, las marcas anteriores no valen y salen todas desmarcadas.
function renderMenuEntryDescongelados() {
    const entrada = state.menuSemanal.find(m => m.id == state.editingMenuEntry);
    const receta = getReceta(DOM.inMenuEntryReceta.value);
    const mismaReceta = entrada && receta && String(entrada.recetaId) === String(receta.id);
    const marcados = mismaReceta ? getDescongeladosEntrada(entrada) : [];

    const vistos = new Set();
    const candidatos = entrada && receta
        ? getIngredientesReceta(receta.id)
            .map(ing => getProducto(ing.productoId))
            .filter(p => {
                if (!p || vistos.has(String(p.id))) return false;
                vistos.add(String(p.id));
                return marcados.includes(String(p.id)) || getLotesCongelados(p.id).length > 0;
            })
        : [];

    DOM.menuEntryDescongeladosField.classList.toggle('hidden', candidatos.length === 0);
    DOM.menuEntryDescongeladosList.innerHTML = candidatos.map(p => `
        <label class="checkbox-field">
            <input type="checkbox" value="${p.id}" data-descongelado-check ${marcados.includes(String(p.id)) ? 'checked' : ''}>
            Ya descongelado: ${escapeHtml(p.nombre)}
        </label>
    `).join('');
}

// "Ya lo he precocinado" solo tiene sentido al editar un plato ya planificado cuya receta
// requiera precocinado (recetaRequierePrecocinado(), js/state.js).
function updateMenuEntryPrecocinadoVisibility() {
    const visible = !!state.editingMenuEntry && recetaRequierePrecocinado(getReceta(DOM.inMenuEntryReceta.value));
    DOM.menuEntryPrecocinadoField.classList.toggle('hidden', !visible);
}

// Texto "· precocinado" junto al plato en la rejilla/agenda cuando ya se marcó.
function precocinadoSufijo(entrada, receta) {
    return entrada.precocinado && recetaRequierePrecocinado(receta) ? ' · precocinado' : '';
}

function closeMenuEntryModal() {
    DOM.modalMenuEntry.classList.add('hidden');
    state.editingMenuEntry = null;
}

async function handleMenuEntryFormSubmit(e) {
    e.preventDefault();
    const payload = {
        fecha: DOM.inMenuEntryFecha.value,
        tipo_comida: DOM.inMenuEntryTipo.value,
        recetaId: DOM.inMenuEntryReceta.value,
        comensales: DOM.inMenuEntryComensales.value
    };
    const entradaId = state.editingMenuEntry;
    let nuevosDescongelados = [];
    if (entradaId) {
        // Si la casilla no se ve (la receta nueva no requiere precocinado) y la entrada estaba
        // marcada, se desmarca: la marca era de la receta anterior.
        const entrada = state.menuSemanal.find(m => m.id == entradaId);
        if (!DOM.menuEntryPrecocinadoField.classList.contains('hidden')) payload.precocinado = DOM.inMenuEntryPrecocinado.checked;
        else if (entrada && entrada.precocinado) payload.precocinado = false;

        // Descongelados: lo que quede marcado en las casillas (se puede desmarcar). Los recién
        // marcados, además, pasan sus lotes a la Nevera tras guardar (marcarDescongelado()).
        const mismaReceta = entrada && String(entrada.recetaId) === String(payload.recetaId);
        const antes = entrada && mismaReceta ? getDescongeladosEntrada(entrada) : [];
        const marcados = [...DOM.menuEntryDescongeladosList.querySelectorAll('[data-descongelado-check]:checked')].map(cb => cb.value);
        if (!DOM.menuEntryDescongeladosField.classList.contains('hidden')) payload.descongelados = marcados;
        else if (entrada && getDescongeladosEntrada(entrada).length > 0 && !mismaReceta) payload.descongelados = [];
        nuevosDescongelados = marcados.filter(id => !antes.includes(id));
    }

    const result = entradaId
        ? await apiRequest('editar_menu_entry', 'PATCH', { id: entradaId, ...payload })
        : await apiRequest('menu_entry', 'POST', payload);

    if (result && result.success) {
        closeMenuEntryModal();
        if (nuevosDescongelados.length > 0) {
            await marcarDescongelado(entradaId, nuevosDescongelados, { yaGuardado: true }); // su propio toast y repintado
        } else {
            showToast(result.message, 'success');
            renderMenuSemanal();
        }
    } else {
        showToast(result?.error || 'Error al guardar', 'error');
    }
}

async function handleDeleteMenuEntry() {
    if (!state.editingMenuEntry) return;
    const result = await apiRequest('eliminar_menu_entry', 'DELETE', { id: state.editingMenuEntry });
    if (result && result.success) {
        showToast(result.message, 'success');
        closeMenuEntryModal();
        renderMenuSemanal();
    }
}

function goToWeek(offsetWeeks) {
    state.selectedWeekStart = addDaysToISO(state.selectedWeekStart, offsetWeeks * 7);
    state.selectedDayISO = addDaysToISO(state.selectedDayISO, offsetWeeks * 7);
    renderMenuSemanal();
}

function goToCurrentWeek() {
    state.selectedWeekStart = getMonday(new Date());
    state.selectedDayISO = todayISO();
    renderMenuSemanal();
}
