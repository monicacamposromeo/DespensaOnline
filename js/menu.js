/* ==========================================================================
   DespensaOnline - Pantalla Menú Semanal
   ========================================================================== */

function getWeekDates(weekStart) {
    return Array.from({ length: 7 }, (_, i) => addDaysToISO(weekStart, i));
}

function renderMenuSemanal() {
    const dias = getWeekDates(state.selectedWeekStart);
    DOM.weekRangeLabel.textContent = `${formatDate(dias[0])} - ${formatDate(dias[6])}`;

    let html = '<div class="menu-grid-inner">';
    html += '<div class="menu-grid-corner"></div>';
    dias.forEach((fecha, i) => {
        html += `<div class="menu-grid-day-header">${DIAS_SEMANA_LABELS[i]}<br><span class="menu-grid-day-date">${formatDate(fecha)}</span></div>`;
    });

    TIPOS_COMIDA.forEach(tipo => {
        html += `<div class="menu-grid-row-header">${TIPO_COMIDA_LABELS[tipo]}</div>`;
        dias.forEach(fecha => {
            const entrada = state.menuSemanal.find(m => m.activa && m.fecha === fecha && m.tipo_comida === tipo);
            html += menuCellHtml(fecha, tipo, entrada);
        });
    });
    html += '</div>';
    DOM.menuGrid.innerHTML = html;

    DOM.menuGrid.querySelectorAll('[data-menu-cell]').forEach(cell => {
        cell.addEventListener('click', () => {
            const { fecha, tipo } = cell.dataset;
            const entrada = state.menuSemanal.find(m => m.activa && m.fecha === fecha && m.tipo_comida === tipo);
            openMenuEntryModal(fecha, tipo, entrada);
        });
    });

    renderDayStrip();
    renderAgendaDia();
}

function menuCellHtml(fecha, tipo, entrada) {
    if (!entrada) {
        return `<div class="menu-grid-cell menu-grid-cell-empty" data-menu-cell data-fecha="${fecha}" data-tipo="${tipo}">+ Añadir</div>`;
    }
    const receta = getReceta(entrada.recetaId);
    return `
        <div class="menu-grid-cell" data-menu-cell data-fecha="${fecha}" data-tipo="${tipo}">
            <strong>${escapeHtml(receta ? receta.nombre : 'Receta eliminada')}</strong>
            <span class="menu-grid-comensales">${entrada.comensales} comensales</span>
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

function renderAgendaDia() {
    const fecha = state.selectedDayISO;
    DOM.menuAgenda.innerHTML = TIPOS_COMIDA.map(tipo => {
        const entrada = state.menuSemanal.find(m => m.activa && m.fecha === fecha && m.tipo_comida === tipo);
        const receta = entrada ? getReceta(entrada.recetaId) : null;
        const valor = receta ? escapeHtml(receta.nombre) : 'Añadir receta';
        return `<button type="button" class="meal-row" data-fecha="${fecha}" data-tipo="${tipo}">
            <span><span class="meal-label">${TIPO_COMIDA_LABELS[tipo]}</span><span class="meal-value${receta ? '' : ' empty'}">${valor}</span></span>
            <svg class="icon-sm"><use href="#ic-chev-right"/></svg>
        </button>`;
    }).join('');

    DOM.menuAgenda.querySelectorAll('[data-fecha]').forEach(row => {
        row.addEventListener('click', () => {
            const { fecha, tipo } = row.dataset;
            const entrada = state.menuSemanal.find(m => m.activa && m.fecha === fecha && m.tipo_comida === tipo);
            openMenuEntryModal(fecha, tipo, entrada);
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
    DOM.btnDeleteMenuEntry.classList.toggle('hidden', !entrada);
    DOM.modalMenuEntry.classList.remove('hidden');
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

    const result = state.editingMenuEntry
        ? await apiRequest('editar_menu_entry', 'PATCH', { id: state.editingMenuEntry, ...payload })
        : await apiRequest('menu_entry', 'POST', payload);

    if (result && result.success) {
        showToast(result.message, 'success');
        closeMenuEntryModal();
        renderMenuSemanal();
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
