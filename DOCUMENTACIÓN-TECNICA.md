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
js/event-handlers.js          Listeners de formularios/UI, inicialización
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
{ id, nombre, categoria, unidad, icono, activa }
```
- `categoria`: texto libre para agrupar visualmente (p. ej. "Verdura", "Lácteos", "Congelados"); no es una tabla propia, es solo una etiqueta descriptiva.
- `unidad`: unidad de medida canónica del producto (`g`, `kg`, `ml`, `l`, `ud`).
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
- `detalle_ubicacion`: texto libre opcional, puramente informativo (p. ej. "Cajón 2", "Balda de arriba"). No participa en ningún filtro ni cálculo (stock, caducidad, lista de la compra); es solo una nota de dónde exactamente está el lote dentro de su `ubicacionId`.
- `fecha_caducidad`: nullable (hay productos, como especias, sin caducidad relevante).
- `activa`: `false` cuando el lote se consume del todo o se retira manualmente. El **stock disponible** de un producto es la suma de `cantidad` de sus lotes `activa = true` (ver `getStockDisponible()` en §4).

### `recetas`
```
{ id, nombre, categoria, tiempo_preparacion_min, comensales_base, instrucciones, activa }
```
- `categoria` ∈ `desayuno | comida | cena | postre | snack` (texto libre, igual que en `productos`).
- `comensales_base`: número de comensales para el que están pensadas las cantidades de `receta_ingredientes`; es la base de escalado al planificar el menú (§5).

### `receta_ingredientes`
```
{ id, recetaId, productoId, cantidad }
```
- `cantidad`: cantidad de `productoId` necesaria para `comensales_base` comensales, en la unidad canónica del producto.
- Regla de UI (no de base de datos): una receta sin ingredientes no debería poder añadirse al menú semanal.

### `menu_semanal`
```
{ id, fecha, tipo_comida, recetaId, comensales, activa }
```
- Una fila por "hueco" de menú: fecha concreta + `tipo_comida` (`desayuno | comida | cena`) + receta asignada.
- `comensales`: comensales reales previstos ese día; puede diferir de `comensales_base` de la receta (el escalado usa `comensales / comensales_base`, ver §5).
- `activa`: soft-delete al quitar una receta del menú sin perder el histórico de "qué se comió" en fechas pasadas.

### `lista_compra`
```
{ id, productoId, cantidad, comprado, origen, fecha_creacion }
```
- `origen` ∈ `menu | manual`. Las filas `origen = 'menu'` las genera `generarListaCompra()` (§5); el usuario puede añadir además productos sueltos con `origen = 'manual'`.
- `comprado`: booleano de control de la compra. Marcarlo **no** modifica `despensa` automáticamente en esta versión básica (ver §12).
- No hay unicidad estricta por `productoId`: `generarListaCompra()` hace upsert solo sobre las filas `origen = 'menu'` pendientes (para no duplicar); el usuario puede tener varias filas manuales del mismo producto.

### Apéndice — SQL de creación (Supabase)

```sql
create table productos (
  id bigint generated always as identity primary key,
  nombre text not null,
  categoria text,
  unidad text not null default 'ud',
  icono text,
  activa boolean not null default true
);

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
  instrucciones text,
  activa boolean not null default true
);

create table receta_ingredientes (
  id bigint generated always as identity primary key,
  "recetaId" bigint not null references recetas(id),
  "productoId" bigint not null references productos(id),
  cantidad numeric not null
);

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

  entradas = menu_semanal activos con fecha en [fechaInicio, fechaFin]
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
- Las filas `origen = 'manual'` nunca las toca `generarListaCompra()`.
- El rango `[fechaInicio, fechaFin]` es típicamente la semana visible en la pantalla Menú Semanal (botón "Generar lista de la compra" en esa pantalla).

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

- **Despensa** (`js/despensa.js`): listado simple (no tarjetas) de lotes, uno por fila, ordenado por nombre de producto y filtrable por `ubicacionId` y por texto. Una fila de cabecera (oculta si la despensa está vacía) rotula las columnas. Cada fila usa una rejilla de columnas fijas (`grid-template-columns`, no flexbox) para que producto, caducidad, cantidad y ubicación queden siempre alineadas verticalmente entre filas, en ese orden: producto → caducidad (fecha en gris si no hay alerta, badge de color si está caducado/próximo, ver §6) → cantidad → ubicación (+ `detalle_ubicacion` si lo tiene). Alta/edición/baja de lotes.
- **Recetas** (`js/recetas.js`): listado filtrable por `categoria`; alta/edición de receta y de su lista de `receta_ingredientes` (selector de producto + cantidad).
- **Menú Semanal** (`js/menu.js`): rejilla de 7 días × 3 comidas (`desayuno`/`comida`/`cena`); cada hueco permite asignar una receta y ajustar `comensales`. Botón "Generar lista de la compra" para la semana visible (llama a `generarListaCompra`, §5).
- **Lista de la Compra** (`js/lista-compra.js`): checklist agrupado por `origen` (`menu` primero, `manual` después), marcar `comprado`, añadir producto manual, y botón para regenerar desde el menú.
- **Configuración** (`js/config.js`): modo de datos (Demo/Local, backup JSON) + dos catálogos editables con el mismo patrón alta/soft-delete: `productos` y `ubicaciones`.

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
- **Marcar "comprado" no repone la despensa automáticamente** en esta versión básica; queda como mejora futura ofrecer, al marcar comprado, crear directamente un lote nuevo en `despensa` con esa cantidad y una fecha de caducidad a rellenar.
- **Single-user, sin Auth**: igual que Registro Contable, protegido solo por el secreto de URL + Anon Key (ver `ARQUITECTURA-PLANTILLA.md` §4.2 y §9). Si en el futuro se necesita multiusuario con datos aislados, requiere Supabase Auth + RLS por `user_id` (cambio de arquitectura, no de configuración).
- **Fuera de alcance de la versión básica** (posibles iteraciones futuras): generación automática de menú semanal a partir de recetas favoritas/históricas, conversión de unidades, notificaciones push de caducidad, importación de recetas desde URLs externas.
