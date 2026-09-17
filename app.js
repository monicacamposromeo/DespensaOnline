/* ==========================================================================
   DespensaOnline - Entry Point & SPA Router
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initRouting();
    initMobileSidebar();
    initNavExitApp();
    initModalBackdropClose();
    initLandingActions();
    initDespensaActions();
    initRecetasActions();
    initMenuActions();
    initCompraActions();
    initConfigActions();
    checkLocalCache();
});

/* ==========================================================================
   SPA Routing (hash routing, sin history.pushState)
   ========================================================================== */
function initRouting() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();

    DOM.navItems.forEach(item => {
        item.addEventListener('click', () => DOM.sidebar.classList.remove('mobile-open'));
    });
}

function handleRoute() {
    const hash = window.location.hash || '#despensa';
    if (document.body.classList.contains('landing-active')) return;

    DOM.screens.forEach(screen => {
        screen.classList.toggle('active', `#${screen.id.replace('screen-', '')}` === hash);
    });

    DOM.navItems.forEach(item => {
        const isActive = item.getAttribute('href') === hash;
        item.classList.toggle('active', isActive);
        if (isActive) {
            const label = item.querySelector('span:last-child');
            if (label) DOM.barTitle.textContent = label.textContent;
        }
    });

    if (hash === '#despensa') renderDespensa();
    else if (hash === '#recetas') renderRecetas();
    else if (hash === '#menu') renderMenuSemanal();
    else if (hash === '#compra') renderListaCompra();
    else if (hash === '#configuracion') { renderProductosConfig(); renderUbicacionesConfig(); }
}

/* ==========================================================================
   Service Worker Registration (PWA)
   ========================================================================== */
if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registrado con éxito en el ámbito:', reg.scope))
            .catch(err => console.error('Error al registrar el Service Worker:', err));
    });
}
