/* ==========================================================================
   DespensaOnline - Selector de elementos (hoja con búsqueda, categorías y selección múltiple)
   Sustituye al <select> clásico: conserva la categorización, permite buscar (sin distinguir
   tildes ni mayúsculas), ofrece "Recientes" arriba y, en modo múltiple, un contador +/- por fila.
   Es genérico: se alimenta de una lista de { id, nombre, categoria, meta } y devuelve un
   Map(id -> cantidad) con lo elegido; cada pantalla decide qué hacer con ello.
   ========================================================================== */

const selector = { cfg: null, cantidades: new Map(), valores: new Map(), categoria: 'todas', busqueda: '' };
const SELECTOR_SIN_CATEGORIA = '__sin_categoria__';

// cfg: {
//   titulo, items: [{ id, nombre, categoria, meta }],
//   recientes: [id]               -> bloque "Recientes" arriba (solo sin búsqueda ni categoría)
//   recientesLabel                -> título de ese bloque (por defecto "Recientes")
//   multi: bool                   -> false = un toque elige y cierra
//   contador: bool                -> en multi, contador +/- por fila (false = casilla marcar/desmarcar)
//   acciones: [{ label, fn }]     -> atajos; fn() devuelve un Map(id -> n) que sustituye la selección
//   panel: {                      -> en multi, panel de campos bajo cada fila marcada
//     inicial(id) -> objeto       valores por defecto de ese elemento
//     html(id, valores, item)     HTML de los campos; cada input/select lleva data-campo="nombre"
//     alCambiar(id, valores, campo)  (opcional) ajusta campos dependientes tras cambiar un desplegable
//     masivoLabel, masivoOpciones: [{ value, label }], aplicarMasivo(valores, value)
//                                 (opcional) desplegable de arriba que aplica algo a todo lo marcado
//   }
//   validar(Map cantidades, Map valores) -> mensaje de error o null; si hay error, no se cierra la hoja
//   confirmarLabel: (total) => texto del botón principal
//   onConfirm(Map cantidades, Map valores), onCrear(textoBuscado)
// }
function abrirSelector(cfg) {
    selector.cfg = cfg;
    selector.cantidades = new Map();
    selector.valores = new Map();
    selector.categoria = 'todas';
    selector.busqueda = '';

    DOM.selectorTitle.textContent = cfg.titulo || 'Elegir';
    DOM.selectorSearch.value = '';
    const botonesAcciones = (cfg.acciones || [])
        .map((a, i) => `<button type="button" class="btn btn-secondary btn-small" data-accion="${i}">${escapeHtml(a.label)}</button>`)
        .join('');
    const masivo = cfg.multi && cfg.panel?.aplicarMasivo
        ? `<select class="form-select selector-masivo" data-masivo aria-label="${escapeHtml(cfg.panel.masivoLabel)}">
               <option value="">${escapeHtml(cfg.panel.masivoLabel)}</option>
               ${cfg.panel.masivoOpciones.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
           </select>`
        : '';
    DOM.selectorAcciones.innerHTML = botonesAcciones + masivo;
    DOM.selectorAcciones.classList.toggle('hidden', !botonesAcciones && !masivo);
    DOM.btnSelectorConfirm.classList.toggle('hidden', !cfg.multi);
    DOM.btnSelectorCrear.classList.toggle('hidden', !cfg.onCrear);
    DOM.selectorFooter.classList.toggle('hidden', !cfg.multi && !cfg.onCrear); // sin botones, sin pie

    renderSelectorChips();
    renderSelectorLista();
    actualizarSelectorFooter();
    DOM.modalSelector.classList.remove('hidden');
    // En móvil el teclado taparía media hoja: solo se enfoca la búsqueda con puntero fino.
    if (window.matchMedia('(pointer: fine)').matches) DOM.selectorSearch.focus();
}

function cerrarSelector() {
    DOM.modalSelector.classList.add('hidden');
    selector.cfg = null;
}

