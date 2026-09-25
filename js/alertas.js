/* ==========================================================================
   DespensaOnline - Alertas
   Cruza despensa + menú semanal + recetas para avisar de lo que necesita
   atención hoy: qué caduca, qué descongelar, qué cocinar y qué comprar.
   Se recalcula al vuelo; lo único que se guarda son las marcas "Ya precocinado" /
   "Ya descongelado" de cada plato del menú. Ver DOCUMENTACIÓN-TECNICA.md §9.
   ========================================================================== */

// Heurística para identificar el congelador entre las ubicaciones del usuario (no hay un
// campo "tipo" en ubicaciones, solo un nombre libre): si el nombre contiene "congel".
function esUbicacionCongelador(ubicacionId) {
    const ubicacion = getUbicacion(ubicacionId);
    return !!ubicacion && ubicacion.nombre.toLowerCase().includes('congel');
}

// El sábado anterior a una fecha (estrictamente anterior: si la fecha ya es sábado, se
// toma el de la semana previa, no ella misma; para un domingo es la víspera), usado por la
// alerta "Precocina con tiempo" para empezar a avisar el fin de semana anterior a la receta
// (ver getAlertas() más abajo).
function sabadoAnteriorA(fechaISO) {
    const d = new Date(fechaISO + 'T00:00:00');
    const dow = d.getDay(); // 0 = domingo ... 6 = sábado
    let diff = (dow - 6 + 7) % 7;
    if (diff === 0) diff = 7;
    d.setDate(d.getDate() - diff);
    return formatISODate(d);
}

// Dos tipos de precocinado (§3): el de la receta completa (recetas.requiere_cocinado, un
// guiso) se prepara con días de antelación, el fin de semana anterior; el de un ingrediente
// concreto (receta_ingredientes.requiere_cocinado, p. ej. el arroz de unas fajitas) se hace
// el mismo día, lo primero. Solo el primero adelanta también el descongelado.
function esPrecocinadoDeRecetaCompleta(receta) {
    return !!receta && receta.requiere_cocinado !== false;
}

// "200 g Pasta", "1 ud Pechuga"... de los ingredientes marcados para precocinar en una
// receta de montar, ya escalados por los comensales de esa entrada del menú.
function getIngredientesACocinarTexto(receta, entrada) {
    const factor = (parseFloat(entrada.comensales) || 1) / (parseFloat(receta.comensales_base) || 1);
    return getIngredientesReceta(receta.id)
        .filter(ing => ing.requiere_cocinado === true)
        .map(ing => {
            const producto = getProducto(ing.productoId);
            if (!producto) return null;
            const cantidad = (parseFloat(ing.cantidad) || 0) * factor;
            return `${formatCantidad(cantidad, producto.unidad)} ${producto.nombre}`;
        })
        .filter(Boolean);
}

// Misma heurística que esUbicacionCongelador() para la nevera, destino al que "Ya
// descongelado" mueve los lotes: la primera ubicación activa cuyo nombre contenga
// "nevera" o "frigo" (frigorífico). null si el usuario no tiene ninguna así.
function getUbicacionNevera() {
    return state.ubicaciones.find(u => u.activa && /nevera|frigo/i.test(u.nombre)) || null;
}

// Lotes de un producto que cuentan como "congelados" para las alertas: activos, en el
// congelador y sin la marca "no_requiere_descongelar" (p. ej. verdura que se cocina congelada).
function getLotesCongelados(productoId) {
    return state.despensa.filter(l =>
        l.activa && String(l.productoId) === String(productoId) && esUbicacionCongelador(l.ubicacionId) && !l.no_requiere_descongelar
    );
}

// Ingredientes ya marcados "Ya descongelado" en una entrada del menú (menu_semanal.descongelados,
// array de productoId). Tolera null/undefined en entradas antiguas.
function getDescongeladosEntrada(entrada) {
    return Array.isArray(entrada.descongelados) ? entrada.descongelados.map(String) : [];
}

