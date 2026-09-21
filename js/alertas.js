/* ==========================================================================
   DespensaOnline - Alertas
   Cruza despensa + menú semanal + recetas para avisar de lo que necesita
   atención hoy: qué caduca, qué descongelar, qué cocinar y qué comprar.
   Se recalcula al vuelo (no se guarda nada); ver DOCUMENTACIÓN-TECNICA.md §9.
   ========================================================================== */

// Heurística para identificar el congelador entre las ubicaciones del usuario (no hay un
// campo "tipo" en ubicaciones, solo un nombre libre): si el nombre contiene "congel".
function esUbicacionCongelador(ubicacionId) {
    const ubicacion = getUbicacion(ubicacionId);
    return !!ubicacion && ubicacion.nombre.toLowerCase().includes('congel');
}

// Suma de necesidades de las recetas del menú en una fecha concreta, ya escaladas por
// comensales/comensales_base (mismo cálculo que generarListaCompra(), ver js/lista-compra.js).
function getNecesidadesDelDia(fecha) {
    const necesidades = {};
    state.menuSemanal
        .filter(e => e.activa && e.fecha === fecha)
        .forEach(entrada => {
            const receta = getReceta(entrada.recetaId);
            if (!receta) return;
            const factor = (parseFloat(entrada.comensales) || 1) / (parseFloat(receta.comensales_base) || 1);
            getIngredientesReceta(receta.id).forEach(ing => {
                const cantidad = (parseFloat(ing.cantidad) || 0) * factor;
                necesidades[ing.productoId] = (necesidades[ing.productoId] || 0) + cantidad;
            });
        });
    return necesidades;
}

// Las 5 alertas pedidas, ordenadas por urgencia (0 = más urgente).
function getAlertas() {
    const alertas = [];
    const hoy = todayISO();
    const manana = addDaysToISO(hoy, 1);

    // Comprar hoy: ingredientes de las recetas de HOY que no llegan con el stock actual.
    Object.entries(getNecesidadesDelDia(hoy)).forEach(([productoId, necesaria]) => {
        const faltante = round2(necesaria - getStockDisponible(productoId));
        if (faltante <= 0) return;
        const producto = getProducto(productoId);
        if (!producto) return;
        alertas.push({
            tipo: 'comprar',
            prioridad: 0,
            titulo: `Compra ${producto.nombre} para hoy`,
            detalle: `Te faltan ${formatCantidad(faltante, producto.unidad)} para el menú de hoy`
        });
    });

    // Caducado, tíralo / Va a caducar (ya calculadas en getLotesPorCaducar(), state.js).
    getLotesPorCaducar().forEach(({ lote, estado }) => {
        const producto = getProducto(lote.productoId);
        if (!producto) return;
        if (estado === 'caducado') {
            alertas.push({
                tipo: 'caducado',
                prioridad: 1,
                titulo: `${producto.nombre} ha caducado, tíralo`,
                detalle: `Caducó el ${formatDate(lote.fecha_caducidad)}`
            });
        } else {
            alertas.push({
                tipo: 'proximo',
                prioridad: 4,
                titulo: `${producto.nombre} va a caducar`,
                detalle: `Caduca el ${formatDate(lote.fecha_caducidad)}`
            });
        }
    });

    // Descongelar: ingredientes de las recetas de MAÑANA que solo tienes en el congelador.
    state.menuSemanal
        .filter(e => e.activa && e.fecha === manana)
        .forEach(entrada => {
            const receta = getReceta(entrada.recetaId);
            if (!receta) return;
            getIngredientesReceta(receta.id).forEach(ing => {
                const producto = getProducto(ing.productoId);
                if (!producto) return;
                const enCongelador = state.despensa.some(l =>
                    l.activa && String(l.productoId) === String(ing.productoId) && esUbicacionCongelador(l.ubicacionId)
                );
                if (!enCongelador) return;
                alertas.push({
                    tipo: 'descongelar',
                    prioridad: 2,
                    titulo: `Descongela ${producto.nombre}`,
                    detalle: `Lo necesitas mañana para ${receta.nombre} (${TIPO_COMIDA_LABELS[entrada.tipo_comida] || entrada.tipo_comida})`
                });
            });
        });

    // Cocinar hoy: recordatorio de lo planificado para hoy, usando recetaRequierePrecocinado()
    // (js/state.js), que combina el interruptor general de la receta (platos que se cocinan
    // como un conjunto: guisos, arroces...) con el de cada ingrediente (recetas de montar
    // donde solo una parte necesita cocinarse aparte, p. ej. el arroz de unas fajitas).
    state.menuSemanal
        .filter(e => e.activa && e.fecha === hoy)
        .forEach(entrada => {
            const receta = getReceta(entrada.recetaId);
            if (!receta || !recetaRequierePrecocinado(receta)) return;

            const comida = TIPO_COMIDA_LABELS[entrada.tipo_comida] || entrada.tipo_comida;
            let detalle = comida;
            if (receta.requiere_cocinado === false) {
                // El plato completo no lleva marca general: lo que dispara la alerta son
                // ingredientes concretos, así que merece la pena decir cuáles.
                const ingredientesACocinar = getIngredientesReceta(receta.id)
                    .filter(ing => ing.requiere_cocinado === true)
                    .map(ing => getProducto(ing.productoId)?.nombre)
                    .filter(Boolean);
                if (ingredientesACocinar.length > 0) detalle = `${comida} · Precocina: ${ingredientesACocinar.join(', ')}`;
            }

            alertas.push({
                tipo: 'cocinar',
                prioridad: 3,
                titulo: `Hoy toca cocinar ${receta.nombre}`,
                detalle
            });
        });

    return alertas.sort((a, b) => a.prioridad - b.prioridad);
}

function alertaClaseCss(tipo) {
    if (tipo === 'comprar' || tipo === 'caducado') return 'alert-danger';
    if (tipo === 'cocinar') return 'alert-info';
    return 'alert-warn'; // descongelar, proximo
}

function alertaRowHtml(alerta) {
    return `
        <div class="alert-strip ${alertaClaseCss(alerta.tipo)}">
            <strong>${escapeHtml(alerta.titulo)}</strong>
            <span class="alerta-detalle">${escapeHtml(alerta.detalle)}</span>
        </div>
    `;
}

function renderAlertasBadge() {
    if (!DOM.alertasBadge) return;
    const total = getAlertas().length;
    DOM.alertasBadge.textContent = total > 9 ? '9+' : String(total);
    DOM.alertasBadge.classList.toggle('hidden', total === 0);
}

function openAlertasModal() {
    const alertas = getAlertas();
    DOM.alertasList.innerHTML = alertas.length > 0
        ? alertas.map(alertaRowHtml).join('')
        : '<p class="empty-state-inline">No tienes alertas pendientes. Todo en orden.</p>';
    DOM.modalAlertas.classList.remove('hidden');
}

function closeAlertasModal() {
    DOM.modalAlertas.classList.add('hidden');
}
