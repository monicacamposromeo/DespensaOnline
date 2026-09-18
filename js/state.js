/* ==========================================================================
   DespensaOnline - State & Data Indexing Module
   ========================================================================== */

const TIPOS_COMIDA = ['desayuno', 'comida', 'cena'];
const TIPO_COMIDA_LABELS = { desayuno: 'Desayuno', comida: 'Comida', cena: 'Cena' };
const CATEGORIA_RECETA_LABELS = { desayuno: 'Desayuno', comida: 'Comida', cena: 'Cena', postre: 'Postre', snack: 'Snack' };
const DIAS_SEMANA_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIAS_ALERTA_CADUCIDAD = 3;

// App State
const state = {
    supabaseApiUrl: localStorage.getItem('despensa_supabase_api_url') || '',
    supabaseKey: localStorage.getItem('despensa_supabase_key') || '',
    get apiUrl() {
        return this.supabaseApiUrl;
    },

    isDemoMode: false,
    isLocalMode: false,
    supabaseChannel: null,

    productos: [],
    ubicaciones: [],
    despensa: [],
    recetas: [],
    recetaIngredientes: [],
    menuSemanal: [],
    listaCompra: [],

    editingLoteId: null,
    editingRecetaId: null,
    editingMenuEntry: null,

    despensaFiltro: { search: '', ubicacion: 'todas' },
    recetasFiltro: { categoria: 'todas' },

    loadedScreens: { despensa: false, recetas: false, menu: false, compra: false, configuracion: false }
};

// DOM Elements
const DOM = {
    appInterface: document.getElementById('app-interface'),

    // Landing
    btnLandingDemo: document.getElementById('btn-landing-demo'),
    btnLandingLocalNew: document.getElementById('btn-landing-local-new'),
    btnLandingLocalLoad: document.getElementById('btn-landing-local-load'),
    btnLandingConnect: document.getElementById('btn-landing-connect'),
    modalSupabase: document.getElementById('modal-supabase'),
    btnCloseModalSupabase: document.getElementById('btn-close-modal-supabase'),
    btnCancelSupabase: document.getElementById('btn-cancel-supabase'),
    formSupabaseConnect: document.getElementById('form-supabase-connect'),
    inSupabaseUrl: document.getElementById('in-supabase-url'),
    inSupabaseKey: document.getElementById('in-supabase-key'),
    configSupabaseInfo: document.getElementById('config-supabase-info'),
    btnConfigSupabaseConnect: document.getElementById('btn-config-supabase-connect'),
    btnConfigSupabaseDisconnect: document.getElementById('btn-config-supabase-disconnect'),
    inputLocalFile: document.getElementById('input-local-file'),

    // App shell / navigation
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    themeText: document.querySelector('.theme-text'),
    navExitApp: document.getElementById('nav-exit-app'),
    screens: document.querySelectorAll('.app-screen'),
    navItems: document.querySelectorAll('.nav-item'),
    barTitle: document.getElementById('bar-title'),
    demoModeBadge: document.getElementById('demo-mode-badge'),
    apiStatus: document.getElementById('api-status'),
    apiStatusText: document.querySelector('#api-status .status-text'),
    loadingSpinner: document.getElementById('loading-spinner'),
    btnDownloadLocal: document.getElementById('btn-download-local'),

    // Despensa screen
    despensaSearch: document.getElementById('despensa-search'),
    despensaChipsUbicacion: document.getElementById('despensa-chips-ubicacion'),
    btnAddLote: document.getElementById('btn-add-lote'),
    despensaAlertas: document.getElementById('despensa-alertas'),
    despensaList: document.getElementById('despensa-list'),
    despensaEmpty: document.getElementById('despensa-empty'),

    // Recetas screen
    recetasChipsCategoria: document.getElementById('recetas-chips-categoria'),
    btnAddReceta: document.getElementById('btn-add-receta'),
    recetasList: document.getElementById('recetas-list'),
    recetasEmpty: document.getElementById('recetas-empty'),

    // Menú semanal screen
    btnWeekPrev: document.getElementById('btn-week-prev'),
    btnWeekNext: document.getElementById('btn-week-next'),
    btnWeekToday: document.getElementById('btn-week-today'),
    weekRangeLabel: document.getElementById('week-range-label'),
    btnGenerarLista: document.getElementById('btn-generar-lista'),
    menuGrid: document.getElementById('menu-grid'),
    menuDaystrip: document.getElementById('menu-daystrip'),
    menuAgenda: document.getElementById('menu-agenda'),

    // Lista de la compra screen
    formAddManualCompra: document.getElementById('form-add-manual-compra'),
    inCompraProducto: document.getElementById('in-compra-producto'),
    inCompraCantidad: document.getElementById('in-compra-cantidad'),
    btnLimpiarComprados: document.getElementById('btn-limpiar-comprados'),
    compraListMenu: document.getElementById('compra-list-menu'),
    compraListManual: document.getElementById('compra-list-manual'),
    compraEmpty: document.getElementById('compra-empty'),

    // Configuración screen
    configModoActual: document.getElementById('config-modo-actual'),
    cardConfigLocal: document.getElementById('card-config-local'),
    btnConfigDownloadLocal: document.getElementById('btn-config-download-local'),
    btnConfigLoadLocal: document.getElementById('btn-config-load-local'),
    btnConfigDeleteLocal: document.getElementById('btn-config-delete-local'),
    formNuevoProducto: document.getElementById('form-nuevo-producto'),
    inProductoNombre: document.getElementById('in-producto-nombre'),
    inProductoCategoria: document.getElementById('in-producto-categoria'),
    inProductoUnidad: document.getElementById('in-producto-unidad'),
    inProductoIcono: document.getElementById('in-producto-icono'),
    productosList: document.getElementById('productos-list'),
    formNuevaUbicacion: document.getElementById('form-nueva-ubicacion'),
    inUbicacionNombre: document.getElementById('in-ubicacion-nombre'),
    inUbicacionIcono: document.getElementById('in-ubicacion-icono'),
    ubicacionesList: document.getElementById('ubicaciones-list'),

    // Modal: lote de despensa
    modalLote: document.getElementById('modal-lote'),
    modalLoteTitle: document.getElementById('modal-lote-title'),
    btnCloseModalLote: document.getElementById('btn-close-modal-lote'),
    formLote: document.getElementById('form-lote'),
    inLoteId: document.getElementById('in-lote-id'),
    inLoteProducto: document.getElementById('in-lote-producto'),
    inLoteCantidad: document.getElementById('in-lote-cantidad'),
    inLoteUbicacion: document.getElementById('in-lote-ubicacion'),
    inLoteDetalleUbicacion: document.getElementById('in-lote-detalle-ubicacion'),
    inLoteFechaEntrada: document.getElementById('in-lote-fecha-entrada'),
    inLoteFechaCaducidad: document.getElementById('in-lote-fecha-caducidad'),
    btnDeleteLote: document.getElementById('btn-delete-lote'),
    btnCancelLote: document.getElementById('btn-cancel-lote'),

    // Modal: receta
    modalReceta: document.getElementById('modal-receta'),
    modalRecetaTitle: document.getElementById('modal-receta-title'),
    btnCloseModalReceta: document.getElementById('btn-close-modal-receta'),
    formReceta: document.getElementById('form-receta'),
    inRecetaId: document.getElementById('in-receta-id'),
    inRecetaNombre: document.getElementById('in-receta-nombre'),
    inRecetaCategoria: document.getElementById('in-receta-categoria'),
    inRecetaTiempo: document.getElementById('in-receta-tiempo'),
    inRecetaComensales: document.getElementById('in-receta-comensales'),
    inRecetaInstrucciones: document.getElementById('in-receta-instrucciones'),
    btnAddIngredienteRow: document.getElementById('btn-add-ingrediente-row'),
    ingredientesRows: document.getElementById('ingredientes-rows'),
    btnDeleteReceta: document.getElementById('btn-delete-receta'),
    btnCancelReceta: document.getElementById('btn-cancel-receta'),

    // Modal: hueco de menú semanal
    modalMenuEntry: document.getElementById('modal-menu-entry'),
    modalMenuEntryTitle: document.getElementById('modal-menu-entry-title'),
    btnCloseModalMenuEntry: document.getElementById('btn-close-modal-menu-entry'),
    formMenuEntry: document.getElementById('form-menu-entry'),
    inMenuEntryId: document.getElementById('in-menu-entry-id'),
    inMenuEntryFecha: document.getElementById('in-menu-entry-fecha'),
    inMenuEntryTipo: document.getElementById('in-menu-entry-tipo'),
    inMenuEntryReceta: document.getElementById('in-menu-entry-receta'),
    inMenuEntryComensales: document.getElementById('in-menu-entry-comensales'),
    btnDeleteMenuEntry: document.getElementById('btn-delete-menu-entry'),
    btnCancelMenuEntry: document.getElementById('btn-cancel-menu-entry')
};