// Productos de una receta que tienes en el congelador y hay que descongelar antes de usarlos
// para ESA entrada del menú: sin repetir (aunque el producto esté dos veces en la receta),
// opcionalmente solo los ingredientes que cumplan `filtroIngrediente`, y sin los que ya se
// marcaron "Ya descongelado" en la entrada.
function getProductosADescongelar(receta, entrada, filtroIngrediente = () => true) {
    const yaDescongelados = getDescongeladosEntrada(entrada);
    const vistos = new Set();
    return getIngredientesReceta(receta.id)
        .filter(filtroIngrediente)
        .map(ing => getProducto(ing.productoId))
        .filter(producto => {
            if (!producto || vistos.has(String(producto.id)) || yaDescongelados.includes(String(producto.id))) return false;
            vistos.add(String(producto.id));
            return getLotesCongelados(producto.id).length > 0;
        });
}

// En una receta de precocinado completo, los ingredientes que siguen en el congelador sin
// marcar "Ya descongelado": se muestran dentro de la alerta de precocinado / "Cocinar hoy"
// de ese plato ("Antes descongela: …"), en vez de como alertas sueltas. En el resto de
// recetas no hay nada que adelantar: su descongelado va por la sección Descongelar.
function getPendientesDescongelarParaPrecocinar(receta, entrada) {
    if (!esPrecocinadoDeRecetaCompleta(receta) || entrada.precocinado) return [];
    return getProductosADescongelar(receta, entrada);
}

