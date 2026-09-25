/* ==========================================================================
   DespensaOnline - Capa de acceso a datos (apiRequest) + backend Supabase
   ========================================================================== */

// apiRequest(action, method, data) es el único punto de entrada a datos: ninguna
// pantalla debe leer/escribir el estado directamente fuera de esta función.
async function apiRequest(action, method = 'GET', data = null) {
    if (state.isDemoMode) {
        return handleDemoWriteAction(action, data);
    }

    if (state.isLocalMode) {
        return handleLocalWriteAction(action, data);
    }

    if (state.apiUrl && state.supabaseKey) {
        return handleSupabaseWriteAction(action, method, data);
    }

    showToast('No hay ninguna base de datos conectada.', 'error');
    return { success: false, error: 'Sin backend activo' };
}

/* ==========================================================================
   Supabase: cliente REST (fetch directo, ver ARQUITECTURA-PLANTILLA.md §4.3)
   ========================================================================== */
async function supabaseFetch(path, options = {}) {
    const res = await fetch(`${state.apiUrl}/rest/v1/${path}`, {
        mode: 'cors',
        ...options,
        headers: {
            'apikey': state.supabaseKey,
            'Authorization': `Bearer ${state.supabaseKey}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    if (!res.ok) {
        let detalle = '';
        try { detalle = (await res.json()).message || ''; } catch (e) { /* respuesta sin JSON */ }
        throw new Error(detalle || `Error HTTP ${res.status}`);
    }

    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

function supabaseWrite(path, method, body) {
    return supabaseFetch(path, { method, headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
}

/* ==========================================================================
   Conectar / desconectar
   ========================================================================== */
async function connectSupabase(url, key) {
    setLoading(true);
    try {
        const testRes = await fetch(`${url}/rest/v1/productos?select=id&limit=1`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` }
        });
        if (!testRes.ok) {
            if (testRes.status === 401 || testRes.status === 403) throw new Error('Anon key incorrecta o sin permisos sobre las tablas.');
            if (testRes.status === 404) throw new Error('No se encontró la tabla "productos". ¿Has ejecutado el SQL de creación de tablas?');
            throw new Error(`No se pudo conectar (HTTP ${testRes.status}). Revisa la Project URL.`);
        }

        state.supabaseApiUrl = url;
        state.supabaseKey = key;
        localStorage.setItem('despensa_supabase_api_url', url);
        localStorage.setItem('despensa_supabase_key', key);
        localStorage.removeItem('despensa_is_local_mode');
        state.isLocalMode = false;
        state.isDemoMode = false;

        await loadSupabaseData();
        showAppInterface();
        updateLocalModeUI();
        renderAllScreens();
        initSupabaseRealtime();
        showToast('Conectado a Supabase correctamente', 'success');
        return true;
    } catch (err) {
        console.error(err);
        showToast(`Error al conectar con Supabase: ${err.message}`, 'error');
        return false;
    } finally {
        setLoading(false);
    }
}

function disconnectSupabase() {
    if (state.supabaseChannel && window.supabase) {
        try { state.supabaseChannel.unsubscribe(); } catch (e) { /* ya desconectado */ }
    }
    localStorage.removeItem('despensa_supabase_api_url');
    localStorage.removeItem('despensa_supabase_key');
    location.reload();
}

async function loadSupabaseData() {
    const [productos, ubicaciones, despensa, recetas, recetaIngredientes, menuSemanal, listaCompra] = await Promise.all([
        supabaseFetch('productos?order=id.asc'),
        supabaseFetch('ubicaciones?order=id.asc'),
        supabaseFetch('despensa?order=id.asc'),
        supabaseFetch('recetas?order=id.asc'),
        supabaseFetch('receta_ingredientes?order=id.asc'),
        supabaseFetch('menu_semanal?order=id.asc'),
        supabaseFetch('lista_compra?order=id.asc')
    ]);
    state.productos = productos || [];
    state.ubicaciones = ubicaciones || [];
    state.despensa = despensa || [];
    state.recetas = recetas || [];
    state.recetaIngredientes = recetaIngredientes || [];
    state.menuSemanal = menuSemanal || [];
    state.listaCompra = listaCompra || [];
}

/* ==========================================================================
   Realtime: mantiene sincronizadas varias pestañas/dispositivos a la vez
   (ver ARQUITECTURA-PLANTILLA.md §4.3-4.4: debounce 300ms, un canal, varias tablas)
   ========================================================================== */
