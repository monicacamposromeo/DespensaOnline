# DespensaOnline — Documentación Técnica

SPA de gestión de despensa doméstica en JavaScript vanilla (sin build step, sin framework), pensada como PWA instalable, con tres backends de datos intercambiables: Supabase (Postgres + REST + Realtime), un archivo JSON local, o datos de Demo en memoria. Sigue al pie de la letra el patrón descrito en `ARQUITECTURA-PLANTILLA.md`; este documento cubre solo lo específico del dominio (despensa, recetas, menú semanal, lista de la compra).

Uso previsto: **un único usuario/hogar**, sin Supabase Auth, protegido solo por el secreto de la URL + Anon Key — igual que en Registro Contable (ver `ARQUITECTURA-PLANTILLA.md` §4.2).

## 1. Stack y estructura de archivos

- **Frontend**: HTML/CSS/JS vanilla. `index.html` contiene todas las pantallas (SPA de una sola página, secciones `.app-screen`).
- **Backend cloud**: Supabase (PostgREST + Realtime vía `@supabase/supabase-js` por CDN). Sin backend propio.
- **PWA**: `sw.js` (Service Worker, cache-first para assets estáticos) + `manifest.json`.

```
index.html                 Markup de todas las pantallas y modales
app.js                      Entry point, router SPA (hash routing), registro del Service Worker
sw.js                        Service Worker (caché de assets estáticos)
js/state.js                 Estado global (state, DOM), índice derivado (stock por producto, próximos a caducar)
js/storage.js                Modo Local/Demo: carga, guardado y "escritura" simulada
js/api.js                    Cliente REST/Realtime de Supabase, orquestación de sincronización
js/despensa.js               Pantalla Despensa: lotes por producto/ubicación, alta/edición/baja, alertas caducidad
js/recetas.js                Pantalla Recetas: alta/edición de receta + sus ingredientes
js/menu.js                   Pantalla Menú Semanal: vista 7 días × comida, asignación de recetas
js/lista-compra.js            Pantalla Lista de la Compra: generación automática + añadido manual, checklist
js/event-handler.js           Listeners de formularios/UI, inicialización
js/utils.js                   Helpers de formato (fechas, cantidades), toasts, spinner
```

No hay bundler ni transpilación: los `<script>` se cargan en orden directo desde `index.html`, todo el estado y las funciones son globales.

## 2. Los tres modos de funcionamiento

Igual mecanismo que en Registro Contable, controlado por `state.isDemoMode` / `state.isLocalMode`:

| Modo | Persistencia | Activación |
|---|---|---|
| **Supabase** | Postgres remoto vía REST + Realtime | `localStorage` guarda `despensa_supabase_api_url` / `despensa_supabase_key` |
| **Local** | JSON completo en `localStorage['despensa_local_db']` | `despensa_is_local_mode = 'true'`; el usuario carga/crea un `.json` |
| **Demo** | Solo en memoria, se pierde al recargar | Botón "Modo Demo"; `loadDemoData()` genera 4-5 productos, 2 recetas y un menú de ejemplo |

`apiRequest(action, method, data)` es el único punto de entrada a datos (§7); el resto del código nunca hace `fetch` directo.

## 3. Modelo de datos

Siete entidades planas. Las cantidades de un producto (en `despensa`, `receta_ingredientes` y `lista_compra`) se expresan siempre en la **unidad canónica de ese producto** (`productos.unidad`) — la app no convierte entre unidades (ver limitación en §12).

### `productos`
```
{ id, nombre, categoria, unidad, stock_minimo, supermercado, icono, activa }
```
- `supermercado`: texto libre opcional (`null` = sin asignar), p. ej. "Mercadona", "Frutería". Igual que `categoria`, no es una tabla propia: `getSupermercadosUnicos()` (`js/state.js`) deriva los ya usados para el desplegable del formulario de producto ("+ Nuevo supermercado…", `SUPERMERCADO_NUEVO_VALUE` en `js/config.js`) y para los chips de filtro de la Lista de la Compra (§9).
- `categoria`: texto libre para agrupar visualmente (p. ej. "Verdura", "Lácteos", "Congelados"); no es una tabla propia, es solo una etiqueta descriptiva.
- `unidad`: unidad de medida canónica del producto (`g`, `kg`, `ml`, `l`, `ud`).
- `stock_minimo`: numérico opcional (`null` = sin mínimo configurado). Si el stock disponible del producto (`getStockDisponible()`) cae por debajo, se añade solo a la lista de la compra con `origen = 'minimo'` (§5, "Reposición automática") — independiente de si el producto aparece o no en el menú semanal.
- `activa`: soft-delete; un producto usado en histórico de despensa/recetas nunca se borra.

### `ubicaciones`
```
{ id, nombre, icono, activa }
```
- Catálogo editable de sitios físicos donde puede vivir un lote de despensa (p. ej. "Despensa", "Nevera", "Congelador", o cualquier otra que el usuario añada como "Trastero" o "Bodega"). Se gestiona desde Configuración igual que `productos`, no es un enum fijo en el código.
- Se siembra con tres ubicaciones por defecto al crear una base de datos nueva (Demo o Local): Despensa 🥫, Nevera 🧊, Congelador ❄️ (`seedUbicacionesPorDefecto()` en `js/storage.js`).
- `activa`: soft-delete; un lote que ya usa una ubicación desactivada la conserva en su historial (`getUbicacion()` no filtra por `activa`, solo los selectores de alta la excluyen).

### `despensa`
```
{ id, productoId, cantidad, ubicacionId, detalle_ubicacion, fecha_caducidad, fecha_entrada, no_requiere_descongelar, activa }
```
- Cada fila es un **lote** de un producto, no un stock único por producto — así dos paquetes del mismo producto comprados en fechas distintas pueden tener caducidades distintas.
- `ubicacionId`: referencia a `ubicaciones.id`.
- `detalle_ubicacion`: texto libre opcional, puramente informativo (p. ej. "Cajón 2", "Balda de arriba"). No participa en ningún cálculo (stock, caducidad, lista de la compra); es una nota de dónde exactamente está el lote dentro de su `ubicacionId`, pero sí se usa para clasificar el listado de Despensa (§9) y para el desplegable en cascada del alta (§9, "Detalle de ubicación como desplegable").
- `fecha_caducidad`: nullable (hay productos, como especias, sin caducidad relevante).
- `no_requiere_descongelar`: booleano (por defecto `false`). Excepción puntual para lotes guardados en una ubicación que "parece congelador" (`esUbicacionCongelador()`, §9) pero que no necesitan descongelarse antes de cocinar (p. ej. verdura congelada que va directa a la sartén): si está a `true`, ese lote no cuenta para la alerta "Descongelar" aunque esté en el congelador. En el formulario de alta/edición del lote (`js/despensa.js`) solo se muestra el campo cuando la ubicación elegida es un congelador; en cualquier otra ubicación no tiene sentido (no hay alerta de la que excluir el lote).
- `activa`: `false` cuando el lote se consume del todo o se retira manualmente. El **stock disponible** de un producto es la suma de `cantidad` de sus lotes `activa = true` (ver `getStockDisponible()` en §4).

