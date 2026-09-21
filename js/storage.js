/* ==========================================================================
   DespensaOnline - Storage and Local/Demo Mode Helpers
   ========================================================================== */

function validateLocalJSON(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.productos)) return false;
    if (!Array.isArray(data.ubicaciones) || data.ubicaciones.length === 0) data.ubicaciones = seedUbicacionesPorDefecto();
    if (!Array.isArray(data.despensa)) data.despensa = [];
    if (!Array.isArray(data.recetas)) data.recetas = [];
    if (!Array.isArray(data.recetaIngredientes)) data.recetaIngredientes = [];
    if (!Array.isArray(data.menuSemanal)) data.menuSemanal = [];
    if (!Array.isArray(data.listaCompra)) data.listaCompra = [];
    return true;
}

function seedUbicacionesPorDefecto() {
    return [
        { id: 1, nombre: 'Despensa', icono: '🥫', activa: true },
        { id: 2, nombre: 'Nevera', icono: '🧊', activa: true },
        { id: 3, nombre: 'Congelador', icono: '❄️', activa: true }
    ];
}

function nextId(collection) {
    return collection.length > 0 ? Math.max(...collection.map(x => Number(x.id))) + 1 : 1;
}

function renderAllScreens() {
    populateProductoSelectors();
    populateCategoriaSelectors();
    populateUbicacionSelectors();
    populateRecetaSelectors();
    renderDespensa();
    renderRecetas();
    renderMenuSemanal();
    renderListaCompra();
    renderProductosConfig();
    renderUbicacionesConfig();
}

/* ==========================================================================
   Modo Local: carga/guardado de fichero .json
   ========================================================================== */
