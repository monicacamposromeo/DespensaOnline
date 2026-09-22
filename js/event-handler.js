/* ==========================================================================
   DespensaOnline - Wiring de eventos e inicialización de la UI
   ========================================================================== */

function showAppInterface() {
    document.body.classList.remove('landing-active');
    DOM.appInterface.classList.remove('hidden');
}

function initTheme() {
    const saved = localStorage.getItem('theme');
    const isDark = saved ? saved === 'dark' : true;
    document.body.classList.toggle('dark-mode', isDark);
    updateThemeToggleUI(isDark);

    DOM.btnThemeToggle.addEventListener('click', () => {
        const nowDark = !document.body.classList.contains('dark-mode');
        document.body.classList.toggle('dark-mode', nowDark);
        localStorage.setItem('theme', nowDark ? 'dark' : 'light');
        updateThemeToggleUI(nowDark);
    });
}

function updateThemeToggleUI(isDark) {
    DOM.themeText.textContent = isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
}

function initNavExitApp() {
    DOM.navExitApp.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('¿Volver a la pantalla de inicio? Si estás en Modo Demo perderás los datos no guardados.')) {
            location.reload();
        }
    });
}

function initAlertasActions() {
    DOM.btnAlertas.addEventListener('click', openAlertasModal);
    DOM.btnCloseModalAlertas.addEventListener('click', closeAlertasModal);
}

function initModalBackdropClose() {
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) backdrop.classList.add('hidden');
        });
    });
}

function initLandingActions() {
    DOM.btnLandingDemo.addEventListener('click', () => {
        state.isDemoMode = true;
        state.isLocalMode = false;
        loadDemoData();
        showAppInterface();
        updateLocalModeUI();
    });

    DOM.btnLandingLocalNew.addEventListener('click', createNewLocalDB);
    DOM.btnLandingLocalLoad.addEventListener('click', () => DOM.inputLocalFile.click());
    DOM.inputLocalFile.addEventListener('change', (e) => handleLocalFileSelected(e.target.files[0]));
    DOM.btnLandingConnect.addEventListener('click', () => openSupabaseModal());
}

function initSupabaseActions() {
    DOM.btnConfigSupabaseConnect.addEventListener('click', () => openSupabaseModal());
    DOM.btnConfigSupabaseDisconnect.addEventListener('click', () => {
        if (confirm('¿Desconectar de Supabase? Volverás a la pantalla de inicio.')) disconnectSupabase();
    });
    DOM.btnCloseModalSupabase.addEventListener('click', closeSupabaseModal);
    DOM.btnCancelSupabase.addEventListener('click', closeSupabaseModal);
    DOM.formSupabaseConnect.addEventListener('submit', handleSupabaseConnectSubmit);
}

function openSupabaseModal() {
    DOM.inSupabaseUrl.value = state.apiUrl || '';
    DOM.inSupabaseKey.value = state.supabaseKey || '';
    DOM.modalSupabase.classList.remove('hidden');
}

function closeSupabaseModal() {
    DOM.modalSupabase.classList.add('hidden');
}

async function handleSupabaseConnectSubmit(e) {
    e.preventDefault();
    const url = DOM.inSupabaseUrl.value.trim().replace(/\/+$/, '');
    const key = DOM.inSupabaseKey.value.trim();
    if (!url || !key) return;
    const ok = await connectSupabase(url, key);
    if (ok) closeSupabaseModal();
}

function initConfigActions() {
    DOM.btnConfigDownloadLocal.addEventListener('click', downloadLocalDB);
    DOM.btnDownloadLocal.addEventListener('click', downloadLocalDB);
    DOM.btnConfigLoadLocal.addEventListener('click', () => DOM.inputLocalFile.click());
    DOM.btnConfigDeleteLocal.addEventListener('click', deleteLocalDB);
    DOM.formNuevoProducto.addEventListener('submit', handleNuevoProductoSubmit);
    DOM.btnCancelEditProducto.addEventListener('click', cancelarEdicionProducto);
    DOM.formNuevaUbicacion.addEventListener('submit', handleNuevaUbicacionSubmit);
    wireCategoriaSelect(DOM.inProductoCategoria, DOM.inProductoCategoriaNueva);
    DOM.productosSearch.addEventListener('input', (e) => { state.productosFiltro.search = e.target.value; renderProductosConfig(); });
    DOM.productosSort.addEventListener('change', (e) => { state.productosFiltro.sort = e.target.value; renderProductosConfig(); });
}