### `recetas`
```
{ id, nombre, categoria, tiempo_preparacion_min, comensales_base, requiere_cocinado, instrucciones, activa }
```
- `categoria` ∈ `desayuno | comida | cena | postre | snack` (texto libre, igual que en `productos`).
- `comensales_base`: número de comensales para el que están pensadas las cantidades de `receta_ingredientes`; es la base de escalado al planificar el menú (§5).
- `requiere_cocinado`: booleano (por defecto `true`). Interruptor **general del plato completo**, pensado para recetas que se cocinan como un conjunto — un guiso, un arroz — donde no tiene sentido desglosar por ingrediente. Se combina con el de `receta_ingredientes` (más abajo) en `recetaRequierePrecocinado()` (`js/state.js`): ver esa función para cómo interactúan los dos niveles y qué genera la alerta "Hoy toca cocinar" (§9).

### `receta_ingredientes`
```
{ id, recetaId, productoId, cantidad, requiere_cocinado }
```
- `cantidad`: cantidad de `productoId` necesaria para `comensales_base` comensales, en la unidad canónica del producto.
- `requiere_cocinado`: booleano (por defecto `false`, al contrario que `recetas.requiere_cocinado`). Marca la **excepción** de que ese ingrediente concreto necesita precocinado por separado, en una receta que en conjunto es de montar/servir (p. ej. una ensalada donde solo el pollo a la plancha lleva la marca, o unas fajitas donde solo el arroz la lleva porque tarda más). No hace falta marcar cada ingrediente de un guiso: para eso está el interruptor general de `recetas`.
- **Cómo se combinan los dos niveles** (`recetaRequierePrecocinado(receta)`, `js/state.js`): la receta requiere precocinado si `recetas.requiere_cocinado !== false` (el plato completo, por defecto sí) **o** si algún `receta_ingredientes.requiere_cocinado === true` (una excepción puntual). Basta con que uno de los dos lo pida. Cuando el disparador es el interruptor general, la alerta no desglosa ingredientes (no tiene sentido para un guiso); cuando el disparador son ingredientes concretos con el general desmarcado, la alerta sí los lista (`getAlertas()`, §9).
- Regla de UI (no de base de datos): una receta sin ingredientes no debería poder añadirse al menú semanal.

### `menu_semanal`
```
{ id, fecha, tipo_comida, recetaId, comensales, precocinado, descongelados, activa }
```
- `descongelados`: array de `productoId` (por defecto `[]`) con los ingredientes de ese plato ya marcados "Ya descongelado". Mientras un ingrediente congelado no esté aquí, la alerta "Descongela" de ese plato se repite cada día (§9). Se marca con el botón "Ya descongelado" de la alerta o con las casillas "Ingredientes congelados" del modal del hueco del menú; al marcarlo, además, `marcarDescongelado()` pasa a la Nevera los lotes necesarios (§9). Si se cambia la receta del plato, se vacía.
- `precocinado`: booleano (por defecto `false`). Marca "Ya lo he precocinado" de ese plato concreto: mientras sea `false`, en una receta de precocinado completo la alerta "Precocina con tiempo" (con su "Antes descongela") se repite cada día desde el sábado anterior (§9); al marcarlo deja de salir, igual que "Cocinar hoy" (que para un ingrediente suelto es su único aviso). Se marca con el botón "Ya precocinado" de la propia alerta o con la casilla del modal del hueco del menú (solo visible al editar un plato cuya receta requiera precocinado). Si se cambia la receta del plato, la marca se resetea.
- Una fila por **plato** asignado a un hueco de menú (fecha concreta + `tipo_comida`). No hay restricción de unicidad por `fecha + tipo_comida`: puede haber varias filas para el mismo hueco (varios comensales comiendo cosas distintas, o primer y segundo plato) — todo el código que agrega por día (`generarListaCompra()` §5, `getAlertas()` §9) ya recorre todas las entradas con `.filter()`, no da por hecho que haya una sola.
- `comensales`: comensales reales previstos ese día; puede diferir de `comensales_base` de la receta (el escalado usa `comensales / comensales_base`, ver §5).
- `activa`: soft-delete al quitar una receta del menú sin perder el histórico de "qué se comió" en fechas pasadas.

### `lista_compra`
```
{ id, productoId, cantidad, comprado, origen, fecha_creacion }
```
- `origen` ∈ `menu | minimo | manual`. Las filas `origen = 'menu'` las genera `generarListaCompra()` (§5); las `origen = 'minimo'` las genera `actualizarListaReposicion()` (§5) a partir de `productos.stock_minimo`; el usuario puede añadir además productos sueltos con `origen = 'manual'`.
- `comprado`: booleano de control de la compra. Marcarlo **no** modifica `despensa` automáticamente en esta versión básica (ver §12).
- No hay unicidad estricta por `productoId`: tanto `generarListaCompra()` como `actualizarListaReposicion()` hacen upsert solo sobre las filas pendientes de su propio `origen` (para no duplicar ni pisarse entre sí); el usuario puede tener además varias filas manuales del mismo producto.

### Apéndice — SQL de creación (Supabase)