/* ==========================================================================
   Helpers de fecha (semana de lunes a domingo, en formato ISO YYYY-MM-DD)
   ========================================================================== */
function formatISODate(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay(); // 0 = domingo
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return formatISODate(date);
}

function addDaysToISO(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return formatISODate(d);
}

// Semana actualmente visible en las pantallas Menú Semanal / Lista de la Compra.
state.selectedWeekStart = getMonday(new Date());
// Día seleccionado en la vista móvil (un día a la vez) del menú semanal.
state.selectedDayISO = formatISODate(new Date());

/* ==========================================================================
   Datos derivados del dominio
   ========================================================================== */
function getProducto(id) {
    return state.productos.find(p => String(p.id) === String(id));
}

function getUbicacion(id) {
    return state.ubicaciones.find(u => String(u.id) === String(id));
}

function getReceta(id) {
    return state.recetas.find(r => String(r.id) === String(id));
}

function getIngredientesReceta(recetaId) {
    return state.recetaIngredientes.filter(ri => String(ri.recetaId) === String(recetaId));
}

// Suma la cantidad de todos los lotes activos de un producto: el stock disponible real,
// independientemente de en qué ubicación (nevera/congelador/despensa) esté repartido.
function getStockDisponible(productoId) {
    return state.despensa
        .filter(l => l.activa && String(l.productoId) === String(productoId))
        .reduce((sum, l) => sum + (parseFloat(l.cantidad) || 0), 0);
}

// Lotes activos caducados o a punto de caducar (umbral en días), con su estado clasificado.
function getLotesPorCaducar(diasAviso = DIAS_ALERTA_CADUCIDAD) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + diasAviso);

    return state.despensa
        .filter(l => l.activa && l.fecha_caducidad)
        .map(l => {
            const fc = new Date(l.fecha_caducidad + 'T00:00:00');
            let estado = null;
            if (fc < hoy) estado = 'caducado';
            else if (fc <= limite) estado = 'proximo';
            return { lote: l, estado };
        })
        .filter(x => x.estado);
}
