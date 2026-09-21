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
{ id, nombre, categoria, unidad, stock_minimo, icono, activa }
```
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
{ id, productoId, cantidad, ubicacionId, detalle_ubicacion, fecha_caducidad, fecha_entrada, activa }
```
- Cada fila es un **lote** de un producto, no un stock único por producto — así dos paquetes del mismo producto comprados en fechas distintas pueden tener caducidades distintas.
- `ubicacionId`: referencia a `ubicaciones.id`.
- `detalle_ubicacion`: texto libre opcional, puramente informativo (p. ej. "Cajón 2", "Balda de arriba"). No participa en ningún cálculo (stock, caducidad, lista de la compra); es una nota de dónde exactamente está el lote dentro de su `ubicacionId`, pero sí se usa para clasificar el listado de Despensa (§9) y para el desplegable en cascada del alta (§9, "Detalle de ubicación como desplegable").
- `fecha_caducidad`: nullable (hay productos, como especias, sin caducidad relevante).
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
{ id, fecha, tipo_comida, recetaId, comensales, activa }
```
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
  icono text,
  activa boolean not null default true
);

-- Si ya tenías la tabla creada de antes: alter table productos add column stock_minimo numeric;

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
  activa boolean not null default true
);

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
  activa boolean not null default true
);

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
- El rango `[fechaInicio, fechaFin]` es típicamente la semana visible en la pantalla Menú Semanal (botón "Generar lista de la compra" en esa pantalla).

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
  - **Detalle de ubicación como desplegable en cascada**: igual que las categorías (ver más abajo), `detalle_ubicacion` no es una tabla propia — `getDetallesUnicosPorUbicacion(ubicacionId)` (`js/state.js`) deriva del propio `state.despensa` los detalles ya usados **dentro de esa ubicación concreta** (un "Cajón 3" de Congelador no tiene sentido ofrecerlo al elegir Nevera). `populateDetalleUbicacionSelector()` repuebla el `<select>` cada vez que cambia la ubicación elegida en el modal, con `DETALLE_NUEVO_VALUE` como opción "+ Nuevo detalle…" que revela un campo de texto adyacente (mismo patrón genérico `wireSelectConNuevo()`/`resolveSelectConNuevo()` de `js/config.js`, ver más abajo).
- **Recetas** (`js/recetas.js`): tarjetas filtrables por `categoria`; alta/edición de receta y de su lista de `receta_ingredientes` (selector de producto + cantidad). El formulario tiene dos niveles de "requiere precocinado" independientes (ver §3): el checkbox "Requiere precocinado (el plato completo)" a nivel de receta (marcado por defecto), y un checkbox "Precocinar" en cada fila de ingrediente (desmarcado por defecto, pensado como excepción puntual). La tarjeta muestra "Listo para servir" cuando `recetaRequierePrecocinado()` (`js/state.js`) devuelve `false` — ninguno de los dos niveles lo pide — y en ese caso tampoco se genera la alerta "Cocinar hoy" (§9, Alertas). Mismo patrón de agrupación que Despensa: con el filtro en "Todas", `agruparRecetasPorCategoriaHtml()` agrupa por categoría en el orden natural de las comidas (desayuno, comida, cena, postre, snack, y cualquier otra al final por orden alfabético); filtrando a una categoría concreta se muestra la lista plana.
- **Alta rápida de producto** (`PRODUCTO_NUEVO_VALUE` en `js/config.js`): tanto el selector de producto del modal de despensa como el de cada fila de ingrediente de una receta incluyen una opción final "+ Crear producto nuevo…"; al elegirla se despliegan los campos mínimos (nombre, categoría, unidad) y, al guardar, `crearProductoDesdeCampos()` crea el producto vía `apiRequest('producto', ...)` antes de guardar el lote/ingrediente, evitando tener que pasar primero por Configuración.
- **Patrón "desplegable + escribir uno nuevo"** (`wireSelectConNuevo()` / `resolveSelectConNuevo()` en `js/config.js`): un `<select>` con los valores ya usados en algún sitio más una opción centinela ("+ Nueva categoría…", "+ Nuevo detalle…") que revela un `<input>` de texto adyacente. Dos usos, ninguno con tabla propia:
  - **Categoría de producto** (`CATEGORIA_NUEVA_VALUE`): `getCategoriasUnicas()` (`js/state.js`) deriva la lista de categorías ya usadas en `state.productos`; todo campo de categoría (alta en Configuración, alta rápida en despensa/receta) usa este desplegable. `wireCategoriaSelect()`/`resolveCategoriaValue()` son envoltorios de las funciones genéricas con `CATEGORIA_NUEVA_VALUE`; `populateCategoriaSelectors()` refresca los selectores estáticos tras crear/eliminar un producto.
  - **Detalle de ubicación** (`DETALLE_NUEVO_VALUE`, `js/despensa.js`): igual patrón, pero acotado a la ubicación elegida (ver arriba).
- **Menú Semanal** (`js/menu.js`): rejilla de 7 días × 3 comidas (`desayuno`/`comida`/`cena`); cada hueco admite **varios platos** (varias entradas de `menu_semanal` con la misma fecha+comida), cada uno como su propia fila/tarjeta con su receta y `comensales`, más un botón "+ Añadir plato"/"+ Añadir otro plato" para sumar más sin sustituir los que ya hay. Tocar un plato concreto lo abre para editar/eliminar (`data-entrada-id`, no `fecha`+`tipo`, para distinguir cuál de varios); tocar "+ Añadir" siempre crea uno nuevo. Botón "Generar lista de la compra" para la semana visible (llama a `generarListaCompra`, §5).
- **Lista de la Compra** (`js/lista-compra.js`): tres secciones separadas por `origen` — "Del menú" (`menu`), "Reposición automática" (`minimo`) y "Añadido a mano" (`manual`) — cada una en su propio contenedor (`DOM.compraListMenu`/`compraListMinimo`/`compraListManual`), marcar `comprado`, añadir producto manual, y botón para regenerar desde el menú. La sección "Reposición automática" no tiene botón de regenerar: se recalcula sola (`actualizarListaReposicion()`, §5) cada vez que cambia la despensa o el `stock_minimo` de un producto, sin ninguna acción del usuario. En las filas `origen = 'menu'`, tocar el nombre/cantidad (no el checkbox) abre `modal-compra-info` con el desglose de en qué recetas del menú se necesita ese producto y cuánto (`getUsosDeProductoEnMenu()` en `js/state.js`, recalculado al vuelo contra el menú actual — no se guarda nada al generar la lista, así que si el menú cambió después de generarla, el modal avisa de que "ya no aparece en el menú actual" en vez de mostrar datos obsoletos). El modal también muestra un resumen (necesario en total − lo que ya hay en despensa = a comprar) porque la suma de las cantidades por receta es la necesidad **bruta**, mientras que la cantidad de la fila de la lista ya tiene descontado el stock (§5) — sin este resumen los números no cuadrarían a simple vista. En las filas `origen = 'minimo'` y `origen = 'manual'` no hay receta que mostrar, así que el nombre/cantidad sigue marcando `comprado` al tocarlo, igual que el checkbox (es una `<label>` más apuntando al mismo checkbox, no un botón).
- **Configuración** (`js/config.js`): modo de datos (Demo/Local, backup JSON) + dos catálogos editables con el mismo patrón alta/soft-delete: `productos` y `ubicaciones`. El catálogo de productos tiene búsqueda por nombre y un selector de orden (`state.productosFiltro`, por defecto nombre A-Z; también por nombre Z-A, categoría o unidad). El formulario de producto tiene un campo opcional "Stock mínimo" (`productos.stock_minimo`, §3): al guardar (alta o edición) se llama a `actualizarListaReposicion()` para que la sección "Reposición automática" de la Lista de la Compra refleje el cambio al momento.
- **Edición de producto** (`openProductoEdit()` en `js/config.js`): al hacer clic en una fila del catálogo (fuera del botón de eliminar) se rellena el mismo formulario de alta con sus datos y el botón cambia a "Guardar cambios" (`state.editingProductoId`); "Cancelar" o eliminar el producto que se estaba editando vuelve al formulario a modo alta. Como `despensa.cantidad` y `receta_ingredientes.cantidad` se guardan en la unidad canónica del producto (§3) sin ningún registro de en qué unidad se guardaron, cambiarla no las convierte: si el producto tiene algún lote de despensa activo o algún ingrediente de receta (`productoEstaEnUso()` en `js/state.js`), `handleNuevoProductoSubmit()` pide confirmación explícita antes de guardar, avisando de que las cantidades ya guardadas pasarán a interpretarse en la unidad nueva sin conversión.
- **Alertas** (`js/alertas.js`): no es una pantalla con su propio hash — es un icono de campana en la barra superior (visible en cualquier pantalla, con un contador) que abre `modal-alertas`. `getAlertas()` cruza despensa + menú semanal + recetas y devuelve, ya ordenadas por urgencia (0 = más urgente), las 5 alertas pedidas — todo calculado al vuelo, sin guardar nada:
  1. **Comprar hoy** (prioridad 0): para cada producto que necesitan las recetas de HOY (`getNecesidadesDelDia()`, mismo cálculo escalado por comensales que `generarListaCompra()`), si el stock actual (`getStockDisponible()`) no llega, avisa de cuánto falta.
  2. **Caducado, tíralo** (prioridad 1) y **Va a caducar** (prioridad 4): directamente de `getLotesPorCaducar()` (§6), sin cálculo nuevo.
  3. **Descongelar** (prioridad 2): para cada ingrediente de una receta planificada para MAÑANA, si hay algún lote activo de ese producto en una ubicación que "parece congelador" (`esUbicacionCongelador()`: el nombre de la ubicación contiene "congel", ya que `ubicaciones` no tiene un campo de tipo — es una heurística sobre el nombre, no una propiedad formal; si el congelador se renombra a algo sin "congel", la alerta deja de dispararse).
  4. **Cocinar hoy** (prioridad 3): recordatorio de las entradas del menú de hoy cuya receta cumpla `recetaRequierePrecocinado()` (§3). Si lo que dispara la alerta es el interruptor general del plato completo, el detalle es solo el tipo de comida (p. ej. "Comida"), sin desglosar ingredientes — no tiene sentido para un guiso. Si el general está desmarcado y lo que dispara son ingredientes concretos, el detalle los lista (p. ej. "Comida · Precocina: Arroz").
  - El contador de la campana (`renderAlertasBadge()`) se recalcula automáticamente al final de `renderDespensa()` y `renderMenuSemanal()` — como toda mutación relevante (lotes, menú, recetas, productos) ya termina llamando a una de esas dos funciones, no hace falta refrescarlo desde ningún otro sitio.

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

Igual patrón que `ARQUITECTURA-PLANTILLA.md` §6: `sw.js` cache-first para assets estáticos propios y de CDN (Supabase-js), bypass explícito de `supabase.co` / `/rest/v1/`. Registro del Service Worker solo sobre HTTPS o `localhost`.

## 12. Notas de diseño, limitaciones y mejoras futuras

- **Sin conversión de unidades**: todas las cantidades de un producto (despensa, recetas, lista de la compra) se expresan en la unidad canónica fijada al dar de alta el producto (`productos.unidad`). Si una receta necesita "200 g" de algo cuya unidad canónica es "ud", hay que decidir una convención única para ese producto y mantenerla siempre.
- **Un paquete indivisible = un lote**: cuando la despensa se compra/congela en paquetes fijos (p. ej. 3 paquetes de 4 filetes), cada paquete se da de alta como un lote independiente con la misma cantidad, no como un único lote con la cantidad total — así cada paquete se puede editar o eliminar por separado cuando se gasta, sin tener que restar a mano de un número acumulado. El campo "Número de paquetes iguales" del alta (`in-lote-paquetes`, oculto al editar un lote existente) es solo un atajo de UI: `handleLoteFormSubmit()` repite la misma llamada `apiRequest('despensa_lote', 'POST', ...)` una vez por paquete; no crea ningún registro nuevo en el modelo de datos. La fusión visual del listado (§9) es la que luego los muestra juntos como una sola cantidad total.
- **Marcar "comprado" no repone la despensa automáticamente** en esta versión básica; queda como mejora futura ofrecer, al marcar comprado, crear directamente un lote nuevo en `despensa` con esa cantidad y una fecha de caducidad a rellenar.
- **Single-user, sin Auth**: igual que Registro Contable, protegido solo por el secreto de URL + Anon Key (ver `ARQUITECTURA-PLANTILLA.md` §4.2 y §9). Si en el futuro se necesita multiusuario con datos aislados, requiere Supabase Auth + RLS por `user_id` (cambio de arquitectura, no de configuración).
- **Fuera de alcance de la versión básica** (posibles iteraciones futuras): generación automática de menú semanal a partir de recetas favoritas/históricas, conversión de unidades, notificaciones push de caducidad, importación de recetas desde URLs externas.