```sql
create table productos (
  id bigint generated always as identity primary key,
  nombre text not null,
  categoria text,
  unidad text not null default 'ud',
  stock_minimo numeric,
  supermercado text,
  icono text,
  activa boolean not null default true
);

-- Si ya tenías la tabla creada de antes:
-- alter table productos add column stock_minimo numeric;
-- alter table productos add column supermercado text;

create table ubicaciones (
  id bigint generated always as identity primary key,
  nombre text not null,
  icono text,
  activa boolean not null default true
);

create table despensa (
  id bigint generated always as identity primary key,
  "productoId" bigint not null references productos(id),
  cantidad numeric not null,
  "ubicacionId" bigint not null references ubicaciones(id),
  detalle_ubicacion text,
  fecha_caducidad date,
  fecha_entrada date not null default current_date,
  no_requiere_descongelar boolean not null default false,
  activa boolean not null default true
);

-- Si ya tenías la tabla creada de antes: alter table despensa add column no_requiere_descongelar boolean not null default false;

create table recetas (
  id bigint generated always as identity primary key,
  nombre text not null,
  categoria text,
  tiempo_preparacion_min integer,
  comensales_base integer not null default 1,
  requiere_cocinado boolean not null default true,
  instrucciones text,
  activa boolean not null default true
);

create table receta_ingredientes (
  id bigint generated always as identity primary key,
  "recetaId" bigint not null references recetas(id),
  "productoId" bigint not null references productos(id),
  cantidad numeric not null,
  requiere_cocinado boolean not null default false
);

-- Si ya tenías las tablas creadas de antes:
-- alter table recetas add column requiere_cocinado boolean not null default true;
-- alter table receta_ingredientes add column requiere_cocinado boolean not null default false;

create table menu_semanal (
  id bigint generated always as identity primary key,
  fecha date not null,
  tipo_comida text not null,
  "recetaId" bigint not null references recetas(id),
  comensales integer not null default 1,
  precocinado boolean not null default false,
  descongelados jsonb not null default '[]'::jsonb,
  activa boolean not null default true
);

-- Si ya tenías la tabla creada de antes:
-- alter table menu_semanal add column precocinado boolean not null default false;
-- alter table menu_semanal add column descongelados jsonb not null default '[]'::jsonb;

create table lista_compra (
  id bigint generated always as identity primary key,
  "productoId" bigint not null references productos(id),
  cantidad numeric not null,
  comprado boolean not null default false,
  origen text not null default 'manual',
  fecha_creacion timestamptz not null default now()
);

-- Single-user: RLS desactivada o políticas USING (true) en las siete tablas
-- (ver ARQUITECTURA-PLANTILLA.md §4.2).
alter publication supabase_realtime add table despensa, ubicaciones, menu_semanal, lista_compra;
```

## 4. Estado global y caché de DOM (`js/state.js`)

`state` contiene: modo activo, credenciales, las seis colecciones de datos, semana seleccionada en el Menú, y `state.loadedScreens`. `DOM` es el caché habitual de `getElementById`.

### Índice derivado

- `getStockDisponible(productoId)`: suma `cantidad` de todos los lotes de `despensa` con ese `productoId` y `activa = true`. Se recalcula tras cualquier recarga de `despensa`.
- `getProductosPorCaducar(diasAviso = 3)`: filtra lotes activos con `fecha_caducidad` no nula y `fecha_caducidad <= hoy + diasAviso`, clasificando cada uno como `caducado` (`fecha_caducidad < hoy`) o `proximo` (resto). Usado para las alertas de §6.

## 5. Generación de la lista de la compra (`js/lista-compra.js`)

Núcleo funcional de la app: cruza el menú semanal planificado con el stock real de la despensa.

```
function generarListaCompra(fechaInicio, fechaFin):
  necesidades = {}                      // productoId -> cantidad total necesaria

  entradas = menu_semanal activos con fecha en [fechaInicio, fechaFin] (puede haber varias por hueco, §3)
  para cada entrada:
    receta = recetas[entrada.recetaId]
    factor = entrada.comensales / receta.comensales_base
    para cada ingrediente en receta_ingredientes de esa receta:
      necesidades[ingrediente.productoId] += ingrediente.cantidad * factor

  para cada (productoId, cantidadNecesaria) en necesidades:
    disponible = getStockDisponible(productoId)
    aComprar = max(0, cantidadNecesaria - disponible)

    si aComprar > 0:
      si existe fila lista_compra con origen='menu', ese productoId y comprado=false:
        actualizar su cantidad = aComprar
      si no:
        crear fila nueva { productoId, cantidad: aComprar, origen: 'menu', comprado: false }
    si aComprar == 0 y existía esa fila pendiente:
      eliminarla (la despensa ya cubre la necesidad)
```

- La función es **idempotente**: se puede volver a ejecutar cada vez que cambia el menú o la despensa mientras se planifica la semana, sin generar duplicados.
- Las filas `origen = 'manual'` y `origen = 'minimo'` nunca las toca `generarListaCompra()`.
- **`fechaInicio` nunca cuenta días ya pasados**: la propia función recorta `fechaInicio` a hoy si le llega una fecha anterior, o si no se le pasa ninguna (p. ej. la semana visible empezó en lunes pero hoy es miércoles) — lo planificado en días anteriores a hoy no debe generar necesidad de compra retroactiva. Si toda la semana pedida ya pasó, el rango recortado queda vacío y no se genera ninguna necesidad (y se limpian las filas `origen='menu'` pendientes que ya no correspondan a nada).
- **`fechaFin` es opcional**: sin ella no hay límite superior, así que se cubre todo el menú planificado a futuro (usado por `generarListaCompraTodas()`, ver abajo).
- El botón "Generar lista de la compra" (pantalla Menú Semanal) llama a `handleGenerarListaClick()`, que primero pregunta con un `confirm()` si generar con el menú de **todas las semanas planificadas** o solo con el de la **semana que se está viendo**:
  - **Solo esta semana** (`generarListaCompraSemana()`): `generarListaCompra(fechaInicio, fechaFin)` con el rango de la semana visible en la pantalla Menú Semanal.
  - **Todas las semanas** (`generarListaCompraTodas()`): `generarListaCompra()` sin argumentos — `fechaInicio` se ancla igualmente a hoy (nunca retroactivo) y `fechaFin` queda sin límite superior, así que cubre cualquier entrada futura del menú, esté o no en la semana visible.

### Reposición automática por stock mínimo (`actualizarListaReposicion()`)

Mismo patrón de upsert que `generarListaCompra()`, pero sin depender del menú en absoluto — solo de `productos.stock_minimo` y del stock real:

```
function actualizarListaReposicion():
  productoIds = productos activos con stock_minimo > 0
              ∪ productoId de las filas lista_compra con origen='minimo' pendientes

  para cada productoId:
    minimo = productos[productoId].stock_minimo (o 0 si el producto ya no tiene mínimo)
    disponible = getStockDisponible(productoId)
    faltante = max(0, minimo - disponible)

    si faltante > 0:
      upsert (crear o actualizar cantidad) la fila lista_compra origen='minimo' pendiente de ese producto
    si faltante == 0 y existía esa fila pendiente:
      eliminarla (ya se ha repuesto, o se quitó el mínimo)
```

Se llama automáticamente al final de `renderDespensa()` (`js/despensa.js`) — es decir, cada vez que cambia algo en la despensa (alta/edición/baja de un lote) — y también tras crear/editar/eliminar un producto en Configuración (`js/config.js`, por si cambia `stock_minimo`). El usuario nunca tiene que pulsar un botón para esto; a diferencia de `generarListaCompra()`, no hace falta ninguna acción manual.

## 6. Alertas de caducidad

`getProductosPorCaducar()` (§4) alimenta un badge en la pantalla Despensa (🔴 caducado / 🟡 próximo a caducar, umbral configurable, por defecto 3 días) sobre cada lote afectado. No requiere tabla ni lógica de servidor adicional: es un cálculo cliente sobre `state.despensa` en cada render.

## 7. Capa de acceso a datos (`js/api.js`)

`apiRequest(action, method, data)` soporta, mismo nombre en las tres implementaciones (Supabase / Demo / Local):

```
producto, editar_producto, eliminar_producto            (soft-delete: activa=false)
ubicacion, eliminar_ubicacion                            (soft-delete: activa=false)
despensa_lote, editar_despensa_lote, eliminar_despensa_lote
receta, editar_receta, eliminar_receta
receta_ingrediente, editar_receta_ingrediente, eliminar_receta_ingrediente
menu, editar_menu, eliminar_menu
lista_compra_item, editar_lista_compra_item, eliminar_lista_compra_item
productos | ubicaciones | despensa | recetas | receta_ingredientes | menu_semanal | lista_compra   (GET)
custom:/rest/v1/...   (GET arbitrario, filtros/paginación)
```

En modo Supabase cada acción mapea a un verbo REST + endpoint bajo `/rest/v1/<tabla>`, con cabeceras `apikey` / `Authorization: Bearer <anonKey>` y `Prefer: return=representation` en altas. Realtime (`postgres_changes` sobre `despensa`, `menu_semanal`, `lista_compra`) sigue el mismo patrón de debounce (300 ms) y "no forzar sync manual si el canal está activo" descrito en `ARQUITECTURA-PLANTILLA.md` §4.3–4.4.

## 8. Routing SPA (`app.js`)

Hash routing: `#despensa`, `#recetas`, `#menu`, `#compra`, `#configuracion`. Mismo patrón que Registro Contable: en modo Supabase, `handleRoute()` llama a `syncScreenData(hash)`; en Demo/Local llama directamente a la función de render de esa pantalla.

## 9. Renderizado por pantalla

- **Despensa** (`js/despensa.js`): lotes filtrables por `ubicacionId` y por texto. El avatar de cada fila muestra la cantidad compacta (`formatCantidadCompacta()`, p. ej. "500g", "2.5l", sin espacio para caber en el círculo; el valor completo con espacio queda en el `title` como tooltip) en vez de la inicial del producto que usan los demás catálogos (`monogramLetter()`), porque aquí la cantidad es el dato que interesa ver de un vistazo.
  - **Fusión visual de lotes** (`agruparLotesPorProductoYSitio()`): varios lotes que comparten producto + `ubicacionId` + `detalle_ubicacion` (p. ej. dos lotes de "Masa de pizza" en "Congelador · Cajón 3" con caducidades distintas) se muestran como **una sola fila**, con la cantidad total y la caducidad más próxima como aviso (más un "(+N lote(s))" en el propio badge, ver `caducidadStatusHtml(lote, otrosLotes)`). Es una fusión solo de presentación: los lotes siguen siendo filas independientes en `state.despensa`, cada uno con su propia fecha; nada se convierte ni se pierde. Tocar una fila fusionada abre `modal-lote-grupo` (`openLoteGrupoModal()`), un listado de los lotes individuales (por fecha de entrada) desde el que se elige cuál editar/eliminar en el `modal-lote` de siempre, o se pulsa "Añadir otro lote" para dar de alta uno más con el mismo producto/ubicación/detalle ya preseleccionados (parámetro `prefill` de `openLoteModal()`).
  - **Clasificación en dos niveles**: `agruparPorDetalleHtml()` sub-agrupa siempre por `detalle_ubicacion` dentro de lo que se le pase, insertando un `<h3 class="section-subtitle">` por cada sitio (orden alfabético; "Sin sitio concreto" al final) — igual que se clasifica por ubicación, pero un nivel más abajo. Cuando el filtro de ubicación está en "Todas", `agruparPorUbicacionHtml()` añade encima un `<h2 class="section-title">` por ubicación (orden alfabético) y sub-agrupa cada una por detalle; si se filtra a una ubicación concreta, se omite ese `<h2>` (sería redundante con el chip activo) pero se conserva la sub-clasificación por detalle. Alta/edición/baja de lotes.
  - **Duplicar lote** (`handleDuplicateLote()`): botón "Duplicar" en `modal-lote`, visible solo al editar un lote existente (mismo criterio que "Eliminar"). Crea un lote nuevo con los mismos `productoId`/`cantidad`/`ubicacionId`/`detalle_ubicacion`/fechas/`no_requiere_descongelar` que el original vía `apiRequest('despensa_lote', 'POST', ...)`; el original no se toca. Pensado para repetir de un vistazo un lote muy similar (p. ej. otro paquete comprado después, con otra caducidad) sin rellenar el formulario desde cero.
  - **Detalle de ubicación como desplegable en cascada**: igual que las categorías (ver más abajo), `detalle_ubicacion` no es una tabla propia — `getDetallesUnicosPorUbicacion(ubicacionId)` (`js/state.js`) deriva del propio `state.despensa` los detalles ya usados **dentro de esa ubicación concreta** (un "Cajón 3" de Congelador no tiene sentido ofrecerlo al elegir Nevera). `populateDetalleUbicacionSelector()` repuebla el `<select>` cada vez que cambia la ubicación elegida en el modal, con `DETALLE_NUEVO_VALUE` como opción "+ Nuevo detalle…" que revela un campo de texto adyacente (mismo patrón genérico `wireSelectConNuevo()`/`resolveSelectConNuevo()` de `js/config.js`, ver más abajo).
