/* ==========================================================================
   DespensaOnline - Tuppers de un guiso
   Al marcar "Ya precocinado" un plato de fin de semana (guisos, potajes…), un guiso suele
   dar más raciones de las que se comen esa semana: se apuntan aquí cuántos tuppers van a la
   Nevera y cuántos al Congelador, para tenerlos como existencias en la despensa. 1 tupper =
   1 ración = 1 comensal. Se guardan como lotes de un producto "<receta> (tupper)" (se
   reutiliza uno ya existente con ese nombre, p. ej. "<receta> congelado", o se crea).
   ========================================================================== */

// Contexto del modal abierto: { receta, producto (o null si hay que crearlo), nombre, nevera, congelador }.
let tuppersModalCtx = null;

const CATEGORIA_PLATOS_PREPARADOS = 'Platos preparados';

// ¿Tiene esta receta tuppers que apuntar al precocinarla? Solo los platos de fin de semana
// (los de "día anterior" ya son el tupper de ese día, no se congelan).
function recetaDaTuppers(receta) {
    return getTipoPrecocinado(receta) === 'fin_de_semana';
}

// Producto ya existente que hace de "tupper" de esta receta: mismo nombre que la receta +
// "congelado(s)" / "tupper(s)" (con o sin paréntesis), sin tildes ni mayúsculas. El nombre
// exacto de la receta no cuenta: podría ser un ingrediente crudo con el mismo nombre.
function buscarProductoTupper(receta) {
    const n = normalizarTexto(receta.nombre);
    const variantes = new Set(['congelado', 'congelados', '(congelado)', 'tupper', 'tuppers', '(tupper)'].map(s => `${n} ${s}`));
    return state.productos.find(p => p.activa && variantes.has(normalizarTexto(p.nombre))) || null;
}

function abrirModalTuppers(entradaId) {
    const entrada = state.menuSemanal.find(m => String(m.id) === String(entradaId));
    const receta = entrada && getReceta(entrada.recetaId);
    if (!receta || !recetaDaTuppers(receta)) return;

    const nevera = getUbicacionNevera();
    const congelador = state.ubicaciones.find(u => u.activa && esUbicacionCongelador(u.id)) || null;
    if (!nevera && !congelador) {
        showToast('Para apuntar tuppers necesitas una ubicación "Nevera" o "Congelador" en Ajustes.', 'warning');
        return;
    }

    const producto = buscarProductoTupper(receta);
    const nombre = producto ? producto.nombre : `${receta.nombre} (tupper)`;
    tuppersModalCtx = { receta, producto, nombre, nevera, congelador };

    DOM.tuppersResumen.textContent = `${receta.nombre}: apunta los tuppers que han salido (1 tupper = 1 ración) para tenerlos controlados en la despensa. Déjalo en 0 o pulsa "Ahora no" si no quieres apuntarlos.`;
    DOM.tuppersProducto.textContent = producto
        ? `Se sumarán a «${nombre}».`
        : `Se creará el producto «${nombre}» (unidad: ud, categoría «${CATEGORIA_PLATOS_PREPARADOS}»).`;

    DOM.inTuppersNeveraLabel.textContent = nevera ? `Tuppers a ${nevera.nombre}` : 'Tuppers a la nevera (no hay ubicación "Nevera")';
    DOM.inTuppersNevera.disabled = !nevera;
    DOM.inTuppersNevera.value = nevera ? (parseFloat(entrada.comensales) || 0) : 0;

    DOM.inTuppersCongeladorLabel.textContent = congelador ? `Tuppers a ${congelador.nombre}` : 'Tuppers al congelador (no hay ubicación "Congelador")';
    DOM.inTuppersCongelador.disabled = !congelador;
    DOM.inTuppersCongelador.value = 0;
    DOM.inTuppersCaducidad.disabled = !congelador;
    DOM.inTuppersCaducidad.value = '';
    DOM.inTuppersDetalle.disabled = !congelador;
    DOM.inTuppersDetalle.value = '';
    DOM.tuppersDetallesList.innerHTML = congelador
        ? getDetallesUnicosPorUbicacion(congelador.id).map(d => `<option value="${escapeHtml(d)}"></option>`).join('')
        : '';

    DOM.modalTuppers.classList.remove('hidden');
}