const REALTIME_TABLAS = ['despensa', 'ubicaciones', 'menu_semanal', 'lista_compra'];
let supabaseRealtimeTimers = {};

function initSupabaseRealtime() {
    if (typeof window.supabase === 'undefined') {
        console.warn('supabase-js no disponible: Realtime desactivado, la app seguirá funcionando sin sincronización en vivo.');
        return;
    }
    if (state.supabaseChannel) return;

    const client = window.supabase.createClient(state.apiUrl, state.supabaseKey);
    let channel = client.channel('despensa-online-cambios');
    REALTIME_TABLAS.forEach(tabla => {
        channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, () => {
            clearTimeout(supabaseRealtimeTimers[tabla]);
            supabaseRealtimeTimers[tabla] = setTimeout(() => refreshSupabaseTable(tabla), 300);
        });
    });
    channel.subscribe();
    state.supabaseChannel = channel;
}

async function refreshSupabaseTable(tabla) {
    try {
        switch (tabla) {
            case 'despensa':
                state.despensa = await supabaseFetch('despensa?order=id.asc') || [];
                renderDespensa();
                renderListaCompra();
                break;
            case 'ubicaciones':
                state.ubicaciones = await supabaseFetch('ubicaciones?order=id.asc') || [];
                populateUbicacionSelectors();
                renderUbicacionesConfig();
                renderDespensa();
                break;
            case 'menu_semanal':
                state.menuSemanal = await supabaseFetch('menu_semanal?order=id.asc') || [];
                renderMenuSemanal();
                break;
            case 'lista_compra':
                state.listaCompra = await supabaseFetch('lista_compra?order=id.asc') || [];
                renderListaCompra();
                break;
        }
    } catch (err) {
        console.error('Error al sincronizar', tabla, err);
    }
}

// Al volver a primer plano: reconectar Realtime si murió y forzar una resincronización de seguridad.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!(state.apiUrl && state.supabaseKey)) return;
    if (!state.supabaseChannel) initSupabaseRealtime();
    loadSupabaseData().then(renderAllScreens).catch(err => console.error('Error al resincronizar con Supabase', err));
});

/* ==========================================================================
   Escritura de datos en Supabase (misma forma de respuesta que Demo/Local:
   además de escribir en remoto, refleja el cambio en `state` al vuelo para
   que el resto de la app no necesite saber qué backend está activo)
   ========================================================================== */