- **Recetas** (`js/recetas.js`): tarjetas filtrables por `categoria`; alta/edición de receta y de su lista de `receta_ingredientes` (selector de producto + cantidad). El formulario tiene dos niveles de "requiere precocinado" independientes (ver §3): el checkbox "Requiere precocinado (el plato completo)" a nivel de receta (marcado por defecto), y un checkbox "Precocinar" en cada fila de ingrediente (desmarcado por defecto, pensado como excepción puntual). La tarjeta muestra "Listo para servir" cuando `recetaRequierePrecocinado()` (`js/state.js`) devuelve `false` — ninguno de los dos niveles lo pide — y en ese caso tampoco se genera la alerta "Cocinar hoy" (§9, Alertas). Mismo patrón de agrupación que Despensa: con el filtro en "Todas", `agruparRecetasPorCategoriaHtml()` agrupa por categoría en el orden natural de las comidas (desayuno, comida, cena, postre, snack, y cualquier otra al final por orden alfabético); filtrando a una categoría concreta se muestra la lista plana.
  - **Duplicar receta** (`handleDuplicateReceta()`): botón "Duplicar" en `modal-receta`, visible solo al editar una receta existente. Crea una receta nueva con el nombre original + " (copia)", los mismos datos y los mismos `receta_ingredientes` (vía `apiRequest('receta', 'POST', ...)`, que ya acepta el array `ingredientes` completo); la original no se toca. Pensado como punto de partida rápido para una variación de una receta ya existente.
- **Alta rápida de producto** (`PRODUCTO_NUEVO_VALUE` en `js/config.js`): tanto el selector de producto del modal de despensa como el de cada fila de ingrediente de una receta incluyen una opción final "+ Crear producto nuevo…"; al elegirla se despliegan los campos mínimos (nombre, categoría, unidad) y, al guardar, `crearProductoDesdeCampos()` crea el producto vía `apiRequest('producto', ...)` antes de guardar el lote/ingrediente, evitando tener que pasar primero por Configuración.
- **Patrón "desplegable + escribir uno nuevo"** (`wireSelectConNuevo()` / `resolveSelectConNuevo()` en `js/config.js`): un `<select>` con los valores ya usados en algún sitio más una opción centinela ("+ Nueva categoría…", "+ Nuevo detalle…") que revela un `<input>` de texto adyacente. Dos usos, ninguno con tabla propia:
  - **Categoría de producto** (`CATEGORIA_NUEVA_VALUE`): `getCategoriasUnicas()` (`js/state.js`) deriva la lista de categorías ya usadas en `state.productos`; todo campo de categoría (alta en Configuración, alta rápida en despensa/receta) usa este desplegable. `wireCategoriaSelect()`/`resolveCategoriaValue()` son envoltorios de las funciones genéricas con `CATEGORIA_NUEVA_VALUE`; `populateCategoriaSelectors()` refresca los selectores estáticos tras crear/eliminar un producto.
  - **Detalle de ubicación** (`DETALLE_NUEVO_VALUE`, `js/despensa.js`): igual patrón, pero acotado a la ubicación elegida (ver arriba).
- **Menú Semanal** (`js/menu.js`): rejilla de 7 días × 3 comidas (`desayuno`/`comida`/`cena`); cada hueco admite **varios platos** (varias entradas de `menu_semanal` con la misma fecha+comida), cada uno como su propia fila/tarjeta con su receta y `comensales`, más un botón "+ Añadir plato"/"+ Añadir otro plato" para sumar más sin sustituir los que ya hay. Tocar un plato concreto lo abre para editar/eliminar (`data-entrada-id`, no `fecha`+`tipo`, para distinguir cuál de varios); tocar "+ Añadir" siempre crea uno nuevo. Botón "Generar lista de la compra": antes de generar, pregunta (`handleGenerarListaClick()`, §5) si usar el menú de todas las semanas planificadas o solo el de la semana visible. El día de hoy se resalta en la cabecera de la rejilla (`.menu-grid-day-header.today`) y en la tira de días de la vista móvil (`.daychip.today`).
- **Lista de la Compra** (`js/lista-compra.js`): tres secciones separadas por `origen` — "Del menú" (`menu`), "Reposición automática" (`minimo`) y "Añadido a mano" (`manual`) — cada una en su propio contenedor (`DOM.compraListMenu`/`compraListMinimo`/`compraListManual`), marcar `comprado`, añadir producto manual, y botón para regenerar desde el menú. La sección "Reposición automática" no tiene botón de regenerar: se recalcula sola (`actualizarListaReposicion()`, §5) cada vez que cambia la despensa o el `stock_minimo` de un producto, sin ninguna acción del usuario. En las filas `origen = 'menu'`, tocar el nombre/cantidad (no el checkbox) abre `modal-compra-info` con el desglose de en qué recetas del menú se necesita ese producto y cuánto (`getUsosDeProductoEnMenu()` en `js/state.js`, recalculado al vuelo contra el menú actual — no se guarda nada al generar la lista, así que si el menú cambió después de generarla, el modal avisa de que "ya no aparece en el menú actual" en vez de mostrar datos obsoletos). Igual que `generarListaCompra()` (§5), solo cuenta entradas de HOY en adelante — un plato de un día ya pasado no aparece en el desglose, ni cuenta para el resumen de abajo. Si el producto aparece repetido como ingrediente dentro de la misma receta (varias filas de `receta_ingredientes` con el mismo `productoId`), `getUsosDeProductoEnMenu()` suma todas esas filas antes de escalar por comensales, igual que hace `generarListaCompra()` al calcular la necesidad real — así la cantidad que se ve en el desglose siempre coincide con la que generó la fila de la lista. El modal también muestra un resumen (necesario en total − lo que ya hay en despensa = a comprar) porque la suma de las cantidades por receta es la necesidad **bruta**, mientras que la cantidad de la fila de la lista ya tiene descontado el stock (§5) — sin este resumen los números no cuadrarían a simple vista. En las filas `origen = 'minimo'` y `origen = 'manual'` no hay receta que mostrar, así que el nombre/cantidad sigue marcando `comprado` al tocarlo, igual que el checkbox (es una `<label>` más apuntando al mismo checkbox, no un botón).
  - **Detalle del mínimo en "Reposición automática"** (`compraMinimoMetaHtml()`): solo en las filas `origen = 'minimo'`, debajo del nombre del producto se muestra "Mínimo X · Tienes Y" (`productos.stock_minimo` y `getStockDisponible()`), para ver de un vistazo por qué ha saltado esa reposición sin tener que ir a Configuración a consultar el mínimo. Las filas `origen = 'menu'` y `origen = 'manual'` no llevan este detalle (no tiene sentido: no hay un mínimo detrás).
  - **Orden por categoría, sin encabezados** (`compararItemsCompra()`): dentro de cada una de las tres secciones (Del menú / Reposición automática / Añadido a mano) los productos van ordenados por `productos.categoria` (alfabética, "sin categoría" al final) y dentro de cada categoría por nombre, con los ya `comprado` al final. No se pintan encabezados de categoría (ocupaban mucho y entorpecían usar la lista en la tienda): la categoría se muestra como detalle bajo el nombre de cada fila (`compraItemMetaHtml()`), junto con el "Mínimo X · Tienes Y" en las filas de reposición.
  - **Distintivo de urgencia** (`getUrgenciaCompra()` / `compraUrgenciaHtml()`): una píldora roja "Hoy" o ámbar "Mañana" en las filas pendientes cuyo producto necesita el menú de hoy o de mañana y no llega con el stock — mismo cálculo que la alerta "Compra X para hoy" y su simulación de mañana (`getNecesidadesDelDia()` + `getStockProyectado()`, §9). Se aplica a cualquier `origen` (menú, reposición o a mano): lo urgente es el producto, no el motivo por el que está en la lista.
  - **Supermercado** (`productos.supermercado`, §3): cada fila muestra su supermercado como etiqueta (`.tag-supermercado`) delante de la categoría, y encima de las secciones hay chips de filtro Todos / cada supermercado / Sin supermercado (`renderCompraChipsSupermercado()`, `state.compraFiltro.supermercado`, `pasaFiltroSupermercado()`) — solo visibles si algún producto tiene supermercado asignado. El filtro se aplica a las tres secciones a la vez; es un filtro de vista, no cambia ni la generación ni la reposición.
