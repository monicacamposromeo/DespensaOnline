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

// El viernes anterior a una fecha (estrictamente anterior: si la fecha ya es viernes,
// se toma el de la semana previa, no ella misma), usado por la alerta "Precocina con
// tiempo" para saber desde cuándo empezar a avisar (ver getAlertas() más abajo).
function viernesAnteriorA(fechaISO) {
    const d = new Date(fechaISO + 'T00:00:00');
    const dow = d.getDay(); // 0 = domingo ... 5 = viernes ... 6 = sábado
    let diff = (dow - 5 + 7) % 7;
    if (diff === 0) diff = 7;
    d.setDate(d.getDate() - diff);
    return formatISODate(d);
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

// Las 6 alertas pedidas, ordenadas por urgencia (0 = más urgente).
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
            fecha: hoy,
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
                fecha: lote.fecha_caducidad,
                titulo: `${producto.nombre} ha caducado, tíralo`,
                detalle: `Caducó el ${formatDate(lote.fecha_caducidad)}`
            });
        } else {
            alertas.push({
                tipo: 'proximo',
                prioridad: 4,
                fecha: lote.fecha_caducidad,
                titulo: `${producto.nombre} va a caducar`,
                detalle: `Caduca el ${formatDate(lote.fecha_caducidad)}`
            });
        }
    });

    // Descongelar: ingredientes de las recetas de MAÑANA que solo tienes en el congelador.
    // Un lote marcado "no_requiere_descongelar" (p. ej. verdura que se cocina congelada) no
    // cuenta para esta alerta, aunque esté en el congelador.
    state.menuSemanal
        .filter(e => e.activa && e.fecha === manana)
        .forEach(entrada => {
            const receta = getReceta(entrada.recetaId);
            if (!receta) return;
            getIngredientesReceta(receta.id).forEach(ing => {
                const producto = getProducto(ing.productoId);
                if (!producto) return;
                const enCongelador = state.despensa.some(l =>
                    l.activa && String(l.productoId) === String(ing.productoId) && esUbicacionCongelador(l.ubicacionId) && !l.no_requiere_descongelar
                );
                if (!enCongelador) return;
                alertas.push({
                    tipo: 'descongelar',
                    prioridad: 2,
                    fecha: manana,
                    tipoComida: entrada.tipo_comida,
                    titulo: `Descongela ${producto.nombre}`,
                    detalle: `Lo necesitas mañana para ${receta.nombre} (${TIPO_COMIDA_LABELS[entrada.tipo_comida] || entrada.tipo_comida})`
                });
            });
        });

    // Precocina con tiempo: solo para recetas futuras cuyo interruptor GENERAL de precocinado
    // esté activo (receta.requiere_cocinado !== false, §3) — un guiso/plato conjunto que
    // conviene ir dejando hecho durante el fin de semana. Avisa desde el viernes anterior a
    // la fecha del menú, no solo el día antes. Si lo que requiere precocinado es solo algún
    // ingrediente concreto (general desmarcado), no hace falta avisar con tanta antelación:
    // basta con el aviso del mismo día que ya da "Cocinar hoy" más abajo, que además lista
    // qué ingredientes son. El propio día de la receta también lo cubre esa alerta, así que
    // aquí solo se avisa mientras aún falta al menos un día.
    state.menuSemanal
        .filter(e => e.activa && e.fecha > hoy)
        .forEach(entrada => {
            const receta = getReceta(entrada.recetaId);
            if (!receta || receta.requiere_cocinado === false) return;
            if (hoy < viernesAnteriorA(entrada.fecha)) return;

            const comida = TIPO_COMIDA_LABELS[entrada.tipo_comida] || entrada.tipo_comida;
            alertas.push({
                tipo: 'precocinar',
                prioridad: 5,
                fecha: entrada.fecha,
                tipoComida: entrada.tipo_comida,
                titulo: `Precocina con tiempo ${receta.nombre}`,
                detalle: `Lo necesitas el ${formatDate(entrada.fecha)} (${comida})`
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
            const factor = (parseFloat(entrada.comensales) || 1) / (parseFloat(receta.comensales_base) || 1);
            let titulo = `Hoy toca cocinar ${receta.nombre}`;
            let detalle = comida;
            if (receta.requiere_cocinado === false) {
                // El plato completo no lleva marca general: lo que dispara la alerta son
                // ingredientes concretos, así que el título dice cuáles y cuánto, y el
                // detalle pasa a mostrar la receta (ya no hace falta repetirla en el título).
                const ingredientesACocinar = getIngredientesReceta(receta.id)
                    .filter(ing => ing.requiere_cocinado === true)
                    .map(ing => {
                        const producto = getProducto(ing.productoId);
                        if (!producto) return null;
                        const cantidad = (parseFloat(ing.cantidad) || 0) * factor;
                        return `${formatCantidad(cantidad, producto.unidad)} ${producto.nombre}`;
                    })
                    .filter(Boolean);
                if (ingredientesACocinar.length > 0) {
                    titulo = `Hoy toca cocinar ${ingredientesACocinar.join(', ')}`;
                    detalle = `${comida} · ${receta.nombre}`;
                }
            }

            alertas.push({
                tipo: 'cocinar',
                prioridad: 3,
                fecha: hoy,
                tipoComida: entrada.tipo_comida,
                titulo,
                detalle
            });
        });

    return alertas.sort(compararAlertas);
}

// Orden de las alertas: prioridad primero; dentro de la misma prioridad, lo de HOY antes
// que lo de otros días (p. ej. entre varios lotes "Va a caducar" con la misma prioridad,
// el que caduca hoy sube por delante del que caduca dentro de dos días); y dentro de lo de
// hoy, por tipo de comida en su orden natural (desayuno, comida, cena) usando TIPOS_COMIDA
// (js/state.js) — así varios platos de "Hoy toca cocinar" salen en el orden en que se comen.
function compararAlertas(a, b) {
    if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;

    const hoy = todayISO();
    const aEsHoy = a.fecha === hoy;
    const bEsHoy = b.fecha === hoy;
    if (aEsHoy !== bEsHoy) return aEsHoy ? -1 : 1;
    if (!aEsHoy) return 0;

    const ordenA = TIPOS_COMIDA.indexOf(a.tipoComida);
    const ordenB = TIPOS_COMIDA.indexOf(b.tipoComida);
    if (ordenA === -1 && ordenB === -1) return 0;
    if (ordenA === -1) return 1;
    if (ordenB === -1) return -1;
    return ordenA - ordenB;
}

function alertaClaseCss(tipo) {
    if (tipo === 'comprar' || tipo === 'caducado') return 'alert-danger';
    if (tipo === 'cocinar') return 'alert-info';
    return 'alert-warn'; // descongelar, proximo, precocinar
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