async function handleSupabaseWriteAction(action, method, data) {
    try {
        switch (action) {
            case 'producto': {
                const [row] = await supabaseWrite('productos', 'POST', {
                    nombre: data.nombre, categoria: data.categoria || '', unidad: data.unidad || 'ud',
                    stock_minimo: data.stock_minimo ? parseFloat(data.stock_minimo) : null,
                    supermercado: data.supermercado || null, icono: data.icono || '', activa: true
                });
                state.productos.push(row);
                return { success: true, id: row.id, message: 'Producto creado' };
            }
            case 'editar_producto': {
                const payload = {};
                ['nombre', 'categoria', 'unidad', 'icono'].forEach(k => { if (data[k] !== undefined) payload[k] = data[k]; });
                if (data.stock_minimo !== undefined) payload.stock_minimo = data.stock_minimo ? parseFloat(data.stock_minimo) : null;
                if (data.supermercado !== undefined) payload.supermercado = data.supermercado || null;
                if (data.activa !== undefined) payload.activa = !!data.activa;
                const [row] = await supabaseWrite(`productos?id=eq.${data.id}`, 'PATCH', payload);
                if (!row) return { success: false, error: 'Producto no encontrado' };
                Object.assign(state.productos.find(p => p.id == data.id) || {}, row);
                return { success: true, message: 'Producto actualizado' };
            }
            case 'eliminar_producto': {
                const [row] = await supabaseWrite(`productos?id=eq.${data.id}`, 'PATCH', { activa: false });
                if (!row) return { success: false, error: 'Producto no encontrado' };
                const p = state.productos.find(pr => pr.id == data.id);
                if (p) p.activa = false;
                return { success: true, message: 'Producto desactivado' };
            }

            case 'ubicacion': {
                const [row] = await supabaseWrite('ubicaciones', 'POST', { nombre: data.nombre, icono: data.icono || '', activa: true });
                state.ubicaciones.push(row);
                return { success: true, id: row.id, message: 'Ubicación creada' };
            }
            case 'eliminar_ubicacion': {
                const [row] = await supabaseWrite(`ubicaciones?id=eq.${data.id}`, 'PATCH', { activa: false });
                if (!row) return { success: false, error: 'Ubicación no encontrada' };
                const u = state.ubicaciones.find(ub => ub.id == data.id);
                if (u) u.activa = false;
                return { success: true, message: 'Ubicación desactivada' };
            }

            case 'despensa_lote': {
                const [row] = await supabaseWrite('despensa', 'POST', {
                    productoId: Number(data.productoId),
                    cantidad: parseFloat(data.cantidad) || 0,
                    ubicacionId: Number(data.ubicacionId),
                    detalle_ubicacion: data.detalle_ubicacion || null,
                    fecha_caducidad: data.fecha_caducidad || null,
                    fecha_entrada: data.fecha_entrada || todayISO(),
                    no_requiere_descongelar: !!data.no_requiere_descongelar,
                    activa: true
                });
                state.despensa.push(row);
                return { success: true, id: row.id, message: 'Producto añadido a la despensa' };
            }
            case 'editar_despensa_lote': {
                const payload = {};
                if (data.productoId !== undefined) payload.productoId = Number(data.productoId);
                if (data.cantidad !== undefined) payload.cantidad = parseFloat(data.cantidad) || 0;
                if (data.ubicacionId !== undefined) payload.ubicacionId = Number(data.ubicacionId);
                if (data.detalle_ubicacion !== undefined) payload.detalle_ubicacion = data.detalle_ubicacion || null;
                if (data.fecha_caducidad !== undefined) payload.fecha_caducidad = data.fecha_caducidad || null;
                if (data.fecha_entrada !== undefined) payload.fecha_entrada = data.fecha_entrada;
                if (data.no_requiere_descongelar !== undefined) payload.no_requiere_descongelar = !!data.no_requiere_descongelar;
                const [row] = await supabaseWrite(`despensa?id=eq.${data.id}`, 'PATCH', payload);
                if (!row) return { success: false, error: 'Lote no encontrado' };
                Object.assign(state.despensa.find(l => l.id == data.id) || {}, row);
                return { success: true, message: 'Lote actualizado' };
            }
            case 'eliminar_despensa_lote': {
                await supabaseFetch(`despensa?id=eq.${data.id}`, { method: 'DELETE' });
                state.despensa = state.despensa.filter(l => l.id != data.id);
                return { success: true, message: 'Lote eliminado de la despensa' };
            }

            case 'receta': {
                const [recetaRow] = await supabaseWrite('recetas', 'POST', {
                    nombre: data.nombre,
                    categoria: data.categoria || 'comida',
                    tiempo_preparacion_min: data.tiempo_preparacion_min ? Number(data.tiempo_preparacion_min) : null,
                    comensales_base: Number(data.comensales_base) || 1,
                    requiere_cocinado: data.requiere_cocinado !== undefined ? !!data.requiere_cocinado : true,
                    instrucciones: data.instrucciones || '',
                    activa: true
                });
                state.recetas.push(recetaRow);

                const ingredientes = (data.ingredientes || []).map(ing => ({
                    recetaId: recetaRow.id, productoId: Number(ing.productoId), cantidad: parseFloat(ing.cantidad) || 0,
                    requiere_cocinado: !!ing.requiere_cocinado
                }));
                if (ingredientes.length > 0) {
                    const ingRows = await supabaseWrite('receta_ingredientes', 'POST', ingredientes);
                    state.recetaIngredientes.push(...ingRows);
                }
                return { success: true, id: recetaRow.id, message: 'Receta creada' };
            }
            case 'editar_receta': {
                const payload = {};
                ['nombre', 'categoria', 'instrucciones'].forEach(k => { if (data[k] !== undefined) payload[k] = data[k]; });
                if (data.tiempo_preparacion_min !== undefined) payload.tiempo_preparacion_min = data.tiempo_preparacion_min ? Number(data.tiempo_preparacion_min) : null;
                if (data.comensales_base !== undefined) payload.comensales_base = Number(data.comensales_base) || 1;
                if (data.requiere_cocinado !== undefined) payload.requiere_cocinado = !!data.requiere_cocinado;

                const [row] = await supabaseWrite(`recetas?id=eq.${data.id}`, 'PATCH', payload);
                if (!row) return { success: false, error: 'Receta no encontrada' };
                Object.assign(state.recetas.find(r => r.id == data.id) || {}, row);

                if (data.ingredientes !== undefined) {
                    await supabaseFetch(`receta_ingredientes?recetaId=eq.${data.id}`, { method: 'DELETE' });
                    state.recetaIngredientes = state.recetaIngredientes.filter(ri => ri.recetaId != data.id);
                    const nuevos = data.ingredientes.map(ing => ({
                        recetaId: Number(data.id), productoId: Number(ing.productoId), cantidad: parseFloat(ing.cantidad) || 0,
                        requiere_cocinado: !!ing.requiere_cocinado
                    }));
                    if (nuevos.length > 0) {
                        const ingRows = await supabaseWrite('receta_ingredientes', 'POST', nuevos);
                        state.recetaIngredientes.push(...ingRows);
                    }
                }
                return { success: true, message: 'Receta actualizada' };
            }
            case 'eliminar_receta': {
                await supabaseFetch(`receta_ingredientes?recetaId=eq.${data.id}`, { method: 'DELETE' });
                await supabaseFetch(`menu_semanal?recetaId=eq.${data.id}`, { method: 'DELETE' });
                await supabaseFetch(`recetas?id=eq.${data.id}`, { method: 'DELETE' });
                state.recetaIngredientes = state.recetaIngredientes.filter(ri => ri.recetaId != data.id);
                state.menuSemanal = state.menuSemanal.filter(m => m.recetaId != data.id);
                state.recetas = state.recetas.filter(r => r.id != data.id);
                return { success: true, message: 'Receta eliminada' };
            }

            case 'menu_entry': {
                const [row] = await supabaseWrite('menu_semanal', 'POST', {
                    fecha: data.fecha, tipo_comida: data.tipo_comida, recetaId: Number(data.recetaId),
                    comensales: Number(data.comensales) || 1, activa: true
                });
                state.menuSemanal.push(row);
                return { success: true, id: row.id, message: 'Menú actualizado' };
            }
            case 'editar_menu_entry': {
                const payload = {};
                if (data.recetaId !== undefined) payload.recetaId = Number(data.recetaId);
                if (data.comensales !== undefined) payload.comensales = Number(data.comensales) || 1;
                if (data.precocinado !== undefined) payload.precocinado = !!data.precocinado;
                if (data.descongelados !== undefined) payload.descongelados = (data.descongelados || []).map(Number);
                const [row] = await supabaseWrite(`menu_semanal?id=eq.${data.id}`, 'PATCH', payload);
                if (!row) return { success: false, error: 'Entrada de menú no encontrada' };
                Object.assign(state.menuSemanal.find(m => m.id == data.id) || {}, row);
                return { success: true, message: 'Menú actualizado' };
            }
            case 'eliminar_menu_entry': {
                await supabaseFetch(`menu_semanal?id=eq.${data.id}`, { method: 'DELETE' });
                state.menuSemanal = state.menuSemanal.filter(m => m.id != data.id);
                return { success: true, message: 'Receta quitada del menú' };
            }

            case 'lista_compra_item': {
                const [row] = await supabaseWrite('lista_compra', 'POST', {
                    productoId: Number(data.productoId), cantidad: parseFloat(data.cantidad) || 0,
                    comprado: false, origen: data.origen || 'manual', fecha_creacion: new Date().toISOString()
                });
                state.listaCompra.push(row);
                return { success: true, id: row.id, message: 'Producto añadido a la lista de la compra' };
            }
            case 'editar_lista_compra_item': {
                const payload = {};
                if (data.cantidad !== undefined) payload.cantidad = parseFloat(data.cantidad) || 0;
                if (data.comprado !== undefined) payload.comprado = !!data.comprado;
                const [row] = await supabaseWrite(`lista_compra?id=eq.${data.id}`, 'PATCH', payload);
                if (!row) return { success: false, error: 'Producto no encontrado en la lista' };
                Object.assign(state.listaCompra.find(li => li.id == data.id) || {}, row);
                return { success: true, message: 'Lista de la compra actualizada' };
            }
            case 'eliminar_lista_compra_item': {
                await supabaseFetch(`lista_compra?id=eq.${data.id}`, { method: 'DELETE' });
                state.listaCompra = state.listaCompra.filter(item => item.id != data.id);
                return { success: true, message: 'Producto quitado de la lista' };
            }
        }
        return { success: false, error: 'Acción no contemplada' };
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message || 'Error de conexión con Supabase' };
    }
}