// En una tarjeta de "Precocina con tiempo": qué ingredientes del plato no llegan con lo que
// hay en la despensa AHORA (el día `hoy` de referencia de getAlertas(), stock proyectado a
// ese día con getStockProyectado()), porque el guiso se cocina ya, no el día del menú, y la
// alerta "Compra X para hoy" de la sección Comprar solo saltaría ese día, tarde. Cantidades
// por producto sumando sus filas en la receta y escaladas por comensales. No descuenta lo que
// pidan otros platos que precocines a la vez (cada tarjeta mira el stock por su cuenta).
function getFaltantesParaPrecocinar(receta, entrada, hoy) {
    const factor = (parseFloat(entrada.comensales) || 1) / (parseFloat(receta.comensales_base) || 1);
    const necesidades = {};
    getIngredientesReceta(receta.id).forEach(ing => {
        necesidades[ing.productoId] = (necesidades[ing.productoId] || 0) + (parseFloat(ing.cantidad) || 0) * factor;
    });
    return Object.entries(necesidades)
        .map(([productoId, necesaria]) => {
            const producto = getProducto(productoId);
            const cantidad = round2(necesaria - getStockProyectado(productoId, hoy));
            return producto && cantidad > 0 ? { producto, cantidad } : null;
        })
        .filter(Boolean);
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

// Stock que previsiblemente quedará de un producto al empezar el día `fecha`: el actual
// menos lo que consuman las recetas del menú desde hoy hasta la víspera. Se trunca a 0 día a
// día (si un día no llega, se da por hecho que compras justo lo que falta para ese día, que
// es lo que pide su alerta "Compra…"). Para `fecha` = hoy es el stock actual sin más.
function getStockProyectado(productoId, fecha) {
    let stock = getStockDisponible(productoId);
    for (let d = todayISO(); d < fecha; d = addDaysToISO(d, 1)) {
        stock = Math.max(0, stock - (getNecesidadesDelDia(d)[productoId] || 0));
    }
    return stock;
}

// Día en texto relativo al día REAL de hoy (no al de referencia de getAlertas()), para que
// los textos de las alertas simuladas de días futuros se lean bien: "hoy", "mañana" o
// "el viernes 26/09".
function nombreDiaSemana(fecha) {
    return DIAS_SEMANA_LABELS[(new Date(fecha + 'T00:00:00').getDay() + 6) % 7];
}

function formatDiaCorto(fecha) {
    const [, m, d] = fecha.split('-');
    return `${nombreDiaSemana(fecha).toLowerCase()} ${d}/${m}`;
}

function textoDia(fecha) {
    const hoyReal = todayISO();
    if (fecha === hoyReal) return 'hoy';
    if (fecha === addDaysToISO(hoyReal, 1)) return 'mañana';
    return `el ${formatDiaCorto(fecha)}`;
}

function delDia(fecha) {
    const texto = textoDia(fecha);
    return texto.startsWith('el ') ? `del ${texto.slice(3)}` : `de ${texto}`;
}

function capitalizar(texto) {
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Las 6 alertas pedidas, ordenadas por urgencia (0 = más urgente). `hoy` es el día de
// referencia: por defecto el real (campana); la pantalla Próximas alertas lo llama con
// días futuros para simular qué saltará ese día.
function getAlertas(hoy = todayISO()) {
    const alertas = [];

    // Comprar hoy: ingredientes de las recetas de HOY que no llegan con el stock (el actual
    // o, para un día futuro, el que previsiblemente quede ese día).
    Object.entries(getNecesidadesDelDia(hoy)).forEach(([productoId, necesaria]) => {
        const faltante = round2(necesaria - getStockProyectado(productoId, hoy));
        if (faltante <= 0) return;
        const producto = getProducto(productoId);
        if (!producto) return;
        alertas.push({
            tipo: 'comprar',
            prioridad: 0,
            fecha: hoy,
            titulo: `Compra ${producto.nombre} para ${textoDia(hoy)}`,
            detalle: `Te faltan ${formatCantidad(faltante, producto.unidad)} para el menú ${delDia(hoy)}`
        });
    });

    // Caducado, tíralo / Va a caducar (ya calculadas en getLotesPorCaducar(), state.js).
    getLotesPorCaducar(DIAS_ALERTA_CADUCIDAD, hoy).forEach(({ lote, estado }) => {
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

    // Descongelar: ingredientes de las recetas de hoy en adelante que tienes en el congelador.
    // Las recetas de precocinado completo no pasan por aquí: su descongelado va dentro de la
    // propia tarjeta de precocinado / "Cocinar hoy" más abajo ("Antes descongela…", ver
    // getPendientesDescongelarParaPrecocinar()), y si ya están precocinadas no hace falta.
    // Para el resto (también las de un ingrediente a precocinar, que se cocina el mismo día)
    // avisa desde la víspera de la receta y se repite cada día hasta que se marque "Ya
    // descongelado" en ese plato (botón de la alerta o casilla del modal del menú,
    // menu_semanal.descongelados, que además pasa los lotes a la Nevera — ver
    // marcarDescongelado()) o hasta que pase el día de la receta (el propio día aún avisa).
    state.menuSemanal
        .filter(e => e.activa && e.fecha >= hoy && hoy >= addDaysToISO(e.fecha, -1))
        .forEach(entrada => {
            const receta = getReceta(entrada.recetaId);
            if (!receta || esPrecocinadoDeRecetaCompleta(receta)) return;
            const comida = TIPO_COMIDA_LABELS[entrada.tipo_comida] || entrada.tipo_comida;
            getProductosADescongelar(receta, entrada).forEach(producto => alertas.push({
                tipo: 'descongelar',
                prioridad: 2,
                fecha: entrada.fecha,
                tipoComida: entrada.tipo_comida,
                entradaId: entrada.id,
                descongelar: [producto],
                recurrente: true,
                titulo: `Descongela ${producto.nombre}`,
                detalle: `Lo necesitas ${textoDia(entrada.fecha)} para ${receta.nombre} (${comida})`
            }));
        });

    // Precocina con tiempo: solo para recetas futuras de precocinado COMPLETO (un guiso,
    // esPrecocinadoDeRecetaCompleta()). Empieza el fin de semana anterior (sábado anterior a
    // la receta, sabadoAnteriorA(); para una receta de domingo, la víspera) y se repite cada
    // día — sábado, domingo y, si no dio tiempo, los días siguientes hasta la víspera —
    // mientras la entrada del menú no esté marcada "Ya precocinado" (menu_semanal.precocinado,
    // botón de la propia alerta o casilla del hueco del menú). El propio día de la receta ya lo
    // cubre "Cocinar hoy". El precocinado de un ingrediente suelto no avisa con antelación:
    // se recuerda solo el mismo día, en "Cocinar hoy".
    state.menuSemanal
        .filter(e => e.activa && e.fecha > hoy && !e.precocinado)
        .forEach(entrada => {
            const receta = getReceta(entrada.recetaId);
            if (!esPrecocinadoDeRecetaCompleta(receta)) return;
            if (hoy < sabadoAnteriorA(entrada.fecha)) return;

            const comida = TIPO_COMIDA_LABELS[entrada.tipo_comida] || entrada.tipo_comida;
            const cuandoLoNecesitas = `${textoDia(entrada.fecha)} (${comida})`;
            // Lo que haya que descongelar o comprar para poder precocinar va en esta misma
            // tarjeta (destacado; lo de descongelar con su botón "Ya descongelado"), no en
            // alertas aparte. Mientras quede algo pendiente, sube por delante del resto.
            const descongelar = getPendientesDescongelarParaPrecocinar(receta, entrada);
            const comprar = getFaltantesParaPrecocinar(receta, entrada, hoy);
            alertas.push({
                tipo: 'precocinar',
                prioridad: descongelar.length > 0 || comprar.length > 0 ? 4 : 5,
                fecha: entrada.fecha,
                tipoComida: entrada.tipo_comida,
                entradaId: entrada.id,
                descongelar,
                comprar,
                recurrente: true,
                titulo: `Precocina con tiempo ${receta.nombre}`,
                detalle: `Lo necesitas ${cuandoLoNecesitas}`
            });
        });

    // Cocinar hoy: recordatorio del mismo día para lo planificado hoy que requiera precocinado
    // (recetaRequierePrecocinado(), js/state.js), de los dos tipos (§3). Si ya se marcó "Ya
    // precocinado", no queda nada que cocinar.
    //  - Receta completa (un guiso) que no se precocinó el fin de semana: "Hoy toca cocinar …".
    //  - Ingrediente suelto (p. ej. el arroz de unas fajitas): es su ÚNICO aviso, así que
    //    recuerda que lleva más tiempo que el resto y hay que empezar por él.
    state.menuSemanal
        .filter(e => e.activa && e.fecha === hoy && !e.precocinado)
        .forEach(entrada => {
            const receta = getReceta(entrada.recetaId);
            if (!receta || !recetaRequierePrecocinado(receta)) return;

            const comida = TIPO_COMIDA_LABELS[entrada.tipo_comida] || entrada.tipo_comida;
            const cuando = capitalizar(textoDia(hoy));
            let titulo = `${cuando} toca cocinar ${receta.nombre}`;
            let detalle = comida;
            if (!esPrecocinadoDeRecetaCompleta(receta)) {
                const ingredientesACocinar = getIngredientesACocinarTexto(receta, entrada);
                if (ingredientesACocinar.length > 0) {
                    titulo = `${cuando}, empieza por cocinar ${ingredientesACocinar.join(', ')}`;
                    detalle = `Lleva más tiempo que el resto de ${receta.nombre} · ${comida}`;
                }
            }

            // Igual que en el precocinado: si aún queda algo congelado que hay que cocinar,
            // va destacado en esta tarjeta y la sube al principio de su sección.
            const descongelar = getPendientesDescongelarParaPrecocinar(receta, entrada);
            alertas.push({
                tipo: 'cocinar',
                prioridad: descongelar.length > 0 ? 2 : 3,
                fecha: hoy,
                tipoComida: entrada.tipo_comida,
                entradaId: entrada.id,
                descongelar,
                titulo,
                detalle
            });
        });

    return alertas.sort((a, b) => compararAlertas(a, b, hoy));
}

// Orden de las alertas: prioridad primero; dentro de la misma prioridad, lo de HOY antes
// que lo de otros días (p. ej. entre varios lotes "Va a caducar" con la misma prioridad,
// el que caduca hoy sube por delante del que caduca dentro de dos días); y dentro de lo de
// hoy, por tipo de comida en su orden natural (desayuno, comida, cena) usando TIPOS_COMIDA
// (js/state.js) — así varios platos de "Hoy toca cocinar" salen en el orden en que se comen.
// `hoy` es el mismo día de referencia con el que se calcularon las alertas (getAlertas()).
function compararAlertas(a, b, hoy = todayISO()) {
    if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;

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

// Secciones en que se agrupan las alertas (campana y Próximas alertas), en este orden fijo,
// que sigue la urgencia de sus prioridades. Dentro de cada sección se mantiene el orden de
// compararAlertas().
const SECCIONES_ALERTAS = [
    { titulo: 'Comprar', tipos: ['comprar'] },
    { titulo: 'Caducidad', tipos: ['caducado', 'proximo'] },
    { titulo: 'Descongelar', tipos: ['descongelar'] },
    { titulo: 'Cocinar y precocinar', tipos: ['cocinar', 'precocinar'] }
];

function alertasPorTipoHtml(alertas) {
    return SECCIONES_ALERTAS.map(({ titulo, tipos }) => {
        const deLaSeccion = alertas.filter(a => tipos.includes(a.tipo));
        if (deLaSeccion.length === 0) return '';
        return `
            <div class="alertas-seccion">
                <h3 class="section-subtitle">${titulo} · ${deLaSeccion.length}</h3>
                <div class="alertas-caducidad">${deLaSeccion.map(alertaRowHtml).join('')}</div>
            </div>
        `;
    }).join('');
}

function alertaClaseCss(tipo) {
    if (tipo === 'comprar' || tipo === 'caducado') return 'alert-danger';
    if (tipo === 'cocinar') return 'alert-info';
    return 'alert-warn'; // descongelar, proximo, precocinar
}

// Botones para marcar como hecho en esa entrada del menú y que la alerta deje de salir
// (marcarPrecocinado() / marcarDescongelado()). "Ya descongelado" marca de una vez todo lo
// que la tarjeta pide descongelar (alerta.descongelar); en una tarjeta de precocinado o
// "Cocinar hoy" va como botón principal, porque es lo primero que hay que hacer.
function alertaAccionesHtml(alerta) {
    if (alerta.entradaId === undefined) return '';
    const pendientes = alerta.descongelar || [];
    const botones = [];
    if (pendientes.length > 0) {
        const clase = alerta.tipo === 'descongelar' ? 'btn-secondary' : 'btn-primary';
        botones.push(`<button type="button" class="btn ${clase} btn-small" data-descongelado-entrada="${alerta.entradaId}" data-descongelado-productos="${pendientes.map(p => p.id).join(',')}">Ya descongelado</button>`);
    }
    if (alerta.tipo === 'precocinar') {
        botones.push(`<button type="button" class="btn btn-secondary btn-small" data-precocinado-entrada="${alerta.entradaId}">Ya precocinado</button>`);
    }
    return botones.length > 0 ? `<div class="alerta-acciones">${botones.join('')}</div>` : '';
}

// Avisos destacados dentro de una tarjeta de precocinado / "Cocinar hoy" con lo que falta
// antes de ponerse a cocinar — lo que aún está congelado y lo que no hay en la despensa:
// sin eso no se puede cocinar, así que no debe pasar desapercibido.
function alertaAntesHtml(icono, etiqueta, textos) {
    return `
        <div class="alerta-antes">
            <svg class="icon-sm"><use href="#${icono}"/></svg>
            <span><strong>${etiqueta}:</strong> ${textos.map(escapeHtml).join(', ')}</span>
        </div>
    `;
}

function alertaPendientesAntesHtml(alerta) {
    if (alerta.tipo === 'descongelar') return '';
    let html = '';
    if (alerta.comprar && alerta.comprar.length > 0) {
        html += alertaAntesHtml('ic-cart', 'Antes compra', alerta.comprar.map(c => `${formatCantidad(c.cantidad, c.producto.unidad)} ${c.producto.nombre}`));
    }
    if (alerta.descongelar && alerta.descongelar.length > 0) {
        html += alertaAntesHtml('ic-snow', 'Antes descongela', alerta.descongelar.map(p => p.nombre));
    }
    return html;
}

function alertaRowHtml(alerta) {
    return `
        <div class="alert-strip ${alertaClaseCss(alerta.tipo)}">
            <strong>${escapeHtml(alerta.titulo)}</strong>
            <span class="alerta-detalle">${escapeHtml(alerta.detalle)}</span>
            ${alertaPendientesAntesHtml(alerta)}
            ${alertaAccionesHtml(alerta)}
        </div>
    `;
}

async function marcarPrecocinado(entradaId) {
    const result = await apiRequest('editar_menu_entry', 'PATCH', { id: entradaId, precocinado: true });
    if (!result || !result.success) {
        showToast(result?.error || 'No se ha podido marcar como precocinado', 'error');
        return;
    }
    showToast('Marcado como precocinado', 'success');
    renderMenuSemanal(); // repinta el menú y, vía renderAlertasBadge(), Próximas alertas
    if (!DOM.modalAlertas.classList.contains('hidden')) openAlertasModal();
}

// Pasa a la Nevera los lotes congelados de un producto que hacen falta para una entrada del
// menú: por orden de caducidad (primero lo que antes caduca, sin fecha al final) hasta cubrir
// la cantidad que pide la receta ya escalada por comensales. Los lotes no se parten (un
// paquete se descongela entero). El detalle de ubicación ("Cajón 2") se borra porque era
// del congelador. Devuelve cuántos lotes se movieron, o null si no hay ubicación Nevera.
async function moverADescongelarANevera(entrada, productoId) {
    const nevera = getUbicacionNevera();
    if (!nevera) return null;
    const receta = getReceta(entrada.recetaId);
    const factor = receta ? (parseFloat(entrada.comensales) || 1) / (parseFloat(receta.comensales_base) || 1) : 1;
    const necesaria = receta
        ? getIngredientesReceta(receta.id)
            .filter(ing => String(ing.productoId) === String(productoId))
            .reduce((sum, ing) => sum + (parseFloat(ing.cantidad) || 0) * factor, 0)
        : 0;

    const lotes = getLotesCongelados(productoId).sort((a, b) =>
        (a.fecha_caducidad || '9999-12-31').localeCompare(b.fecha_caducidad || '9999-12-31')
    );
    let acumulado = 0;
    let movidos = 0;
    for (const lote of lotes) {
        if (movidos > 0 && acumulado >= necesaria) break;
        const res = await apiRequest('editar_despensa_lote', 'PATCH', { id: lote.id, ubicacionId: nevera.id, detalle_ubicacion: null });
        if (res && res.success) {
            acumulado += parseFloat(lote.cantidad) || 0;
            movidos++;
        }
    }
    return movidos;
}

// "Ya descongelado": se guarda en la entrada del menú (menu_semanal.descongelados, para
// que ese plato deje de avisar aunque queden otros lotes en el congelador) y se pasan los
// lotes necesarios a la Nevera (moverADescongelarANevera()). Acepta varios productos a la
// vez (casillas del modal del menú); `yaGuardado` = true si la entrada ya se guardó con
// ellos marcados y solo falta mover los lotes.
async function marcarDescongelado(entradaId, productoIds, { yaGuardado = false } = {}) {
    const entrada = state.menuSemanal.find(m => String(m.id) === String(entradaId));
    if (!entrada || productoIds.length === 0) return;

    if (!yaGuardado) {
        const descongelados = [...new Set([...getDescongeladosEntrada(entrada), ...productoIds.map(String)])].map(Number);
        const result = await apiRequest('editar_menu_entry', 'PATCH', { id: entrada.id, descongelados });
        if (!result || !result.success) {
            showToast(result?.error || 'No se ha podido marcar como descongelado', 'error');
            return;
        }
    }

    let sinNevera = false;
    let movidos = 0;
    for (const productoId of productoIds) {
        const n = await moverADescongelarANevera(entrada, productoId);
        if (n === null) sinNevera = true;
        else movidos += n;
    }

    if (sinNevera) showToast('Marcado como descongelado. No encuentro una ubicación "Nevera": mueve el lote a mano', 'warning');
    else showToast(movidos > 0 ? `Marcado como descongelado y ${movidos === 1 ? 'lote pasado' : `${movidos} lotes pasados`} a la Nevera` : 'Marcado como descongelado', 'success');

    renderDespensa();     // la ubicación de los lotes ha cambiado (y recalcula la campana)
    renderMenuSemanal();  // repinta el menú y, vía renderAlertasBadge(), Próximas alertas
    if (!DOM.modalAlertas.classList.contains('hidden')) openAlertasModal();
}

// Delegación de clics para los botones "Ya precocinado" / "Ya descongelado" de una lista de
// alertas (el modal de la campana y la pantalla Próximas alertas se repintan enteros, así que
// se engancha una sola vez al contenedor).
function wireAccionesAlertas(container) {
    container.addEventListener('click', (e) => {
        const btnPrecocinado = e.target.closest('[data-precocinado-entrada]');
        if (btnPrecocinado) {
            marcarPrecocinado(btnPrecocinado.dataset.precocinadoEntrada);
            return;
        }
        const btnDescongelado = e.target.closest('[data-descongelado-entrada]');
        if (btnDescongelado) {
            btnDescongelado.disabled = true; // evita doble clic mientras se mueven los lotes
            marcarDescongelado(btnDescongelado.dataset.descongeladoEntrada, btnDescongelado.dataset.descongeladoProductos.split(','));
        }
    });
}

function renderAlertasBadge() {
    if (!DOM.alertasBadge) return;
    const total = getAlertas().length;
    DOM.alertasBadge.textContent = total > 9 ? '9+' : String(total);
    DOM.alertasBadge.classList.toggle('hidden', total === 0);
    // Se llama tras toda mutación relevante (§9 de la documentación), así que es el sitio
    // natural para refrescar también Próximas alertas si es la pantalla que se está viendo.
    if (DOM.screenProximasAlertas && DOM.screenProximasAlertas.classList.contains('active')) {
        renderProximasAlertas();
    }
}

// Qué alertas NUEVAS saltarán cada uno de los próximos días: se simula getAlertas() con
// cada fecha futura como "hoy" y se quitan las que ya salían un día anterior (incluido hoy),
// para que un aviso que dura varios días (p. ej. "Va a caducar" durante 3 días) aparezca
// solo el primer día en que salta. Excepción: las alertas `recurrente` (precocinar y su
// descongelar) sí se repiten cada día, porque siguen pendientes hasta que se marque
// "Ya precocinado" — así se ve que el aviso dura todo el fin de semana.
function getProximasAlertas(dias = DIAS_PROXIMAS_ALERTAS) {
    const hoyReal = todayISO();
    const claveAlerta = a => `${a.tipo}|${a.titulo}|${a.detalle}`;
    const vistas = new Set(getAlertas(hoyReal).map(claveAlerta));
    const porDia = [];
    for (let i = 1; i <= dias; i++) {
        const fecha = addDaysToISO(hoyReal, i);
        const alertas = getAlertas(fecha).filter(a => a.recurrente || !vistas.has(claveAlerta(a)));
        alertas.forEach(a => vistas.add(claveAlerta(a)));
        porDia.push({ fecha, alertas });
    }
    return porDia;
}

function proximasDiaTituloHtml(fecha) {
    const esManana = fecha === addDaysToISO(todayISO(), 1);
    const dia = capitalizar(formatDiaCorto(fecha));
    return `<h2 class="section-title">${esManana ? `Mañana · ${dia}` : dia}</h2>`;
}

function renderProximasAlertas() {
    DOM.proximasAlertasList.innerHTML = getProximasAlertas().map(({ fecha, alertas }) => `
        ${proximasDiaTituloHtml(fecha)}
        ${alertas.length > 0
            ? alertasPorTipoHtml(alertas)
            : '<p class="empty-state-inline">Nada nuevo previsto.</p>'}
    `).join('');
}

function goToProximasAlertas() {
    closeAlertasModal();
    if (window.location.hash === '#proximas-alertas') renderProximasAlertas();
    else window.location.hash = '#proximas-alertas';
}

function openAlertasModal() {
    const alertas = getAlertas();
    DOM.alertasList.innerHTML = alertas.length > 0
        ? alertasPorTipoHtml(alertas)
        : '<p class="empty-state-inline">No tienes alertas pendientes. Todo en orden.</p>';
    DOM.modalAlertas.classList.remove('hidden');
}

function closeAlertasModal() {
    DOM.modalAlertas.classList.add('hidden');
}