function cerrarModalTuppers() {
    DOM.modalTuppers.classList.add('hidden');
    tuppersModalCtx = null;
}

async function confirmarTuppers() {
    if (!tuppersModalCtx) return;
    const { receta, nevera, congelador } = tuppersModalCtx;
    let { producto } = tuppersModalCtx;

    const aNevera = nevera ? Math.max(0, parseFloat(DOM.inTuppersNevera.value) || 0) : 0;
    const aCongelador = congelador ? Math.max(0, parseFloat(DOM.inTuppersCongelador.value) || 0) : 0;
    if (aNevera + aCongelador === 0) {
        cerrarModalTuppers();
        return;
    }

    DOM.btnConfirmTuppers.disabled = true;
    try {
        let productoId = producto ? producto.id : null;
        if (!productoId) {
            productoId = await crearProductoDesdeCampos(tuppersModalCtx.nombre, CATEGORIA_PLATOS_PREPARADOS, 'ud');
            if (!productoId) return; // crearProductoDesdeCampos() ya avisó del error
        }

        const hoy = todayISO();
        const lotes = [];
        if (aNevera > 0) lotes.push({ ubicacionId: nevera.id, cantidad: aNevera, detalle: null, caducidad: null });
        if (aCongelador > 0) {
            lotes.push({
                ubicacionId: congelador.id,
                cantidad: aCongelador,
                detalle: DOM.inTuppersDetalle.value.trim() || null,
                caducidad: DOM.inTuppersCaducidad.value || null
            });
        }

        // Un lote por ubicación con todos sus tuppers: "Ya descongelado" ya sabe sacar solo
        // una parte de un lote (js/descongelar.js).
        for (const l of lotes) {
            const res = await apiRequest('despensa_lote', 'POST', {
                productoId,
                cantidad: l.cantidad,
                ubicacionId: l.ubicacionId,
                detalle_ubicacion: l.detalle,
                fecha_entrada: hoy,
                fecha_caducidad: l.caducidad,
                no_requiere_descongelar: false
            });
            if (!res || !res.success) {
                showToast(res?.error || 'Error al apuntar los tuppers', 'error');
                return;
            }
        }

        // Enlaza el producto con la receta (recetas.producto_tupper_id) para que el menú pueda
        // ofrecer "Usar tupper congelado". Si falla (p. ej. falta la columna en Supabase) los
        // tuppers ya están apuntados: solo se avisa.
        if (String(receta.producto_tupper_id || '') !== String(productoId)) {
            const enlace = await apiRequest('editar_receta', 'PATCH', { id: receta.id, producto_tupper_id: productoId });
            if (!enlace || !enlace.success) showToast('Tuppers apuntados, pero no se pudo enlazar el producto con la receta.', 'warning');
        }

        const partes = [];
        if (aNevera > 0) partes.push(`${aNevera} a ${nevera.nombre}`);
        if (aCongelador > 0) partes.push(`${aCongelador} a ${congelador.nombre}`);
        showToast(`Tuppers de ${receta.nombre} apuntados: ${partes.join(' y ')}`, 'success');
        cerrarModalTuppers();
        renderDespensa();
        renderListaCompra();
    } finally {
        DOM.btnConfirmTuppers.disabled = false;
    }
}

function initTuppersActions() {
    DOM.btnCloseModalTuppers.addEventListener('click', cerrarModalTuppers);
    DOM.btnCancelTuppers.addEventListener('click', cerrarModalTuppers);
    DOM.btnConfirmTuppers.addEventListener('click', confirmarTuppers);
}