- **Configuración** (`js/config.js`): modo de datos (Demo/Local, backup JSON) + dos catálogos editables con el mismo patrón alta/soft-delete: `productos` y `ubicaciones`. El catálogo de productos tiene búsqueda por nombre y un selector de orden (`state.productosFiltro`, por defecto nombre A-Z; también por nombre Z-A, categoría o unidad). El formulario de producto tiene un campo opcional "Stock mínimo" (`productos.stock_minimo`, §3): al guardar (alta o edición) se llama a `actualizarListaReposicion()` para que la sección "Reposición automática" de la Lista de la Compra refleje el cambio al momento.
- **Edición de producto** (`openProductoEdit()` en `js/config.js`): al hacer clic en una fila del catálogo (fuera del botón de eliminar) se rellena el mismo formulario de alta con sus datos y el botón cambia a "Guardar cambios" (`state.editingProductoId`); "Cancelar" o eliminar el producto que se estaba editando vuelve al formulario a modo alta. Como `despensa.cantidad` y `receta_ingredientes.cantidad` se guardan en la unidad canónica del producto (§3) sin ningún registro de en qué unidad se guardaron, cambiarla no las convierte: si el producto tiene algún lote de despensa activo o algún ingrediente de receta (`productoEstaEnUso()` en `js/state.js`), `handleNuevoProductoSubmit()` pide confirmación explícita antes de guardar, avisando de que las cantidades ya guardadas pasarán a interpretarse en la unidad nueva sin conversión.
- **Alertas** (`js/alertas.js`): no es una pantalla con su propio hash — es un icono de campana en la barra superior (visible en cualquier pantalla, con un contador) que abre `modal-alertas`. `getAlertas()` cruza despensa + menú semanal + recetas y devuelve, ya ordenadas por urgencia (0 = más urgente), las 6 alertas pedidas — todo calculado al vuelo; lo único que se guarda son las marcas "Ya precocinado" y "Ya descongelado" de cada plato (`menu_semanal`, §3). Tanto en la campana como en Próximas alertas se muestran **agrupadas en secciones por tipo** (`alertasPorTipoHtml()`, `SECCIONES_ALERTAS`): Comprar · Caducidad (caducado + va a caducar) · Descongelar · Cocinar y precocinar, en ese orden fijo, cada una con su número de alertas y omitida si está vacía; dentro de cada sección se mantiene el orden de `compararAlertas()`:
  1. **Comprar hoy** (prioridad 0): para cada producto que necesitan las recetas de HOY (`getNecesidadesDelDia()`, mismo cálculo escalado por comensales que `generarListaCompra()`), si el stock actual (`getStockDisponible()`) no llega, avisa de cuánto falta.
  2. **Caducado, tíralo** (prioridad 1) y **Va a caducar** (prioridad 4): directamente de `getLotesPorCaducar()` (§6), sin cálculo nuevo.
  3. **Descongelar** (prioridad 2): para cada ingrediente de un plato del menú de hoy en adelante, si hay algún lote activo de ese producto en una ubicación que "parece congelador" (`esUbicacionCongelador()`: el nombre de la ubicación contiene "congel", ya que `ubicaciones` no tiene un campo de tipo — es una heurística sobre el nombre, no una propiedad formal; si el congelador se renombra a algo sin "congel", la alerta deja de dispararse) y que no esté marcado `no_requiere_descongelar` (§3) — así un lote que ya se cocina directamente congelado no genera el aviso (`getLotesCongelados()` / `getProductosADescongelar()`, un aviso por producto aunque esté repetido en la receta). El aviso **se repite cada día** hasta que se marque "Ya descongelado" para ese plato (`menu_semanal.descongelados`, §3) o hasta que pase el día de la receta (el propio día todavía avisa). Cuándo empieza:
     - Recetas de precocinado completo (`esPrecocinadoDeRecetaCompleta()`: `recetas.requiere_cocinado !== false`, un guiso): sus ingredientes congelados **no generan alerta propia**, van dentro de la tarjeta de "Precocina con tiempo" (5, desde el sábado anterior) o de "Hoy toca cocinar" (4) de ese plato (`getPendientesDescongelarParaPrecocinar()` → `alerta.descongelar`), como un bloque destacado "Antes descongela: …" (`alertaPendientesAntesHtml()` / `.alerta-antes`, borde y fondo de peligro con icono de copo) y un botón principal "Ya descongelado" que marca todo lo pendiente de una vez, junto al secundario "Ya precocinado". Mientras quede algo por descongelar, la tarjeta sube al principio de su sección (prioridad 4 en vez de 5 para precocinar, 2 en vez de 3 para cocinar hoy). Si el plato ya está `precocinado` (§3), no se pide descongelarlos.
     - El resto de recetas (incluidas las de un ingrediente a precocinar, que se cocina el mismo día): cada ingrediente congelado tiene su alerta propia en la sección Descongelar, desde la víspera de la receta ("Lo necesitas mañana para …").
     - **"Ya descongelado"** (`marcarDescongelado()`): botón en la propia alerta (delegación en `wireAccionesAlertas()`) o casillas "Ingredientes congelados" del modal del plato (`renderMenuEntryDescongelados()` en `js/menu.js`, solo al editar un plato ya planificado). Guarda el producto en `menu_semanal.descongelados` y pasa a la Nevera (`getUbicacionNevera()`: primera ubicación activa con "nevera" o "frigo" en el nombre, misma heurística que el congelador) los lotes congelados de ese producto necesarios para el plato (`moverADescongelarANevera()`): por orden de caducidad, sin partir lotes, hasta cubrir la cantidad que pide la receta escalada por comensales; se borra su `detalle_ubicacion` porque era del congelador. Si no hay ninguna ubicación tipo Nevera, se marca igualmente en el menú y un aviso pide mover el lote a mano. Desmarcar una casilla en el modal vuelve a activar la alerta, pero no devuelve el lote al congelador.
  - **Dos tipos de precocinado** (§3), con avisos distintos:
    - **Receta completa** (`recetas.requiere_cocinado !== false`, un guiso — `esPrecocinadoDeRecetaCompleta()`): se prepara con antelación, el **fin de semana anterior** → "Precocina con tiempo" (5) desde el sábado anterior; si no se marca, "Hoy toca cocinar" (4) el mismo día.
    - **Ingrediente dentro de la receta** (`receta_ingredientes.requiere_cocinado`, p. ej. el arroz de unas fajitas): **solo el mismo día**, en "Cocinar hoy" (4), para recordar al ponerse a cocinar que ese ingrediente lleva más tiempo y es lo primero. Sin aviso anticipado.
  4. **Cocinar hoy** (prioridad 3): recordatorio de las entradas del menú de hoy cuya receta cumpla `recetaRequierePrecocinado()` (§3) y no estén marcadas `precocinado`. Receta completa: título "Hoy toca cocinar {receta}" y detalle el tipo de comida (p. ej. "Comida") — no tiene sentido desglosar ingredientes para un guiso. Ingrediente suelto: título "Hoy, empieza por cocinar {cantidad + unidad + nombre}" de cada ingrediente marcado, escalado por comensales (p. ej. "Hoy, empieza por cocinar 200 g Pasta"), y detalle "Lleva más tiempo que el resto de {receta} · {comida}".
  5. **Precocina con tiempo** (prioridad 5): solo recetas de precocinado **completo**, en entradas del menú de días FUTUROS (no hoy, que ya cubre "Cocinar hoy") no marcadas `precocinado`. Avisa **cada día** desde el sábado anterior a esa fecha (`sabadoAnteriorA()`, siempre estrictamente anterior: para una receta de sábado se toma el de la semana previa; para una de domingo, la víspera) hasta la víspera — sábado, domingo y, si no dio tiempo el fin de semana, los días siguientes — hasta que se pulse "Ya precocinado". Título "Precocina con tiempo {receta}", detalle "Lo necesitas {el miércoles 30/09} ({comida})". Dentro de la tarjeta, además del "Antes descongela" (punto 3), un bloque destacado igual **"Antes compra: {cantidad} {producto}, …"** (`getFaltantesParaPrecocinar()` → `alerta.comprar`, icono de carrito) con lo que falta en la despensa para cocinar el plato **ahora**: necesidad de esa entrada (suma de sus filas en la receta, escalada por comensales) menos `getStockProyectado()` al día de la alerta — no al del menú, porque el guiso se cocina antes, y la alerta "Compra X para hoy" de la sección Comprar solo saltaría ese día, tarde. No tiene botón (se deja de mostrar cuando el stock ya llega) ni descuenta lo que pidan otros platos que se precocinen a la vez. Con algo por comprar o descongelar la tarjeta sube a prioridad 4. En "Hoy toca cocinar" no se añade: el mismo día ya lo avisa la sección Comprar. La alerta lleva un botón **"Ya precocinado"** (`alertaRowHtml()` → `marcarPrecocinado()`, enganchado por delegación con `wireAccionesAlertas()` en el modal y en Próximas alertas) que pone `menu_semanal.precocinado = true`. "Cocinar hoy" (4) tampoco sale para un plato ya precocinado.
  - **Orden dentro de cada prioridad** (`compararAlertas()`): cada alerta lleva además una `fecha` (y, cuando aplica, un `tipoComida`) para poder desempatar entre alertas de la misma prioridad — p. ej. varios lotes "Va a caducar" (todos prioridad 4) con caducidades distintas. Primero suben las de HOY (`fecha === hoy`) por delante de las de otros días; y dentro de las de hoy, por tipo de comida en su orden natural (`TIPOS_COMIDA` en `js/state.js`: desayuno, comida, cena) — así, por ejemplo, si hay varios platos en "Hoy toca cocinar" (comida y cena el mismo día), sale antes el de comida.
  - El contador de la campana (`renderAlertasBadge()`) se recalcula automáticamente al final de `renderDespensa()` y `renderMenuSemanal()` — como toda mutación relevante (lotes, menú, recetas, productos) ya termina llamando a una de esas dos funciones, no hace falta refrescarlo desde ningún otro sitio. Por el mismo motivo, si la pantalla Próximas alertas está activa, `renderAlertasBadge()` también la vuelve a pintar.
  - **Próximas alertas** (pantalla `#proximas-alertas`, `screen-proximas-alertas`): sin entrada en la barra de navegación; se llega con el botón "Ver próximas alertas" del final de `modal-alertas` (`goToProximasAlertas()`). Muestra, para cada uno de los próximos `DIAS_PROXIMAS_ALERTAS` días (7, empezando mañana), qué alertas **nuevas** saltarán ese día, para poder anticipar compras y cocinados (p. ej. qué toca precocinar el fin de semana, o si mañana faltará pan). `getProximasAlertas()` simula `getAlertas(fecha)` con cada fecha futura como día de referencia (`getAlertas()` acepta ese parámetro, por defecto `todayISO()`; `getLotesPorCaducar()` y `compararAlertas()` también) y quita las que ya salían un día anterior, incluido hoy (clave `tipo|titulo|detalle`) — así un aviso de varios días ("Va a caducar" durante 3 días) aparece solo el primer día. Excepción: las alertas marcadas `recurrente` ("Precocina con tiempo" y su "Descongela") se muestran todos los días en que siguen pendientes, para que se vea que duran todo el fin de semana hasta marcar "Ya precocinado". Dos matices de la simulación:
    - **Comprar**: para un día futuro no se compara con el stock actual sino con el proyectado (`getStockProyectado()`): el actual menos lo que consumen las recetas del menú desde hoy hasta la víspera, truncado a 0 cada día (se asume que el día que no llegue compras justo lo que pide su alerta). Así "Compra pan para mañana" solo sale si, tras el menú de hoy, no queda pan suficiente.
    - **Textos**: "hoy"/"mañana" en títulos y detalles se escriben relativos al día REAL (`textoDia()`/`delDia()`), no al de referencia: una alerta simulada del sábado dice "Compra X para el sábado 27/09" o "El sábado 27/09 toca cocinar…". Para el día real los textos son exactamente los de siempre.

