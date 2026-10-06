/* ==========================================================================
   DespensaOnline - "Ya descongelado": elegir qué paquetes salen del congelador
   Al marcar un ingrediente como descongelado (botón de la alerta o casillas del
   modal del plato del menú) se abre modal-descongelar con los lotes congelados
   de cada producto. Vienen preseleccionados los que mejor cuadran con la
   cantidad que hay que descongelar (elegirPaquetes()); se pueden cambiar, y en
   cada paquete se puede indicar que solo sale una parte (el lote se parte en
   dos: lo que sale va a la Nevera y el resto se queda en el congelador).
   Ver DOCUMENTACIÓN-TECNICA.md §9 (alerta Descongelar).
   ========================================================================== */

// Contexto del modal abierto: { entradaId, productoIds, yaGuardado }.
let descongelarModalCtx = null;

// Destino de los paquetes: getUbicacionNevera() (js/alertas.js).

function ordenarPorCaducidad(lotes) {
    return lotes.slice().sort((a, b) => (a.fecha_caducidad || '9999-12-31').localeCompare(b.fecha_caducidad || '9999-12-31'));
}

// Paquetes que mejor cuadran con `objetivo`: la combinación cuya suma llega al objetivo
// pasándose lo menos posible; a igualdad, la de menos paquetes y la que antes caduca. Si ni
// todos juntos llegan, se proponen todos. Con muchos paquetes (más de 15) se prueba en orden
// de caducidad hasta llegar, para no recorrer millones de combinaciones.
function elegirPaquetes(lotes, objetivo) {
    if (objetivo <= 0 || lotes.length === 0) return [];
    const ordenados = ordenarPorCaducidad(lotes);
    const cantidad = l => parseFloat(l.cantidad) || 0;
    const total = ordenados.reduce((s, l) => s + cantidad(l), 0);
    if (total <= objetivo) return ordenados;

    if (ordenados.length > 15) {
        const elegidos = [];
        let suma = 0;
        for (const l of ordenados) {
            if (suma >= objetivo) break;
            elegidos.push(l);
            suma += cantidad(l);
        }
        return elegidos;
    }

    let mejor = null;
    for (let mascara = 1; mascara < (1 << ordenados.length); mascara++) {
        const elegidos = ordenados.filter((_, i) => mascara & (1 << i));
        const suma = elegidos.reduce((s, l) => s + cantidad(l), 0);
        if (suma < objetivo) continue;
        // Índice medio en orden de caducidad: menor = caduca antes.
        const caducidad = elegidos.reduce((s, l) => s + ordenados.indexOf(l), 0) / elegidos.length;
        const candidato = { elegidos, exceso: round2(suma - objetivo), n: elegidos.length, caducidad };
        if (!mejor
            || candidato.exceso < mejor.exceso
            || (candidato.exceso === mejor.exceso && candidato.n < mejor.n)
            || (candidato.exceso === mejor.exceso && candidato.n === mejor.n && candidato.caducidad < mejor.caducidad)) {
            mejor = candidato;
        }
    }
    return mejor ? mejor.elegidos : [];
}

function descongelarLoteRowHtml(lote, producto, preseleccionado) {
    const detalle = [
        lote.detalle_ubicacion,
        lote.fecha_caducidad ? `caduca ${formatDate(lote.fecha_caducidad)}` : null
    ].filter(Boolean).map(escapeHtml).join(' · ');
    return `
        <div class="descongelar-lote">
            <input type="checkbox" data-lote-check="${lote.id}" data-producto="${producto.id}" ${preseleccionado ? 'checked' : ''} aria-label="Sacar este paquete">
            <span class="item-main">
                <span class="item-name">Paquete de ${escapeHtml(formatCantidad(lote.cantidad, producto.unidad))}</span>
                ${detalle ? `<span class="item-meta">${detalle}</span>` : ''}
            </span>
            <label class="descongelar-saco">
                <span>Saco</span>
                <input type="number" class="form-input" data-lote-cantidad="${lote.id}" data-producto="${producto.id}"
                    value="${lote.cantidad}" min="0" max="${lote.cantidad}" step="any" ${preseleccionado ? '' : 'disabled'}>
                <span>${escapeHtml(producto.unidad || '')}</span>
            </label>
        </div>
    `;
}

