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
        const nota = getNotaDia(fecha);
        html += `<div class="menu-grid-day-header${claseHoy}">${DIAS_SEMANA_LABELS[i]}<br><span class="menu-grid-day-date">${formatDate(fecha)}</span>
            <button type="button" class="menu-nota-btn${nota ? ' has-nota' : ''}" data-nota-fecha="${fecha}" title="${escapeHtml(nota || 'Añadir nota')}">${nota ? escapeHtml(nota) : '+ Nota'}</button></div>`;
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
    DOM.menuGrid.querySelectorAll('[data-nota-fecha]').forEach(btn => {
        btn.addEventListener('click', () => openNotaDiaModal(btn.dataset.notaFecha));
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
        const clases = ['daychip', fecha === hoy ? 'today' : '', fecha === state.selectedDayISO ? 'active' : '', getNotaDia(fecha) ? 'has-nota' : ''].filter(Boolean).join(' ');
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
    const nota = getNotaDia(fecha);
    const notaHtml = `<button type="button" class="meal-row nota-row${nota ? ' has-nota' : ''}" data-nota-fecha="${fecha}">
            <span class="meal-value${nota ? '' : ' empty'}">${nota ? escapeHtml(nota) : 'Añadir nota del día'}</span>
            <svg class="icon-sm"><use href="#ic-chev-right"/></svg>
        </button>`;
    DOM.menuAgenda.innerHTML = notaHtml + TIPOS_COMIDA.map(tipo => {
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

    DOM.menuAgenda.querySelectorAll('[data-nota-fecha]').forEach(row => {
        row.addEventListener('click', () => openNotaDiaModal(row.dataset.notaFecha));
    });
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

// Hueco vacío: primero se elige la receta en el selector y después se abre el formulario ya
// con ella (comensales, etc.). Plato ya planificado: el formulario se abre directamente y la
// receta se cambia con el botón "Cambiar".
function openMenuEntryModal(fecha, tipoComida, entrada = null) {
    if (state.recetas.filter(r => r.activa).length === 0) {
        showToast('Primero debes crear al menos una receta.', 'error');
        return;
    }
    if (entrada) {
        mostrarMenuEntryModal(fecha, tipoComida, entrada, null);
        return;
    }
    abrirSelectorReceta(tipoComida, recetaId => mostrarMenuEntryModal(fecha, tipoComida, null, recetaId));
}

// Selector de receta de una sola elección. "Últimas para <comida>": las recetas que ya se
// han puesto en ese tipo de comida, las más recientes primero.
function abrirSelectorReceta(tipoComida, onElegida) {
    const ultimas = [];
    state.menuSemanal
        .filter(m => m.activa && m.tipo_comida === tipoComida)
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
        .forEach(m => {
            const id = String(m.recetaId);
            if (!ultimas.includes(id) && getReceta(id)?.activa) ultimas.push(id);
        });

    abrirSelector({
        titulo: `Elegir receta · ${TIPO_COMIDA_LABELS[tipoComida]}`,
        items: state.recetas.filter(r => r.activa).map(r => ({
            id: r.id,
            nombre: r.nombre,
            categoria: CATEGORIA_RECETA_LABELS[r.categoria] || r.categoria,
            meta: [r.tiempo_preparacion_min ? `${r.tiempo_preparacion_min} min` : null, `${r.comensales_base} comensales`].filter(Boolean).join(' · ')
        })),
        recientes: ultimas.slice(0, 8),
        recientesLabel: `Últimas para ${TIPO_COMIDA_LABELS[tipoComida].toLowerCase()}`,
        multi: false,
        onConfirm: seleccion => onElegida([...seleccion.keys()][0])
    });
}

// Muestra en el botón del formulario la receta que hay en el <select> oculto.
function actualizarRecetaElegidaMenuEntry() {
    const receta = getReceta(DOM.inMenuEntryReceta.value);
    DOM.menuEntryRecetaNombre.textContent = receta ? receta.nombre : 'Elige una receta';
    DOM.menuEntryRecetaMeta.textContent = receta
        ? [CATEGORIA_RECETA_LABELS[receta.categoria] || receta.categoria, `${receta.comensales_base} comensales base`].join(' · ')
        : '';
}

function handleCambiarRecetaMenuEntry() {
    abrirSelectorReceta(DOM.inMenuEntryTipo.value, recetaId => {
        DOM.inMenuEntryReceta.value = recetaId;
        // El mismo evento de siempre: ajusta comensales, precocinado y descongelados.
        DOM.inMenuEntryReceta.dispatchEvent(new Event('change'));
    });
}

function mostrarMenuEntryModal(fecha, tipoComida, entrada, recetaIdInicial) {
    state.editingMenuEntry = entrada ? entrada.id : null;
    DOM.modalMenuEntryTitle.textContent = `${TIPO_COMIDA_LABELS[tipoComida]} · ${formatDate(fecha)}`;
    DOM.inMenuEntryId.value = entrada ? entrada.id : '';
    DOM.inMenuEntryFecha.value = fecha;
    DOM.inMenuEntryTipo.value = tipoComida;
    DOM.inMenuEntryReceta.value = entrada ? entrada.recetaId : recetaIdInicial;
    actualizarRecetaElegidaMenuEntry();
    DOM.inMenuEntryComensales.value = entrada ? entrada.comensales : (getReceta(DOM.inMenuEntryReceta.value)?.comensales_base || 2);
    DOM.inMenuEntryUsaTupper.checked = !!(entrada && entrada.usa_tupper);
    actualizarTupperMenuEntry();
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
    // Receta tal y como se va a preparar según el formulario (con o sin tupper): con tupper,
    // el único "ingrediente" es el producto-tupper.
    const receta = aplicarUsoTupper(getReceta(DOM.inMenuEntryReceta.value), tupperMarcadoEnFormulario());
    // Las marcas guardadas solo valen si no cambió ni la receta ni el uso del tupper.
    const mismaReceta = entrada && receta && String(entrada.recetaId) === String(receta.id)
        && !!entrada.usa_tupper === !!receta._tupperProductoId;
    const marcados = mismaReceta ? getDescongeladosEntrada(entrada) : [];

    const vistos = new Set();
    const candidatos = entrada && receta
        ? getIngredientesEfectivos(receta)
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
// Con "Usar tupper congelado" marcado no hay nada que precocinar.
function updateMenuEntryPrecocinadoVisibility() {
    const receta = aplicarUsoTupper(getReceta(DOM.inMenuEntryReceta.value), tupperMarcadoEnFormulario());
    const visible = !!state.editingMenuEntry && recetaRequierePrecocinado(receta);
    DOM.menuEntryPrecocinadoField.classList.toggle('hidden', !visible);
}

// ¿Está marcada (y visible) la casilla "Usar tupper congelado" del formulario?
function tupperMarcadoEnFormulario() {
    return !DOM.menuEntryTupperField.classList.contains('hidden') && DOM.inMenuEntryUsaTupper.checked;
}

// La casilla solo aparece si la receta tiene producto-tupper (enlazado en la receta o ya
// existente con su nombre + "congelado"/"tupper"). El aviso dice cuántos tuppers hay, y si
// la casilla está marcada y no llegan para los comensales, cuántos faltan.
function actualizarTupperMenuEntry() {
    const receta = getReceta(DOM.inMenuEntryReceta.value);
    const producto = receta && getProductoTupper(receta);
    DOM.menuEntryTupperField.classList.toggle('hidden', !producto);
    if (!producto) {
        DOM.inMenuEntryUsaTupper.checked = false;
        DOM.menuEntryTupperHint.textContent = '';
        return;
    }
    const total = getStockDisponible(producto.id);
    const congelados = getLotesCongelados(producto.id).reduce((s, l) => s + (parseFloat(l.cantidad) || 0), 0);
    const comensales = parseFloat(DOM.inMenuEntryComensales.value) || 0;
    let texto = total > 0
        ? `Tienes ${round2(total)} tupper${total === 1 ? '' : 's'} de «${producto.nombre}»${congelados > 0 ? ` (${round2(congelados)} en el congelador)` : ''}.`
        : `No tienes ningún tupper de «${producto.nombre}» apuntado.`;
    if (DOM.inMenuEntryUsaTupper.checked) {
        texto += ' Se gasta 1 por comensal y no hay que cocinar ni comprar nada.';
        if (total < comensales) texto += ` Te faltan ${round2(comensales - total)} para ${comensales} comensales.`;
    }
    DOM.menuEntryTupperHint.textContent = texto;
}

// Texto "· precocinado" (o "· tupper congelado") junto al plato en la rejilla/agenda.
function precocinadoSufijo(entrada, receta) {
    if (entrada.usa_tupper === true && getProductoTupper(receta)) return ' · tupper congelado';
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
    const entradaActual = entradaId ? state.menuSemanal.find(m => m.id == entradaId) : null;
    // Solo se envía si se usa (o se estaba usando): así, si nunca se usa, no hace falta que
    // exista la columna menu_semanal.usa_tupper en la base de datos.
    const usaTupper = tupperMarcadoEnFormulario();
    if (usaTupper || (entradaActual && entradaActual.usa_tupper)) payload.usa_tupper = usaTupper;
    let nuevosDescongelados = [];
    let recienPrecocinado = false;
    if (entradaId) {
        // Si la casilla no se ve (la receta nueva no requiere precocinado) y la entrada estaba
        // marcada, se desmarca: la marca era de la receta anterior.
        const entrada = state.menuSemanal.find(m => m.id == entradaId);
        if (!DOM.menuEntryPrecocinadoField.classList.contains('hidden')) payload.precocinado = DOM.inMenuEntryPrecocinado.checked;
        else if (entrada && entrada.precocinado) payload.precocinado = false;
        recienPrecocinado = payload.precocinado === true && !(entrada && entrada.precocinado);

        // Descongelados: lo que quede marcado en las casillas (se puede desmarcar). Los recién
        // marcados, además, abren tras guardar la ventana de paquetes (abrirModalDescongelar()).
        const mismaReceta = entrada && String(entrada.recetaId) === String(payload.recetaId)
            && !!entrada.usa_tupper === usaTupper; // al cambiar de receta o de tupper, las marcas no valen
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
        showToast(result.message, 'success');
        renderMenuSemanal();
        // Los recién marcados ya están guardados; falta elegir qué paquetes salen del congelador.
        if (nuevosDescongelados.length > 0) abrirModalDescongelar(entradaId, nuevosDescongelados, { yaGuardado: true });
        // Guiso de fin de semana recién marcado como precocinado: apuntar sus tuppers (js/tuppers.js).
        if (recienPrecocinado) abrirModalTuppers(entradaId);
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

/* ==========================================================================
   Notas por día ("fuera todo el día", "no cenamos en casa"...): tabla `notas_menu`
   (fecha PK, texto), en state.notasMenu. Ver DOCUMENTACIÓN-TECNICA.md §3.
   ========================================================================== */
function getNotaDia(fecha) {
    const nota = state.notasMenu.find(n => n.fecha === fecha);
    return nota ? nota.texto.trim() : '';
}

function openNotaDiaModal(fecha) {
    const nota = getNotaDia(fecha);
    state.editingNotaFecha = fecha;
    DOM.modalNotaDiaTitle.textContent = `Nota · ${formatDate(fecha)}`;
    DOM.inNotaDia.value = nota;
    DOM.btnDeleteNotaDia.classList.toggle('hidden', !nota);
    DOM.modalNotaDia.classList.remove('hidden');
    DOM.inNotaDia.focus();
}

function closeNotaDiaModal() {
    DOM.modalNotaDia.classList.add('hidden');
    state.editingNotaFecha = null;
}

async function guardarNotaDia(texto, mensaje) {
    const fecha = state.editingNotaFecha;
    if (!fecha) return;
    const result = texto
        ? await apiRequest('nota_menu', 'POST', { fecha, texto })
        : await apiRequest('eliminar_nota_menu', 'DELETE', { fecha });
    if (result && result.success) {
        closeNotaDiaModal();
        showToast(mensaje, 'success');
        renderMenuSemanal();
    } else {
        showToast(result?.error || 'No se pudo guardar la nota (¿falta la tabla "notas_menu" en Supabase?)', 'error');
    }
}

function handleNotaDiaSubmit(e) {
    e.preventDefault();
    const texto = DOM.inNotaDia.value.trim();
    return guardarNotaDia(texto, texto ? 'Nota guardada' : 'Nota borrada');
}

function handleDeleteNotaDia() {
    return guardarNotaDia('', 'Nota borrada');
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