function renderSelectorChips() {
    const items = selector.cfg.items;
    const categorias = [...new Set(items.map(i => (i.categoria || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    const hayVarias = categorias.length > 0;
    const haySin = items.some(i => !(i.categoria || '').trim());

    const chips = [{ value: 'todas', label: 'Todas' }, ...categorias.map(c => ({ value: c, label: c }))];
    if (hayVarias && haySin) chips.push({ value: SELECTOR_SIN_CATEGORIA, label: 'Sin categoría' });

    DOM.selectorChips.classList.toggle('hidden', !hayVarias);
    DOM.selectorChips.innerHTML = chips
        .map(c => `<button type="button" class="chip ${c.value === selector.categoria ? 'active' : ''}" data-value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</button>`)
        .join('');
}

function itemsFiltradosSelector() {
    const q = normalizarTexto(selector.busqueda);
    return selector.cfg.items.filter(i => {
        const cat = (i.categoria || '').trim();
        if (selector.categoria === SELECTOR_SIN_CATEGORIA && cat) return false;
        if (selector.categoria !== 'todas' && selector.categoria !== SELECTOR_SIN_CATEGORIA && cat !== selector.categoria) return false;
        if (!q) return true;
        return normalizarTexto(i.nombre).includes(q) || normalizarTexto(cat).includes(q);
    });
}

function selectorFilaHtml(item) {
    const n = selector.cantidades.get(String(item.id)) || 0;
    return `<div class="item-row selector-row ${n > 0 ? 'selected' : ''}" data-id="${escapeHtml(item.id)}" role="button" tabindex="0">${selectorFilaInnerHtml(item, n)}</div>`;
}

function selectorFilaInnerHtml(item, n) {
    const { multi, contador } = selector.cfg;
    let control = '<svg class="icon-sm selector-chev"><use href="#ic-chev-right"/></svg>';
    if (multi && contador) {
        control = n > 0
            ? `<span class="selector-stepper">
                   <button type="button" class="stepper-btn" data-paso="-1" aria-label="Quitar uno">−</button>
                   <span class="stepper-n">${n}</span>
                   <button type="button" class="stepper-btn" data-paso="1" aria-label="Añadir uno">+</button>
               </span>`
            : '<button type="button" class="stepper-btn stepper-add" data-paso="1" aria-label="Añadir"><svg class="icon-sm"><use href="#ic-plus"/></svg></button>';
    } else if (multi) {
        control = `<span class="selector-check">${n > 0 ? '✓' : ''}</span>`;
    }
    const panel = multi && selector.cfg.panel && n > 0
        ? `<div class="selector-panel" data-panel>${selector.cfg.panel.html(item.id, valoresSelector(item.id), item)}</div>`
        : '';
    return `
        <span class="mono mono-sm">${escapeHtml(monogramLetter(item.nombre))}</span>
        <span class="item-main">
            <span class="item-name">${escapeHtml(item.nombre)}</span>
            ${item.meta ? `<span class="item-meta">${escapeHtml(item.meta)}</span>` : ''}
        </span>
        ${control}${panel}`;
}

// Valores de los campos del panel de un elemento marcado: los editados o, la primera vez,
// los que propone cfg.panel.inicial().
function valoresSelector(id) {
    id = String(id);
    if (!selector.valores.has(id)) selector.valores.set(id, selector.cfg.panel.inicial(id));
    return selector.valores.get(id);
}

// Repinta las filas de un elemento (puede salir en "Recientes" y en su categoría a la vez).
function repintarFilasSelector(id) {
    id = String(id);
    const item = selector.cfg.items.find(i => String(i.id) === id);
    const n = selector.cantidades.get(id) || 0;
    DOM.selectorList.querySelectorAll('.selector-row').forEach(fila => {
        if (fila.dataset.id !== id) return;
        fila.classList.toggle('selected', n > 0);
        fila.innerHTML = selectorFilaInnerHtml(item, n);
    });
}

function renderSelectorLista() {
    const filtrados = itemsFiltradosSelector();
    if (filtrados.length === 0) {
        const texto = selector.busqueda.trim();
        DOM.selectorList.innerHTML = `<p class="empty-state-inline">${texto ? `Nada coincide con «${escapeHtml(texto)}».` : 'No hay elementos.'}</p>`;
        return;
    }

    let html = '';
    const sinFiltros = !selector.busqueda.trim() && selector.categoria === 'todas';
    if (sinFiltros && selector.cfg.recientes?.length) {
        const porId = new Map(filtrados.map(i => [String(i.id), i]));
        const recientes = selector.cfg.recientes.map(id => porId.get(String(id))).filter(Boolean);
        if (recientes.length) html += `<h3 class="section-subtitle">${escapeHtml(selector.cfg.recientesLabel || 'Recientes')}</h3>` + recientes.map(selectorFilaHtml).join('');
    }

    // Agrupado por categoría (alfabética, "sin categoría" al final) y por nombre dentro de cada una.
    const grupos = new Map();
    filtrados.slice().sort((a, b) => compararProductosPorCategoria(a, b)).forEach(i => {
        const cat = (i.categoria || '').trim();
        if (!grupos.has(cat)) grupos.set(cat, []);
        grupos.get(cat).push(i);
    });
    const hayCategorias = [...grupos.keys()].some(Boolean);
    grupos.forEach((lista, cat) => {
        if (hayCategorias) html += `<h3 class="section-subtitle">${escapeHtml(cat || 'Sin categoría')}</h3>`;
        html += lista.map(selectorFilaHtml).join('');
    });
    DOM.selectorList.innerHTML = html;
}

function totalSelector() {
    let total = 0;
    selector.cantidades.forEach(n => { total += n; });
    return total;
}

function actualizarSelectorFooter() {
    if (!selector.cfg?.multi) return;
    const total = totalSelector();
    const etiqueta = selector.cfg.confirmarLabel ? selector.cfg.confirmarLabel(total) : `Añadir (${total})`;
    DOM.btnSelectorConfirm.textContent = etiqueta;
    DOM.btnSelectorConfirm.disabled = total === 0;
}

// Cambia la cantidad de un elemento y repinta solo sus filas (puede salir en "Recientes" y en
// su categoría a la vez) para no perder la posición de scroll de la lista.
function cambiarCantidadSelector(id, nueva) {
    id = String(id);
    if (nueva > 0) {
        selector.cantidades.set(id, nueva);
    } else {
        selector.cantidades.delete(id);
        selector.valores.delete(id); // al desmarcar se olvida lo editado: volverá a proponer los valores habituales
    }
    repintarFilasSelector(id);
    actualizarSelectorFooter();
}

function handleSelectorListClick(e) {
    const fila = e.target.closest('.selector-row');
    if (!fila || !selector.cfg) return;
    if (e.target.closest('[data-panel]')) return; // tocar los campos del panel no suma ni resta
    const id = fila.dataset.id;
    const { multi, contador, onConfirm } = selector.cfg;

    if (!multi) {
        cerrarSelector();
        onConfirm(new Map([[id, 1]]), new Map());
        return;
    }

    const actual = selector.cantidades.get(id) || 0;
    const paso = e.target.closest('[data-paso]');
    if (contador) {
        // Tocar el botón +/- suma o resta; tocar el resto de la fila equivale a "+1".
        cambiarCantidadSelector(id, Math.max(0, actual + (paso ? parseInt(paso.dataset.paso, 10) : 1)));
    } else {
        cambiarCantidadSelector(id, actual > 0 ? 0 : 1);
    }
}

function confirmarSelector() {
    if (!selector.cfg || totalSelector() === 0) return;
    const { onConfirm, panel, validar } = selector.cfg;
    const seleccion = new Map(selector.cantidades);
    // Valores finales de cada elemento marcado (editados o los propuestos por defecto).
    const valores = new Map();
    if (panel) seleccion.forEach((_, id) => valores.set(id, valoresSelector(id)));
    const error = validar?.(seleccion, valores);
    if (error) {
        showToast(error, 'error');
        return; // la hoja sigue abierta con todo lo marcado
    }
    cerrarSelector();
    onConfirm(seleccion, valores);
}

function initSelector() {
    DOM.btnCloseModalSelector.addEventListener('click', cerrarSelector);
    DOM.btnSelectorConfirm.addEventListener('click', confirmarSelector);
    DOM.btnSelectorCrear.addEventListener('click', () => {
        if (!selector.cfg?.onCrear) return;
        const { onCrear } = selector.cfg;
        const texto = selector.busqueda.trim();
        cerrarSelector();
        onCrear(texto);
    });
    DOM.selectorSearch.addEventListener('input', (e) => {
        selector.busqueda = e.target.value;
        renderSelectorLista();
    });
    DOM.selectorChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        selector.categoria = chip.dataset.value;
        setActiveChip(DOM.selectorChips, chip);
        renderSelectorLista();
    });
    DOM.selectorList.addEventListener('click', handleSelectorListClick);
    DOM.selectorList.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('selector-row')) {
            e.preventDefault();
            handleSelectorListClick(e);
        }
    });
    // Campos del panel de una fila marcada. Texto/número/fecha se guardan al teclear (sin
    // repintar, para no perder el foco); un desplegable puede condicionar otros campos
    // (p. ej. el detalle depende de la ubicación), así que tras guardarlo se repinta la fila.
    const guardarCampo = (e, repintar) => {
        const campo = e.target.closest('[data-campo]');
        const fila = e.target.closest('.selector-row');
        if (!campo || !fila || !selector.cfg?.panel) return;
        const id = fila.dataset.id;
        const valores = valoresSelector(id);
        const esCheck = campo.type === 'checkbox';
        valores[campo.dataset.campo] = esCheck ? campo.checked : campo.value;
        selector.cfg.panel.alCambiar?.(id, valores, campo.dataset.campo);
        if (repintar) {
            repintarFilasSelector(id);
        } else {
            // La misma fila puede estar también en "Recientes": se mantiene sincronizada.
            DOM.selectorList.querySelectorAll(`.selector-row[data-id="${CSS.escape(id)}"] [data-campo="${campo.dataset.campo}"]`)
                .forEach(otro => { if (otro !== campo) { if (esCheck) otro.checked = campo.checked; else otro.value = campo.value; } });
        }
    };
    DOM.selectorList.addEventListener('input', (e) => { if (e.target.tagName !== 'SELECT') guardarCampo(e, false); });
    DOM.selectorList.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') guardarCampo(e, true); });
    DOM.selectorAcciones.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-accion]');
        if (!btn || !selector.cfg) return;
        const mapa = selector.cfg.acciones[parseInt(btn.dataset.accion, 10)].fn();
        selector.cantidades = new Map([...mapa].map(([id, n]) => [String(id), n]));
        selector.valores = new Map();
        renderSelectorLista();
        actualizarSelectorFooter();
    });
    // Desplegable de arriba: aplica algo (p. ej. una ubicación) a todo lo que ya está marcado.
    DOM.selectorAcciones.addEventListener('change', (e) => {
        const sel = e.target.closest('[data-masivo]');
        if (!sel || !sel.value || !selector.cfg?.panel?.aplicarMasivo) return;
        selector.cantidades.forEach((_, id) => selector.cfg.panel.aplicarMasivo(valoresSelector(id), sel.value));
        sel.value = '';
        renderSelectorLista();
    });
}