function descongelarProductoHtml(entrada, producto) {
    const receta = getReceta(entrada.recetaId);
    const necesaria = receta ? getCantidadADescongelar(receta, entrada, producto.id) : 0;
    const lotes = ordenarPorCaducidad(getLotesCongelados(producto.id));
    const preseleccion = new Set(elegirPaquetes(lotes, necesaria).map(l => l.id));
    const encabezado = necesaria > 0
        ? `${escapeHtml(producto.nombre)} · necesitas descongelar ${escapeHtml(formatCantidad(necesaria, producto.unidad))}`
        : `${escapeHtml(producto.nombre)} · ya tienes suficiente fuera del congelador`;
    return `
        <div class="descongelar-producto" data-producto-bloque="${producto.id}" data-necesaria="${necesaria}" data-unidad="${escapeHtml(producto.unidad || '')}">
            <h3 class="section-subtitle">${encabezado}</h3>
            ${lotes.length > 0
                ? lotes.map(l => descongelarLoteRowHtml(l, producto, preseleccion.has(l.id))).join('')
                : '<p class="empty-state-inline">No queda nada de este producto en el congelador.</p>'}
            <p class="descongelar-total" data-total-producto="${producto.id}"></p>
        </div>
    `;
}

// Resumen por producto bajo sus paquetes: lo que sale frente a lo que hace falta.
function actualizarTotalesDescongelar() {
    DOM.descongelarList.querySelectorAll('[data-producto-bloque]').forEach(bloque => {
        const productoId = bloque.dataset.productoBloque;
        const necesaria = parseFloat(bloque.dataset.necesaria) || 0;
        const unidad = bloque.dataset.unidad;
        const sale = [...bloque.querySelectorAll('[data-lote-check]:checked')].reduce((s, cb) => {
            const input = bloque.querySelector(`[data-lote-cantidad="${cb.dataset.loteCheck}"]`);
            return s + Math.max(0, parseFloat(input.value) || 0);
        }, 0);
        const total = bloque.querySelector(`[data-total-producto="${productoId}"]`);
        const diferencia = round2(sale - necesaria);
        total.className = 'descongelar-total ' + (sale > 0 && diferencia >= 0 ? 'ok' : necesaria > 0 ? 'falta' : '');
        total.textContent = `Sacas ${formatCantidad(round2(sale), unidad)} de ${formatCantidad(necesaria, unidad)}`
            + (diferencia > 0 ? ` · sobran ${formatCantidad(diferencia, unidad)}` : diferencia < 0 && necesaria > 0 ? ` · faltan ${formatCantidad(-diferencia, unidad)}` : '');
    });
}

// Abre la ventana para los productos indicados de una entrada del menú. `yaGuardado`: la
// entrada ya se guardó con ellos marcados (casillas del modal del menú) y solo falta mover
// los paquetes; si no, al confirmar también se marcan en menu_semanal.descongelados.
function abrirModalDescongelar(entradaId, productoIds, { yaGuardado = false } = {}) {
    const entrada = state.menuSemanal.find(m => String(m.id) === String(entradaId));
    const productos = productoIds.map(id => getProducto(id)).filter(Boolean);
    if (!entrada || productos.length === 0) return;
    descongelarModalCtx = { entradaId: entrada.id, productoIds: productos.map(p => String(p.id)), yaGuardado };

    const receta = getReceta(entrada.recetaId);
    const comida = TIPO_COMIDA_LABELS[entrada.tipo_comida] || entrada.tipo_comida;
    DOM.descongelarResumen.textContent = `${receta ? receta.nombre : 'Plato'} · ${comida} ${textoDia(entrada.fecha)}. Marca los paquetes que sacas del congelador; si de un paquete solo sacas una parte, cambia la cantidad y el resto se queda congelado.`;
    DOM.descongelarAvisoNevera.classList.toggle('hidden', !!getUbicacionNevera());
    DOM.descongelarList.innerHTML = productos.map(p => descongelarProductoHtml(entrada, p)).join('');
    actualizarTotalesDescongelar();
    DOM.modalDescongelar.classList.remove('hidden');
}

function cerrarModalDescongelar() {
    DOM.modalDescongelar.classList.add('hidden');
    descongelarModalCtx = null;
}