## 10. Persistencia local y claves de `localStorage`

```
theme                         'dark' | 'light'
despensa_supabase_api_url     URL del proyecto Supabase
despensa_supabase_key         Anon Key de Supabase
despensa_is_local_mode        'true' | 'false'
despensa_local_db             JSON con { productos, ubicaciones, despensa, recetas, receta_ingredientes, menu_semanal, lista_compra }
```

El backup manual ("Descargar Base de Datos") vuelca esas seis colecciones a un `.json` descargable, igual que en Registro Contable.

## 11. PWA / Service Worker

`sw.js` cachea los assets estáticos propios y de CDN (Supabase-js) listados en `ASSETS_TO_CACHE`, con bypass explícito de `supabase.co` / `/rest/v1/`. Registro del Service Worker solo sobre HTTPS o `localhost`.

- **Estrategia de red: red primero, no cache-first** (a diferencia del patrón genérico de `ARQUITECTURA-PLANTILLA.md` §6): el `fetch` handler pide siempre la red con `{ cache: 'no-store' }` (para saltarse también la caché HTTP del navegador, no solo la de este Service Worker) y solo cae a la copia guardada en `caches` si la red falla (sin conexión). Cada respuesta de red válida se vuelve a guardar en la caché al vuelo. Así un simple F5 con conexión siempre trae la versión más reciente de cada archivo, en vez de quedarse pillado con lo que se cacheó en una visita anterior; la caché sigue sirviendo su propósito de PWA instalable/offline, solo que como red de seguridad y no como primera respuesta.
- **Detección de sw.js nuevo**: se registra con `{ updateViaCache: 'none' }` (`app.js`) para que el propio `sw.js` tampoco se sirva nunca desde la caché HTTP al comprobar si hay versión nueva — si no, un cambio en `sw.js` podía tardar hasta 24h en detectarse aunque el resto de assets ya se sirvieran siempre frescos. `self.skipWaiting()` + `self.clients.claim()` en `sw.js` hacen que la versión nueva tome el control en cuanto se instala, sin esperar a que se cierren todas las pestañas; `app.js` escucha `controllerchange` y fuerza un único `location.reload()` automático cuando eso pasa, para que un solo F5 sea suficiente en vez de necesitar dos recargas o una recarga forzada (Ctrl+Shift+R).
- `CACHE_NAME` sigue subiéndose de versión (`despensa-online-vN`) al cambiar el set de assets cacheados, para que `activate` borre las cachés antiguas.

