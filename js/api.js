/* ==========================================================================
   DespensaOnline - Capa de acceso a datos (apiRequest)
   ========================================================================== */

// apiRequest(action, method, data) es el único punto de entrada a datos: ninguna
// pantalla debe leer/escribir el estado directamente fuera de esta función.
//
// La rama Supabase (fetch REST directo + Realtime, ver ARQUITECTURA-PLANTILLA.md
// §4.3-4.4 y DOCUMENTACIÓN-TECNICA.md §7) se implementa en la Fase 4 del plan de
// implementación; por ahora la app solo funciona en Modo Demo o Modo Local.
async function apiRequest(action, method = 'GET', data = null) {
    if (state.isDemoMode) {
        return handleDemoWriteAction(action, data);
    }

    if (state.isLocalMode) {
        return handleLocalWriteAction(action, data);
    }

    showToast('La conexión a Supabase todavía no está implementada en esta versión.', 'error');
    return { success: false, error: 'Supabase no implementado (ver PLAN-IMPLEMENTACION.md, Fase 4)' };
}
