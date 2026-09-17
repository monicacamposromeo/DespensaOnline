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
    DOM.themeIcon.textContent = isDark ? '☀️' : '🌙';
    DOM.themeText.textContent = isDark ? 'Modo Claro' : 'Modo Oscuro';
}

function initMobileSidebar() {
    DOM.btnMenuToggle.addEventListener('click', () => DOM.sidebar.classList.add('mobile-open'));
    DOM.btnCloseSidebar.addEventListener('click', () => DOM.sidebar.classList.remove('mobile-open'));
}

function initNavExitApp() {
    DOM.navExitApp.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('¿Volver a la pantalla de inicio? Si estás en Modo Demo perderás los datos no guardados.')) {
            location.reload();
        }
    });
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
}

function initConfigActions() {
    DOM.btnConfigDownloadLocal.addEventListener('click', downloadLocalDB);
    DOM.btnDownloadLocal.addEventListener('click', downloadLocalDB);
    DOM.btnConfigLoadLocal.addEventListener('click', () => DOM.inputLocalFile.click());
    DOM.formNuevoProducto.addEventListener('submit', handleNuevoProductoSubmit);
    DOM.formNuevaUbicacion.addEventListener('submit', handleNuevaUbicacionSubmit);
}

function initDespensaActions() {
    DOM.btnAddLote.addEventListener('click', () => openLoteModal());
    DOM.btnCloseModalLote.addEventListener('click', closeLoteModal);
    DOM.formLote.addEventListener('submit', handleLoteFormSubmit);
    DOM.btnDeleteLote.addEventListener('click', handleDeleteLote);
    DOM.despensaSearch.addEventListener('input', (e) => { state.despensaFiltro.search = e.target.value; renderDespensa(); });
    DOM.despensaFilterUbicacion.addEventListener('change', (e) => { state.despensaFiltro.ubicacion = e.target.value; renderDespensa(); });
}

function initRecetasActions() {
    DOM.btnAddReceta.addEventListener('click', () => openRecetaModal());
    DOM.btnCloseModalReceta.addEventListener('click', closeRecetaModal);
    DOM.formReceta.addEventListener('submit', handleRecetaFormSubmit);
    DOM.btnDeleteReceta.addEventListener('click', handleDeleteReceta);
    DOM.btnAddIngredienteRow.addEventListener('click', () => addIngredienteRow());
    DOM.recetasFilterCategoria.addEventListener('change', (e) => { state.recetasFiltro.categoria = e.target.value; renderRecetas(); });
}

function initMenuActions() {
    DOM.btnWeekPrev.addEventListener('click', () => goToWeek(-1));
    DOM.btnWeekNext.addEventListener('click', () => goToWeek(1));
    DOM.btnWeekToday.addEventListener('click', goToCurrentWeek);
    DOM.btnGenerarLista.addEventListener('click', generarListaCompraSemana);
    DOM.btnCloseModalMenuEntry.addEventListener('click', closeMenuEntryModal);
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
}