// Mueve a la Nevera lo seleccionado. Un paquete entero cambia de ubicación (se borra su
// detalle_ubicacion, que era del congelador); si solo sale una parte, el lote se parte: el
// del congelador se queda con el resto y se crea uno nuevo en la Nevera con lo que sale
// (misma caducidad y fecha de entrada).
async function confirmarDescongelar() {
    if (!descongelarModalCtx) return;
    const { entradaId, productoIds, yaGuardado } = descongelarModalCtx;
    const nevera = getUbicacionNevera();
    DOM.btnConfirmDescongelar.disabled = true;

    try {
        let movidos = 0;
        if (nevera) {
            const seleccion = [...DOM.descongelarList.querySelectorAll('[data-lote-check]:checked')].map(cb => {
                const lote = state.despensa.find(l => String(l.id) === cb.dataset.loteCheck);
                const input = DOM.descongelarList.querySelector(`[data-lote-cantidad="${cb.dataset.loteCheck}"]`);
                return { lote, sale: round2(Math.max(0, parseFloat(input.value) || 0)) };
            }).filter(s => s.lote && s.sale > 0);

            for (const { lote, sale } of seleccion) {
                const cantidadLote = parseFloat(lote.cantidad) || 0;
                if (sale >= cantidadLote) {
                    await apiRequest('editar_despensa_lote', 'PATCH', { id: lote.id, ubicacionId: nevera.id, detalle_ubicacion: null });
                } else {
                    await apiRequest('editar_despensa_lote', 'PATCH', { id: lote.id, cantidad: round2(cantidadLote - sale) });
                    await apiRequest('despensa_lote', 'POST', {
                        productoId: lote.productoId,
                        cantidad: sale,
                        ubicacionId: nevera.id,
                        detalle_ubicacion: null,
                        fecha_caducidad: lote.fecha_caducidad || null,
                        fecha_entrada: lote.fecha_entrada || todayISO(),
                        no_requiere_descongelar: false
                    });
                }
                movidos++;
            }
        }

        if (!yaGuardado) {
            const entrada = state.menuSemanal.find(m => String(m.id) === String(entradaId));
            const descongelados = [...new Set([...getDescongeladosEntrada(entrada), ...productoIds])].map(Number);
            const result = await apiRequest('editar_menu_entry', 'PATCH', { id: entradaId, descongelados });
            if (!result || !result.success) throw new Error(result?.error || 'No se pudo marcar el plato');
        }

        if (!nevera) showToast('Marcado como descongelado. No encuentro una ubicación "Nevera": mueve los paquetes a mano', 'warning');
        else showToast(movidos > 0 ? `Marcado como descongelado: ${movidos === 1 ? '1 paquete pasado' : `${movidos} paquetes pasados`} a la Nevera` : 'Marcado como descongelado', 'success');

        cerrarModalDescongelar();
        renderDespensa();     // la ubicación/cantidad de los lotes ha cambiado (y recalcula la campana)
        renderMenuSemanal();  // repinta el menú y, vía renderAlertasBadge(), Próximas alertas
        if (!DOM.modalAlertas.classList.contains('hidden')) openAlertasModal();
    } catch (err) {
        console.error(err);
        showToast(`Error al descongelar: ${err.message}`, 'error');
    } finally {
        DOM.btnConfirmDescongelar.disabled = false;
    }
}

function initDescongelarActions() {
    DOM.btnCloseModalDescongelar.addEventListener('click', cerrarModalDescongelar);
    DOM.btnCancelDescongelar.addEventListener('click', cerrarModalDescongelar);
    DOM.btnConfirmDescongelar.addEventListener('click', confirmarDescongelar);
    DOM.descongelarList.addEventListener('change', (e) => {
        const check = e.target.closest('[data-lote-check]');
        if (check) {
            const input = DOM.descongelarList.querySelector(`[data-lote-cantidad="${check.dataset.loteCheck}"]`);
            if (input) input.disabled = !check.checked;
        }
        actualizarTotalesDescongelar();
    });
    DOM.descongelarList.addEventListener('input', (e) => {
        const input = e.target.closest('[data-lote-cantidad]');
        if (!input) return;
        const max = parseFloat(input.max) || 0;
        if ((parseFloat(input.value) || 0) > max) input.value = max;
        actualizarTotalesDescongelar();
    });
}