function handleLocalFileSelected(file) {
    if (!file) return;
    if (!file.name.endsWith('.json')) {
        showToast('Por favor, selecciona un archivo .json válido', 'error');
        return;
    }

    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
        setLoading(false);
        try {
            const data = JSON.parse(e.target.result);
            if (validateLocalJSON(data)) {
                state.isLocalMode = true;
                state.isDemoMode = false;
                localStorage.setItem('despensa_is_local_mode', 'true');
                state.productos = data.productos;
                state.ubicaciones = data.ubicaciones;
                state.despensa = data.despensa || [];
                state.recetas = data.recetas || [];
                state.recetaIngredientes = data.recetaIngredientes || [];
                state.menuSemanal = data.menuSemanal || [];
                state.listaCompra = data.listaCompra || [];
                saveLocalCache();
                showAppInterface();
                updateLocalModeUI();
                renderAllScreens();
                showToast(`Base de datos '${file.name}' cargada correctamente`, 'success');
            } else {
                showToast('El archivo JSON no tiene una estructura compatible', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('Error al parsear el archivo JSON', 'error');
        }
    };
    reader.onerror = () => { setLoading(false); showToast('Error al leer el archivo', 'error'); };
    reader.readAsText(file);
}

function loadDefaultLocalStructure() {
    state.productos = [];
    state.ubicaciones = seedUbicacionesPorDefecto();
    state.despensa = [];
    state.recetas = [];
    state.recetaIngredientes = [];
    state.menuSemanal = [];
    state.listaCompra = [];
}

function createNewLocalDB() {
    if (state.productos.length > 0 || state.despensa.length > 0) {
        if (!confirm('Esto sobrescribirá los datos actuales en memoria. ¿Continuar?')) return;
    }
    state.isLocalMode = true;
    state.isDemoMode = false;
    localStorage.setItem('despensa_is_local_mode', 'true');
    loadDefaultLocalStructure();
    saveLocalCache();
    showAppInterface();
    updateLocalModeUI();
    renderAllScreens();
    showToast('Nueva base de datos local creada', 'success');
}

function saveLocalCache() {
    localStorage.setItem('despensa_local_db', JSON.stringify({
        productos: state.productos,
        ubicaciones: state.ubicaciones,
        despensa: state.despensa,
        recetas: state.recetas,
        recetaIngredientes: state.recetaIngredientes,
        menuSemanal: state.menuSemanal,
        listaCompra: state.listaCompra
    }));
}

function updateLocalModeUI() {
    if (state.isLocalMode) {
        DOM.apiStatus.className = 'api-status-badge local-mode';
        DOM.apiStatusText.textContent = 'Archivo Local';
        DOM.btnDownloadLocal.classList.remove('hidden');
        DOM.cardConfigLocal.classList.remove('hidden');
        DOM.configModoActual.textContent = 'Modo Local: los datos se guardan en este dispositivo (localStorage) y puedes exportarlos/importarlos como copia de seguridad .json.';
        DOM.demoModeBadge.classList.add('hidden');
    } else if (state.isDemoMode) {
        DOM.apiStatus.className = 'api-status-badge connected';
        DOM.apiStatusText.textContent = 'Modo Demo';
        DOM.btnDownloadLocal.classList.add('hidden');
        DOM.cardConfigLocal.classList.add('hidden');
        DOM.configModoActual.textContent = 'Modo Demo: los datos son de ejemplo y solo existen en memoria; se perderán al recargar la página.';
        DOM.demoModeBadge.classList.remove('hidden');
    } else if (state.apiUrl && state.supabaseKey) {
        DOM.apiStatus.className = 'api-status-badge connected';
        DOM.apiStatusText.textContent = 'Supabase';
        DOM.btnDownloadLocal.classList.add('hidden');
        DOM.cardConfigLocal.classList.add('hidden');
        DOM.configModoActual.textContent = 'Conectado a Supabase: los datos se guardan en la nube y se sincronizan en tiempo real entre pestañas y dispositivos.';
        DOM.demoModeBadge.classList.add('hidden');
    } else {
        DOM.apiStatus.className = 'api-status-badge disconnected';
        DOM.apiStatusText.textContent = 'Desconectado';
        DOM.btnDownloadLocal.classList.add('hidden');
        DOM.cardConfigLocal.classList.add('hidden');
        DOM.configModoActual.textContent = 'Sin conectar.';
        DOM.demoModeBadge.classList.add('hidden');
    }
    updateSupabaseConfigUI();
}

function updateSupabaseConfigUI() {
    const conectado = !!(state.apiUrl && state.supabaseKey);
    if (DOM.configSupabaseInfo) {
        DOM.configSupabaseInfo.textContent = conectado ? `Conectado a ${state.apiUrl}` : 'Sin conectar.';
    }
    if (DOM.btnConfigSupabaseDisconnect) {
        DOM.btnConfigSupabaseDisconnect.classList.toggle('hidden', !conectado);
    }
}

function downloadLocalDB() {
    const dbData = {
        productos: state.productos,
        ubicaciones: state.ubicaciones,
        despensa: state.despensa,
        recetas: state.recetas,
        recetaIngredientes: state.recetaIngredientes,
        menuSemanal: state.menuSemanal,
        listaCompra: state.listaCompra
    };
    const blob = new Blob([JSON.stringify(dbData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `despensa_online_${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Copia de seguridad descargada con éxito', 'success');
}

function deleteLocalDB() {
    if (!confirm('¿Eliminar la base de datos local guardada en este dispositivo? Esta acción no se puede deshacer. Si quieres conservarla, descárgala antes con "Descargar base de datos".')) return;
    localStorage.removeItem('despensa_local_db');
    localStorage.removeItem('despensa_is_local_mode');
    location.reload();
}

function checkLocalCache() {
    const wasLocal = localStorage.getItem('despensa_is_local_mode') === 'true';
    if (wasLocal) {
        const cached = localStorage.getItem('despensa_local_db');
        if (cached) {
            try {
                const data = JSON.parse(cached);
                if (validateLocalJSON(data)) {
                    state.isLocalMode = true;
                    state.isDemoMode = false;
                    state.productos = data.productos;
                    state.ubicaciones = data.ubicaciones;
                    state.despensa = data.despensa || [];
                    state.recetas = data.recetas || [];
                    state.recetaIngredientes = data.recetaIngredientes || [];
                    state.menuSemanal = data.menuSemanal || [];
                    state.listaCompra = data.listaCompra || [];

                    showAppInterface();
                    updateLocalModeUI();
                    renderAllScreens();
                }
            } catch (e) {
                console.error('Error cargando la base de datos local en caché', e);
            }
        }
        return;
    }

    // Si hay credenciales de Supabase guardadas de una sesión anterior, reconectar directamente
    // sin pasar por la landing (ver ARQUITECTURA-PLANTILLA.md §4.4: "al arrancar, si hay
    // credenciales guardadas, cargar datos + abrir Realtime").
    if (state.apiUrl && state.supabaseKey) {
        connectSupabase(state.apiUrl, state.supabaseKey);
    }
}

/* ==========================================================================
   Modo Demo: datos de ejemplo en memoria
   ========================================================================== */
function loadDemoData() {
    state.productos = [
        { id: 1, nombre: 'Huevos', categoria: 'Lácteos y huevos', unidad: 'ud', icono: '🥚', activa: true },
        { id: 2, nombre: 'Leche', categoria: 'Lácteos y huevos', unidad: 'l', stock_minimo: 2, icono: '🥛', activa: true }, // ejemplo de reposición automática: solo hay 1l en la despensa
        { id: 3, nombre: 'Harina', categoria: 'Despensa seca', unidad: 'g', icono: '🌾', activa: true },
        { id: 4, nombre: 'Tomate', categoria: 'Verdura', unidad: 'ud', icono: '🍅', activa: true },
        { id: 5, nombre: 'Cebolla', categoria: 'Verdura', unidad: 'ud', icono: '🧅', activa: true },
        { id: 6, nombre: 'Arroz', categoria: 'Despensa seca', unidad: 'g', icono: '🍚', activa: true },
        { id: 7, nombre: 'Pechuga de pollo', categoria: 'Carne', unidad: 'g', icono: '🍗', activa: true },
        { id: 8, nombre: 'Pasta', categoria: 'Despensa seca', unidad: 'g', icono: '🍝', activa: true },
        { id: 9, nombre: 'Queso rallado', categoria: 'Lácteos y huevos', unidad: 'g', icono: '🧀', activa: true },
        { id: 10, nombre: 'Aceite de oliva', categoria: 'Condimentos', unidad: 'ml', icono: '🫒', activa: true }
    ];

    state.ubicaciones = seedUbicacionesPorDefecto();

    const hoy = todayISO();
    state.despensa = [
        { id: 1, productoId: 1, cantidad: 6, ubicacionId: 2, fecha_caducidad: addDaysToISO(hoy, 12), fecha_entrada: hoy, activa: true },
        { id: 2, productoId: 2, cantidad: 1, ubicacionId: 2, fecha_caducidad: addDaysToISO(hoy, 2), fecha_entrada: hoy, activa: true },
        { id: 3, productoId: 3, cantidad: 500, ubicacionId: 1, fecha_caducidad: null, fecha_entrada: hoy, activa: true },
        { id: 4, productoId: 4, cantidad: 2, ubicacionId: 2, fecha_caducidad: addDaysToISO(hoy, -1), fecha_entrada: hoy, activa: true },
        { id: 5, productoId: 6, cantidad: 1000, ubicacionId: 1, fecha_caducidad: null, fecha_entrada: hoy, activa: true },
        { id: 6, productoId: 7, cantidad: 300, ubicacionId: 3, detalle_ubicacion: 'Cajón 2', fecha_caducidad: addDaysToISO(hoy, 60), fecha_entrada: hoy, activa: true },
        { id: 7, productoId: 10, cantidad: 250, ubicacionId: 1, fecha_caducidad: null, fecha_entrada: hoy, activa: true }
    ];

    state.recetas = [
        { id: 1, nombre: 'Tortilla de patatas', categoria: 'comida', tiempo_preparacion_min: 30, comensales_base: 2, requiere_cocinado: true, instrucciones: 'Freír, batir los huevos con la cebolla pochada y cuajar en la sartén.', activa: true },
        { id: 2, nombre: 'Arroz con pollo', categoria: 'comida', tiempo_preparacion_min: 40, comensales_base: 4, requiere_cocinado: true, instrucciones: 'Sofreír el pollo y la verdura, añadir el arroz y el caldo, cocer.', activa: true },
        // Receta "de montar": no lleva la marca general (no es un guiso conjunto), solo
        // la pasta necesita cocinarse — el tomate frito y el queso rallado ya están listos.
        { id: 3, nombre: 'Pasta con tomate y queso', categoria: 'cena', tiempo_preparacion_min: 20, comensales_base: 2, requiere_cocinado: false, instrucciones: 'Cocer la pasta, mezclar con el tomate frito y espolvorear el queso.', activa: true }
    ];

    state.recetaIngredientes = [
        { id: 1, recetaId: 1, productoId: 1, cantidad: 4 },
        { id: 2, recetaId: 1, productoId: 5, cantidad: 1 },
        { id: 3, recetaId: 1, productoId: 10, cantidad: 30 },
        { id: 4, recetaId: 2, productoId: 7, cantidad: 400 },
        { id: 5, recetaId: 2, productoId: 6, cantidad: 320 },
        { id: 6, recetaId: 2, productoId: 5, cantidad: 1 },
        { id: 7, recetaId: 2, productoId: 4, cantidad: 2 },
        { id: 8, recetaId: 3, productoId: 8, cantidad: 200, requiere_cocinado: true }, // la pasta sí hay que cocerla
        { id: 9, recetaId: 3, productoId: 4, cantidad: 3 },
        { id: 10, recetaId: 3, productoId: 9, cantidad: 60 }
    ];

    const lunes = state.selectedWeekStart;
    state.menuSemanal = [
        { id: 1, fecha: lunes, tipo_comida: 'comida', recetaId: 1, comensales: 2, activa: true },
        { id: 2, fecha: addDaysToISO(lunes, 2), tipo_comida: 'comida', recetaId: 2, comensales: 4, activa: true },
        { id: 3, fecha: addDaysToISO(lunes, 3), tipo_comida: 'cena', recetaId: 3, comensales: 2, activa: true }
    ];

    state.listaCompra = [
        { id: 1, productoId: 9, cantidad: 100, comprado: false, origen: 'manual', fecha_creacion: new Date().toISOString() }
    ];

    renderAllScreens();
}

/* ==========================================================================
   Escritura de datos en Demo / Local
   ========================================================================== */
function applyWriteAction(action, data, persist) {
    const commit = () => { if (persist) saveLocalCache(); };

    switch (action) {
        case 'producto': {
            const id = nextId(state.productos);
            state.productos.push({
                id, nombre: data.nombre, categoria: data.categoria || '', unidad: data.unidad || 'ud',
                stock_minimo: data.stock_minimo ? parseFloat(data.stock_minimo) : null, icono: data.icono || '🍽️', activa: true
            });
            commit();
            return { success: true, id, message: 'Producto creado' };
        }
        case 'editar_producto': {
            const p = state.productos.find(pr => pr.id == data.id);
            if (!p) return { success: false, error: 'Producto no encontrado' };
            if (data.nombre !== undefined) p.nombre = data.nombre;
            if (data.categoria !== undefined) p.categoria = data.categoria;
            if (data.unidad !== undefined) p.unidad = data.unidad;
            if (data.stock_minimo !== undefined) p.stock_minimo = data.stock_minimo ? parseFloat(data.stock_minimo) : null;
            if (data.icono !== undefined) p.icono = data.icono;
            if (data.activa !== undefined) p.activa = !!data.activa;
            commit();
            return { success: true, message: 'Producto actualizado' };
        }
        case 'eliminar_producto': {
            const p = state.productos.find(pr => pr.id == data.id);
            if (!p) return { success: false, error: 'Producto no encontrado' };
            p.activa = false;
            commit();
            return { success: true, message: 'Producto desactivado' };
        }

        case 'ubicacion': {
            const id = nextId(state.ubicaciones);
            state.ubicaciones.push({ id, nombre: data.nombre, icono: data.icono || '📍', activa: true });
            commit();
            return { success: true, id, message: 'Ubicación creada' };
        }
        case 'eliminar_ubicacion': {
            const u = state.ubicaciones.find(ub => ub.id == data.id);
            if (!u) return { success: false, error: 'Ubicación no encontrada' };
            u.activa = false;
            commit();
            return { success: true, message: 'Ubicación desactivada' };
        }

        case 'despensa_lote': {
            const id = nextId(state.despensa);
            state.despensa.push({
                id,
                productoId: Number(data.productoId),
                cantidad: parseFloat(data.cantidad) || 0,
                ubicacionId: Number(data.ubicacionId),
                detalle_ubicacion: data.detalle_ubicacion || null,
                fecha_caducidad: data.fecha_caducidad || null,
                fecha_entrada: data.fecha_entrada || todayISO(),
                activa: true
            });
            commit();
            return { success: true, id, message: 'Producto añadido a la despensa' };
        }
        case 'editar_despensa_lote': {
            const l = state.despensa.find(lo => lo.id == data.id);
            if (!l) return { success: false, error: 'Lote no encontrado' };
            if (data.productoId !== undefined) l.productoId = Number(data.productoId);
            if (data.cantidad !== undefined) l.cantidad = parseFloat(data.cantidad) || 0;
            if (data.ubicacionId !== undefined) l.ubicacionId = Number(data.ubicacionId);
            if (data.detalle_ubicacion !== undefined) l.detalle_ubicacion = data.detalle_ubicacion || null;
            if (data.fecha_caducidad !== undefined) l.fecha_caducidad = data.fecha_caducidad || null;
            if (data.fecha_entrada !== undefined) l.fecha_entrada = data.fecha_entrada;
            commit();
            return { success: true, message: 'Lote actualizado' };
        }
        case 'eliminar_despensa_lote': {
            state.despensa = state.despensa.filter(l => l.id != data.id);
            commit();
            return { success: true, message: 'Lote eliminado de la despensa' };
        }

        case 'receta': {
            const id = nextId(state.recetas);
            state.recetas.push({
                id,
                nombre: data.nombre,
                categoria: data.categoria || 'comida',
                tiempo_preparacion_min: data.tiempo_preparacion_min ? Number(data.tiempo_preparacion_min) : null,
                comensales_base: Number(data.comensales_base) || 1,
                requiere_cocinado: data.requiere_cocinado !== undefined ? !!data.requiere_cocinado : true,
                instrucciones: data.instrucciones || '',
                activa: true
            });
            let nextIngId = nextId(state.recetaIngredientes);
            (data.ingredientes || []).forEach(ing => {
                state.recetaIngredientes.push({
                    id: nextIngId++, recetaId: id, productoId: Number(ing.productoId), cantidad: parseFloat(ing.cantidad) || 0,
                    requiere_cocinado: !!ing.requiere_cocinado
                });
            });
            commit();
            return { success: true, id, message: 'Receta creada' };
        }
        case 'editar_receta': {
            const r = state.recetas.find(re => re.id == data.id);
            if (!r) return { success: false, error: 'Receta no encontrada' };
            if (data.nombre !== undefined) r.nombre = data.nombre;
            if (data.categoria !== undefined) r.categoria = data.categoria;
            if (data.tiempo_preparacion_min !== undefined) r.tiempo_preparacion_min = data.tiempo_preparacion_min ? Number(data.tiempo_preparacion_min) : null;
            if (data.comensales_base !== undefined) r.comensales_base = Number(data.comensales_base) || 1;
            if (data.requiere_cocinado !== undefined) r.requiere_cocinado = !!data.requiere_cocinado;
            if (data.instrucciones !== undefined) r.instrucciones = data.instrucciones;
            if (data.ingredientes !== undefined) {
                // Sustitución completa de ingredientes (más simple que un diff fino para una app básica)
                state.recetaIngredientes = state.recetaIngredientes.filter(ri => ri.recetaId != data.id);
                let nextIngId = nextId(state.recetaIngredientes);
                data.ingredientes.forEach(ing => {
                    state.recetaIngredientes.push({
                        id: nextIngId++, recetaId: r.id, productoId: Number(ing.productoId), cantidad: parseFloat(ing.cantidad) || 0,
                        requiere_cocinado: !!ing.requiere_cocinado
                    });
                });
            }
            commit();
            return { success: true, message: 'Receta actualizada' };
        }
        case 'eliminar_receta': {
            state.recetas = state.recetas.filter(r => r.id != data.id);
            state.recetaIngredientes = state.recetaIngredientes.filter(ri => ri.recetaId != data.id);
            state.menuSemanal = state.menuSemanal.filter(m => m.recetaId != data.id);
            commit();
            return { success: true, message: 'Receta eliminada' };
        }

        case 'menu_entry': {
            const id = nextId(state.menuSemanal);
            state.menuSemanal.push({ id, fecha: data.fecha, tipo_comida: data.tipo_comida, recetaId: Number(data.recetaId), comensales: Number(data.comensales) || 1, activa: true });
            commit();
            return { success: true, id, message: 'Menú actualizado' };
        }
        case 'editar_menu_entry': {
            const m = state.menuSemanal.find(me => me.id == data.id);
            if (!m) return { success: false, error: 'Entrada de menú no encontrada' };
            if (data.recetaId !== undefined) m.recetaId = Number(data.recetaId);
            if (data.comensales !== undefined) m.comensales = Number(data.comensales) || 1;
            commit();
            return { success: true, message: 'Menú actualizado' };
        }
        case 'eliminar_menu_entry': {
            state.menuSemanal = state.menuSemanal.filter(m => m.id != data.id);
            commit();
            return { success: true, message: 'Receta quitada del menú' };
        }

        case 'lista_compra_item': {
            const id = nextId(state.listaCompra);
            state.listaCompra.push({ id, productoId: Number(data.productoId), cantidad: parseFloat(data.cantidad) || 0, comprado: false, origen: data.origen || 'manual', fecha_creacion: new Date().toISOString() });
            commit();
            return { success: true, id, message: 'Producto añadido a la lista de la compra' };
        }
        case 'editar_lista_compra_item': {
            const li = state.listaCompra.find(item => item.id == data.id);
            if (!li) return { success: false, error: 'Producto no encontrado en la lista' };
            if (data.cantidad !== undefined) li.cantidad = parseFloat(data.cantidad) || 0;
            if (data.comprado !== undefined) li.comprado = !!data.comprado;
            commit();
            return { success: true, message: 'Lista de la compra actualizada' };
        }
        case 'eliminar_lista_compra_item': {
            state.listaCompra = state.listaCompra.filter(item => item.id != data.id);
            commit();
            return { success: true, message: 'Producto quitado de la lista' };
        }
    }

    return { success: false, error: 'Acción no contemplada' };
}

function handleDemoWriteAction(action, data) {
    return applyWriteAction(action, data, false);
}

function handleLocalWriteAction(action, data) {
    return applyWriteAction(action, data, true);
}