function initDespensaActions() {
    DOM.btnAddLote.addEventListener('click', () => openLoteModal());
    DOM.btnCloseModalLote.addEventListener('click', closeLoteModal);
    DOM.btnCancelLote.addEventListener('click', closeLoteModal);
    DOM.formLote.addEventListener('submit', handleLoteFormSubmit);
    DOM.btnDeleteLote.addEventListener('click', handleDeleteLote);
    DOM.btnDuplicateLote.addEventListener('click', handleDuplicateLote);
    DOM.inLoteProducto.addEventListener('change', updateLoteNuevoProductoVisibility);
    wireCategoriaSelect(DOM.inLoteNuevoProductoCategoria, DOM.inLoteNuevoProductoCategoriaNueva);
    DOM.inLoteUbicacion.addEventListener('change', () => {
        populateDetalleUbicacionSelector(DOM.inLoteUbicacion.value);
        updateNoDescongelarVisibility();
    });
    wireSelectConNuevo(DOM.inLoteDetalleUbicacion, DOM.inLoteDetalleUbicacionNueva, DETALLE_NUEVO_VALUE);
    DOM.btnCloseModalLoteGrupo.addEventListener('click', closeLoteGrupoModal);
    DOM.btnAddLoteAlGrupo.addEventListener('click', handleAddLoteAlGrupo);
    DOM.despensaSearch.addEventListener('input', (e) => { state.despensaFiltro.search = e.target.value; renderDespensa(); });
    DOM.despensaChipsUbicacion.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        state.despensaFiltro.ubicacion = chip.dataset.value;
        setActiveChip(DOM.despensaChipsUbicacion, chip);
        renderDespensa();
    });
}

function initRecetasActions() {
    DOM.btnAddReceta.addEventListener('click', () => openRecetaModal());
    DOM.btnCloseModalReceta.addEventListener('click', closeRecetaModal);
    DOM.btnCancelReceta.addEventListener('click', closeRecetaModal);
    DOM.formReceta.addEventListener('submit', handleRecetaFormSubmit);
    DOM.btnDeleteReceta.addEventListener('click', handleDeleteReceta);
    DOM.btnDuplicateReceta.addEventListener('click', handleDuplicateReceta);
    DOM.btnAddIngredienteRow.addEventListener('click', () => addIngredienteRow());
    DOM.recetasChipsCategoria.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        state.recetasFiltro.categoria = chip.dataset.value;
        setActiveChip(DOM.recetasChipsCategoria, chip);
        renderRecetas();
    });
}

function initMenuActions() {
    DOM.btnWeekPrev.addEventListener('click', () => goToWeek(-1));
    DOM.btnWeekNext.addEventListener('click', () => goToWeek(1));
    DOM.btnWeekToday.addEventListener('click', goToCurrentWeek);
    DOM.btnGenerarLista.addEventListener('click', generarListaCompraSemana);
    DOM.btnCloseModalMenuEntry.addEventListener('click', closeMenuEntryModal);
    DOM.btnCancelMenuEntry.addEventListener('click', closeMenuEntryModal);
    DOM.formMenuEntry.addEventListener('submit', handleMenuEntryFormSubmit);
    DOM.btnDeleteMenuEntry.addEventListener('click', handleDeleteMenuEntry);
    DOM.inMenuEntryReceta.addEventListener('change', () => {
        if (!state.editingMenuEntry) {
            const receta = getReceta(DOM.inMenuEntryReceta.value);
            if (receta) DOM.inMenuEntryComensales.value = receta.comensales_base;
        }
    });
}

function initCompraActions() {
    DOM.formAddManualCompra.addEventListener('submit', handleAddManualCompra);
    DOM.btnLimpiarComprados.addEventListener('click', handleLimpiarComprados);
    DOM.btnCloseModalCompraInfo.addEventListener('click', closeCompraInfoModal);
}