## 12. Notas de diseño, limitaciones y mejoras futuras

- **Sin conversión de unidades**: todas las cantidades de un producto (despensa, recetas, lista de la compra) se expresan en la unidad canónica fijada al dar de alta el producto (`productos.unidad`). Si una receta necesita "200 g" de algo cuya unidad canónica es "ud", hay que decidir una convención única para ese producto y mantenerla siempre.
- **Un paquete indivisible = un lote**: cuando la despensa se compra/congela en paquetes fijos (p. ej. 3 paquetes de 4 filetes), cada paquete se da de alta como un lote independiente con la misma cantidad, no como un único lote con la cantidad total — así cada paquete se puede editar o eliminar por separado cuando se gasta, sin tener que restar a mano de un número acumulado. El campo "Número de paquetes iguales" del alta (`in-lote-paquetes`, oculto al editar un lote existente) es solo un atajo de UI: `handleLoteFormSubmit()` repite la misma llamada `apiRequest('despensa_lote', 'POST', ...)` una vez por paquete; no crea ningún registro nuevo en el modelo de datos. La fusión visual del listado (§9) es la que luego los muestra juntos como una sola cantidad total.
- **Marcar "comprado" no repone la despensa automáticamente** en esta versión básica; queda como mejora futura ofrecer, al marcar comprado, crear directamente un lote nuevo en `despensa` con esa cantidad y una fecha de caducidad a rellenar.
- **Single-user, sin Auth**: igual que Registro Contable, protegido solo por el secreto de URL + Anon Key (ver `ARQUITECTURA-PLANTILLA.md` §4.2 y §9). Si en el futuro se necesita multiusuario con datos aislados, requiere Supabase Auth + RLS por `user_id` (cambio de arquitectura, no de configuración).
- **Fuera de alcance de la versión básica** (posibles iteraciones futuras): generación automática de menú semanal a partir de recetas favoritas/históricas, conversión de unidades, notificaciones push de caducidad, importación de recetas desde URLs externas.
