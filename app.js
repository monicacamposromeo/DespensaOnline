/* ==========================================================================
   DespensaOnline - Entry Point & SPA Router
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initRouting();
    initNavExitApp();
    initModalBackdropClose();
    initLandingActions();
    initSupabaseActions();
    initDespensaActions();
    initRecetasActions();
    initMenuActions();
    initCompraActions();
    initConfigActions();
    initAlertasActions();
    checkLocalCache();
});

/* ==========================================================================
   SPA Routing (hash routing, sin history.pushState)
   ========================================================================== */
function initRouting() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
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
        // updateViaCache: 'none' evita que el propio sw.js se sirva desde la caché HTTP del
        // navegador al comprobar si hay una versión nueva; si no, un cambio en sw.js podía
        // tardar hasta 24h en detectarse aunque el resto de assets ya fueran cache-busted.
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
            .then(reg => console.log('Service Worker registrado con éxito en el ámbito:', reg.scope))
            .catch(err => console.error('Error al registrar el Service Worker:', err));
    });

    // Si un Service Worker nuevo toma el control (nueva versión ya activada e instalada
    // vía skipWaiting()/clients.claim() en sw.js), esta misma pestaña sigue con los recursos
    // antiguos ya cargados en memoria; recargar una vez automáticamente hace que un simple
    // F5 sea suficiente para ver los cambios, sin tener que explicarle al usuario que hay
    // que forzar una recarga (Ctrl+Shift+R) o borrar caché a mano.
    let recargandoPorSwNuevo = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (recargandoPorSwNuevo) return;
        recargandoPorSwNuevo = true;
        window.location.reload();
    });
}
