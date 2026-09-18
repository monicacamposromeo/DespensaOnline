# DespensaOnline — Plan de Implementación

Basado en `ARQUITECTURA-PLANTILLA.md` (patrón de infraestructura) y `DOCUMENTACIÓN-TECNICA.md` (modelo de datos y lógica de dominio). Sigue el checklist genérico de la plantilla (§8), concretado para esta app.

**Alcance de la versión básica**: inventario de despensa por lotes con caducidad, catálogo de recetas con ingredientes, menú semanal, y generación de lista de la compra a partir del menú y del stock disponible. Single-user, sin Supabase Auth.

**Fuera de alcance de esta primera versión** (ver `DOCUMENTACIÓN-TECNICA.md` §12): conversión de unidades, reposición automática de despensa al marcar "comprado", generación automática de menús, notificaciones push, multiusuario con login.

---

## Fase 0 — Estructura base del repo ✅

- [x] Copiar la estructura de ficheros de la plantilla (§3 de `ARQUITECTURA-PLANTILLA.md`): `index.html`, `app.js`, `sw.js`, `manifest.json`, `icon.svg`, `style.css`.
- [x] Crear `js/state.js`, `js/utils.js`, `js/api.js`, `js/storage.js`, `js/event-handlers.js`.
- [x] `index.html`: esqueleto de las 5 pantallas (`#despensa`, `#recetas`, `#menu`, `#compra`, `#configuracion`) como secciones `.app-screen`, navegación entre ellas.

## Fase 1 — Modo Demo/Local y modelo de datos ✅

- [x] `js/state.js`: declarar las seis colecciones (`productos`, `despensa`, `recetas`, `recetaIngredientes`, `menuSemanal`, `listaCompra`) + `getStockDisponible()` + `getLotesPorCaducar()` (Documentación Técnica §4).
- [x] `js/storage.js`: `loadDemoData()` con datos de ejemplo (10 productos con distintas unidades, 3 recetas con sus ingredientes, un menú de la semana actual, lotes en despensa con caducidades variadas, incluido uno ya caducado para probar las alertas).
- [x] `js/storage.js`: `handleLocalWriteAction()` + `saveLocalCache()` / carga de `.json` (modo Local).
- [x] `js/api.js`: `apiRequest(action, method, data)` bifurcando a Demo/Local únicamente (Supabase queda para la Fase 4).

## Fase 2 — Pantallas de catálogo (Despensa y Recetas) ✅

- [x] `js/despensa.js`: listado de lotes filtrable por ubicación/búsqueda, alta/edición/baja de lotes, badges de caducidad (Documentación Técnica §6).
- [x] `js/recetas.js`: listado de recetas filtrable por categoría, alta/edición de receta y de sus `receta_ingredientes` (selector de producto + cantidad, filas dinámicas).
- [x] Alta de `productos` en Configuración (`js/config.js`): nombre, categoría, unidad, icono.
- [x] Ciclo completo alta/edición/baja probado en modo Demo por el usuario — correcto.

## Fase 3 — Menú semanal y lista de la compra (núcleo funcional) ✅

- [x] `js/menu.js`: rejilla 7 días × 3 comidas, asignación de receta y comensales por hueco, navegación entre semanas.
- [x] `js/lista-compra.js`: `generarListaCompra(fechaInicio, fechaFin)` implementada tal como está descrita en Documentación Técnica §5 (escalado por comensales, resta de stock, upsert de filas `origen='menu'`).
- [x] Pantalla Lista de la Compra: checklist agrupado por origen, botón "Generar desde el menú" (usa la semana visible), alta manual de productos sueltos, "Quitar comprados".
- [x] Flujo end-to-end probado en modo Demo por el usuario: menú → generar lista → descuenta correctamente el stock ya disponible en despensa — correcto.

## Fase 4 — Backend Supabase

- [ ] Crear proyecto en supabase.com; ejecutar el SQL de creación de `DOCUMENTACIÓN-TECNICA.md` (Apéndice de §3). *(en curso por el usuario)*
- [ ] Habilitar Realtime en `despensa`, `menu_semanal`, `lista_compra`.
- [ ] Decidir RLS: desactivada o políticas `USING (true)` (single-user, igual que Registro Contable).
- [x] Implementada la rama Supabase de `apiRequest` (fetch REST directo a `/rest/v1/<tabla>` por cada acción del §7 de Documentación Técnica) + `initSupabaseRealtime()` con debounce de 300ms sobre `despensa`, `ubicaciones`, `menu_semanal` y `lista_compra`.
- [x] Pantalla Configuración: tarjeta "Conexión a Supabase" para introducir/guardar credenciales y desconectar; botón "Conectar con Supabase" en la landing abre el mismo formulario (modal `modal-supabase`); reconexión automática al recargar si hay credenciales guardadas.
- [ ] Verificar sincronización entre dos pestañas/dispositivos abiertos a la vez (Realtime) — pendiente de que el usuario tenga el proyecto Supabase creado.

## Fase 5 — PWA y despliegue (parcial — falta el despliegue en sí)

- [x] `manifest.json`: nombre, colores, icono (SVG único) siguiendo `ARQUITECTURA-PLANTILLA.md` §6.1.
- [x] `sw.js`: cache-first de assets estáticos propios, bypass explícito de `supabase.co` y `/rest/v1/`.
- [x] Rutas relativas (`./`) en todos los `<script>`/`<link>` para que funcione bajo subruta de GitHub Pages.
- [ ] Configurar GitHub Pages (Settings → Pages → Deploy from branch `main`, carpeta `/root`) — pendiente de hacer push al repo remoto.
- [ ] Verificar en un móvil real: instalación ("Añadir a pantalla de inicio"), apertura en modo standalone, comportamiento offline de la interfaz (sin datos frescos sin red).

## Fase 6 — Pulido y cierre (parcial)

- [x] Alertas de caducidad (umbral 3 días) visibles en Despensa.
- [x] Textos de estado vacío: despensa vacía, sin recetas, sin resultados de filtro, lista de la compra vacía.
- [ ] Subir número de `CACHE_NAME` en `sw.js` antes del primer despliegue "real" a usuarios (queda en `v1`, listo para subir a `v2` en el primer cambio tras publicar).
- [x] `DOCUMENTACIÓN-TECNICA.md` refleja el modelo tal como se implementó (no hubo cambios de esquema durante la implementación).

---

## Estado actual

Implementadas y verificadas manualmente por el usuario: **Fases 0, 1, 2 y 3** (estructura, modo Demo/Local, Despensa, Recetas, Menú Semanal y Lista de la Compra). La Fase 5 está hecha en el código (PWA lista) pero el despliegue real en GitHub Pages y la prueba en móvil siguen pendientes de que el proyecto se suba a un repositorio remoto. La **Fase 4 (Supabase) está implementada en el código** (rama Supabase de `apiRequest`, Realtime con debounce, pantalla de conexión); falta que el usuario termine de crear el proyecto/tablas en Supabase y se pruebe la conexión y la sincronización real.

---

## Orden de dependencias

Fase 0 → 1 → 2 → 3 son secuenciales (cada una depende de la anterior). Fase 4 (Supabase) puede empezar en paralelo a partir de Fase 1 si se prefiere tener el esquema cerrado pronto, pero conviene cerrar primero la lógica de negocio en Demo/Local (Fases 1-3) para no rehacer el esquema a medio camino — es la razón de ser del patrón de tres backends (`ARQUITECTURA-PLANTILLA.md` §5). Fase 5 (PWA/despliegue) no depende de tener Supabase terminado: se puede desplegar en modo Demo/Local desde el principio y añadir Supabase después con un simple push.
