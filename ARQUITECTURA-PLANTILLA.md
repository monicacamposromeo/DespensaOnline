# Arquitectura y Plantilla de Proyecto — SPA/PWA sin build + Supabase + GitHub Pages

> **Propósito de este documento**: no describe la lógica de negocio de Registro Contable (para eso está `DOCUMENTACIÓN-TECNICA.md`). Este documento describe el **patrón de arquitectura e infraestructura** — cómo está montado el proyecto de punta a punta (frontend, backend, conexión a Supabase, control de versiones, despliegue y distribución como PWA instalable en móvil) — para poder **replicarlo tal cual en un proyecto nuevo**, cambiando solo el modelo de datos y las pantallas.

---

## 0. Resumen del patrón en una frase

Una SPA en HTML/CSS/JS **vanilla, sin build step, sin framework y sin backend propio**, que habla directamente con **Supabase** (Postgres + PostgREST + Realtime) usando la Anon Key desde el navegador, empaquetada como **PWA** (`manifest.json` + Service Worker) y desplegada como sitio estático en **GitHub Pages** (o cualquier hosting estático con HTTPS), lo que permite "Instalar" la app desde el móvil como si fuera nativa.

Todo el stack es intencionadamente minimalista: **cero `npm install`, cero paso de compilación, cero servidor propio**. Esto es una decisión de diseño, no una limitación — hace que el proyecto entero sea "clonar y abrir" y que el despliegue sea "hacer push".

---

## 1. Stack tecnológico (y por qué)

| Capa | Elección | Por qué |
|---|---|---|
| Frontend | HTML + CSS + JS vanilla (ES2017+, sin módulos ES, sin TS) | Cero build step: lo que editas es literalmente lo que se sirve. Ideal para proyectos personales/pequeños donde la velocidad de iteración importa más que la escalabilidad de un gran equipo. |
| Backend | Ninguno propio — **Supabase** como *Backend as a Service* | Postgres gestionado + API REST autogenerada (PostgREST) + autenticación + Realtime, sin escribir ni desplegar servidor alguno. |
| Gráficos | [Chart.js](https://www.chartjs.org/) vía CDN | No requiere bundler; se carga con `<script src="https://cdn.jsdelivr.net/...">`. |
| Cliente Supabase | [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) vía CDN (`@2`) | Solo se usa para **Realtime** (WebSockets); las operaciones CRUD normales van directas contra la REST API con `fetch`, sin pasar por el SDK (ver §4). |
| Empaquetado PWA | `manifest.json` + `sw.js` (Service Worker nativo, sin Workbox) | Instalable en Android/iOS/Desktop sin tienda de aplicaciones. |
| Hosting/CI-CD | GitHub Pages sirviendo la rama `main` directamente | Al no haber build, "desplegar" es simplemente "tener el HTML/CSS/JS en la rama servida". No hace falta pipeline. |
| Control de versiones | Git + GitHub | Repo público o privado; sin ramas de release, todo fluye a `main`. |

**No hay `package.json`, no hay `node_modules`, no hay bundler (Vite/Webpack/etc.).** Si en el proyecto nuevo hace falta más de una decena de módulos JS, sigue siendo viable sin build: basta con añadir `<script>` en orden en el HTML (ver §3).

---

## 2. Diagrama de arquitectura

```
┌─────────────────────────────┐
│         NAVEGADOR /          │
│     PWA INSTALADA (móvil)    │
│                               │
│  index.html + style.css      │
│  app.js (router SPA hash)    │
│  js/*.js (pantallas, estado) │
│  sw.js (Service Worker)      │
└───────────────┬───────────────┘
                │  fetch() REST directo (apikey + Bearer anon key)
                │  WebSocket (Realtime, vía supabase-js)
                ▼
┌─────────────────────────────────────────────┐
│                  SUPABASE                     │
│  ┌───────────────┐   ┌──────────────────────┐ │
│  │  PostgREST     │   │  Realtime (websocket) │ │
│  │  /rest/v1/...  │   │  postgres_changes     │ │
│  └───────┬────────┘   └──────────┬────────────┘ │
│          ▼                       ▼               │
│  ┌───────────────────────────────────────────┐  │
│  │        Postgres (tablas + RLS)             │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘

Repo Git (GitHub) ──push a main──► GitHub Pages (hosting estático, HTTPS)
                                          │
                                          ▼
                              URL pública HTTPS
                                          │
                          "Añadir a pantalla de inicio"
                                          ▼
                              PWA instalada en el móvil
```

No existe capa de backend intermedia: el navegador es el único cliente y habla directamente con Supabase. Esto simplifica la arquitectura al máximo pero tiene una implicación de seguridad importante (ver §4.3).

---

## 3. Estructura de archivos y convención de "sin build"

```
mi-app/
├── index.html          # Markup de TODAS las pantallas (SPA de una sola página).
│                        # Secciones .app-screen que se muestran/ocultan por CSS/JS.
│                        # Al final del <body>, los <script> en orden de dependencia.
├── app.js               # Entry point: bootstrap de la app + router SPA (hash routing)
│                        # + registro del Service Worker.
├── sw.js                 # Service Worker (cache-first de assets estáticos).
├── manifest.json         # Manifest de la PWA (nombre, iconos, colores, display).
├── icon.svg              # Icono de la app (usar SVG único sirve para todos los tamaños).
├── style.css              # Todo el CSS de la app (o varios ficheros, sin preprocesador).
└── js/
    ├── state.js           # Estado global (objeto `state`) + caché de DOM (objeto `DOM`)
    │                       # + funciones "índice derivado" (agregaciones calculadas de los datos).
    ├── utils.js            # Helpers puros: formato de fecha/moneda, toasts, spinner.
    ├── api.js              # ÚNICO punto de entrada a datos: apiRequest(action, method, data).
    │                        # Aquí vive la integración con Supabase REST + Realtime.
    ├── storage.js           # Modo Local (JSON en localStorage) y modo Demo (memoria).
    ├── event-handlers.js     # Wiring de listeners de formularios/UI, inicialización.
    └── <pantalla>.js          # Un fichero por pantalla/dominio (ver app real como ejemplo).
```

Reglas de esta convención (aplican igual al proyecto nuevo):

1. **Sin módulos ES, sin `import`/`export`.** Todo es global. El orden de los `<script>` en `index.html` importa: un fichero que use una función de otro debe cargarse después.
2. **Un único objeto `state`** con todo el estado mutable de la app (modo activo, credenciales, colecciones de datos, filtros de UI, paginación). Se declara en `state.js` y se referencia desde cualquier otro fichero sin pasarlo como parámetro.
3. **Un único objeto `DOM`**, calculado una vez (`document.getElementById(...)` para cada elemento relevante) al cargar el script, para no repetir `getElementById` por toda la app.
4. **Un único punto de acceso a datos**: toda lectura/escritura pasa por una función tipo `apiRequest(action, method, data)` que internamente decide el backend real (ver §5). Ninguna pantalla debe hacer `fetch` directo a Supabase — así el resto del código es agnóstico del backend.
5. **Un fichero por pantalla/dominio**, con sus propias funciones de render (`renderX()`) y sus propios manejadores de formulario.

Esta convención es deliberada: para una app de uso personal/pequeño equipo, el coste de un bundler (config, tooling, tiempos de build) no compensa frente a la simplicidad de "editar y recargar".

---

## 4. Integración con Supabase

### 4.1 Qué es Supabase en este patrón

Supabase se usa exclusivamente como:
- **Base de datos Postgres gestionada.**
- **API REST autogenerada** sobre esas tablas (PostgREST), expuesta en `https://<proyecto>.supabase.co/rest/v1/<tabla>`.
- **Canal Realtime** (WebSockets) que notifica INSERT/UPDATE/DELETE sobre las tablas.

No se usa Supabase Auth, Storage ni Edge Functions en este patrón (aunque están disponibles si el proyecto nuevo los necesita).

### 4.2 Cómo se crea el backend desde cero (para el proyecto nuevo)

1. Crear proyecto en [supabase.com](https://supabase.com/) (plan gratuito es suficiente para uso personal).
2. En el **SQL Editor**, crear las tablas del dominio (ver el modelo de datos de `DOCUMENTACIÓN-TECNICA.md` como ejemplo de diseño: entidades planas, claves foráneas por convención de nombre `xxxId`, soft-delete vía columna `activa` en vez de `DELETE`).
3. Copiar de **Project Settings → API**:
   - `Project URL` (p. ej. `https://abcxyz.supabase.co`) → esto es `state.apiUrl` en el cliente.
   - `anon public key` (JWT largo) → esto es `state.supabaseKey`.
4. **Habilitar Realtime** en las tablas que lo necesiten (Database → Replication, o `ALTER PUBLICATION supabase_realtime ADD TABLE <tabla>;`).
5. Decidir la política de **RLS (Row Level Security)**:
   - Para una app de un único usuario/uso personal protegida solo por el secreto de la Anon Key + URL (como este proyecto), la opción más simple es **RLS desactivada** o políticas `USING (true)` que permiten todo con la Anon Key.
   - **Importante — implicación de seguridad**: la Anon Key viaja en el propio código cliente (`localStorage`) y es visible para cualquiera que inspeccione el tráfico o el `localStorage` del navegador. Este patrón es aceptable para un proyecto **personal/privado sin datos sensibles de terceros**, donde "quien tiene la URL + key puede leer/escribir todo". Si el proyecto nuevo va a tener más de un usuario o datos sensibles, **hay que activar RLS de verdad con Supabase Auth** (login por email/OAuth) y políticas por `user_id` — eso es un cambio de arquitectura respecto a este patrón, no una opción de configuración menor.

### 4.3 Cómo se conecta el cliente (sin SDK para CRUD)

El patrón **no usa el SDK `supabase-js` para leer/escribir datos**, solo para Realtime. Las operaciones normales son `fetch` directo a la REST API:

```js
const options = {
  mode: 'cors',
  method: 'POST', // GET / POST / PATCH / DELETE según la acción
  headers: {
    'apikey': state.supabaseKey,
    'Authorization': `Bearer ${state.supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation' // para que el POST devuelva la fila insertada (con su id)
  },
  body: JSON.stringify({ /* columnas de la tabla */ })
};
const res = await fetch(`${state.apiUrl}/rest/v1/<tabla>`, options);
```

Convenciones REST de PostgREST que reutilizar en el proyecto nuevo:
- **Filtros** en query string: `?columna=eq.valor`, `?columna=ilike.*texto*`, `?or=(a.eq.1,b.eq.2)`.
- **Paginación**: cabecera `Prefer: count=exact` + `?limit=N&offset=M`; el total viene en la cabecera de respuesta `Content-Range`.
- **Orden**: `?order=columna.asc`.
- **RPC** (funciones SQL) se llaman como `POST /rest/v1/rpc/<nombre_funcion>`.

El SDK `supabase-js` (cargado por CDN) se reserva para abrir el canal Realtime:

```js
const client = window.supabase.createClient(state.apiUrl, state.supabaseKey);
const channel = client
  .channel('cambios-app')
  .on('postgres_changes', { event: '*', schema: 'public' }, handleRealtimeChange)
  .subscribe();
```

`handleRealtimeChange` debe hacer **debounce** (p. ej. 300 ms) antes de resincronizar, porque una sola acción del usuario puede disparar varios eventos Realtime seguidos (p. ej. insertar 3 filas en lote).

### 4.4 Patrón de sincronización recomendado

- **Al arrancar**: si hay credenciales guardadas, cargar metadatos ligeros + abrir Realtime.
- **Tras cada escritura** (`apiRequest` con método distinto de GET): si el canal Realtime está activo, **no** forzar una resincronización manual — dejar que el propio evento Realtime dispare el refresco (evita doble trabajo y desincronización). Si Realtime no está disponible, sí forzar sync manual como fallback.
- **Al volver la pestaña/app a primer plano** (evento `visibilitychange`): reconectar Realtime si el socket murió (típico tras suspender el dispositivo) y forzar una resincronización de seguridad.
- Separar la sincronización en dos niveles: una "ligera" (todas las filas pero solo columnas necesarias para agregados/dashboard) y una "completa/paginada" (para listados detallados), para no traer todo el histórico completo en cada pantalla.

---

## 5. Patrón de "tres backends intercambiables" (opcional pero recomendado)

Un patrón que vale la pena replicar incluso si el proyecto nuevo solo va a usar Supabase: aislar **todo** el acceso a datos detrás de una única función `apiRequest(action, method, data)` que internamente puede resolver contra:

1. **Supabase** (backend real, remoto).
2. **Modo Local**: un JSON completo guardado en `localStorage`, para poder usar la app sin conexión/sin backend, exportable/importable como fichero de backup.
3. **Modo Demo**: datos de ejemplo solo en memoria, para poder enseñar/probar la app sin credenciales ni riesgo de tocar datos reales.

Ventajas de este patrón:
- El código de pantallas/formularios **no sabe ni le importa** qué backend está activo — siempre llama a `apiRequest(...)`.
- Permite desarrollar y probar toda la lógica de negocio (Demo/Local) **antes** de tener siquiera el proyecto Supabase creado, y solo migrar el SQL al final.
- El modo Local sirve además como mecanismo de backup manual: "Descargar Base de Datos" (volcar el JSON) / "Cargar Base de Datos" (leer un fichero `.json`).

No es obligatorio para el proyecto nuevo, pero si se espera iterar rápido sobre el modelo de datos antes de tener el esquema de Supabase cerrado, ahorra mucho tiempo.

---

## 6. PWA: manifest + Service Worker

### 6.1 `manifest.json`

```json
{
  "name": "Nombre completo de la app",
  "short_name": "NombreCorto",
  "description": "Descripción breve.",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "orientation": "any",
  "icons": [
    { "src": "icon.svg", "sizes": "192x192 512x512", "type": "image/svg+xml", "purpose": "any" },
    { "src": "icon.svg", "sizes": "192x192 512x512", "type": "image/svg+xml", "purpose": "maskable" }
  ]
}
```

- Un único icono **SVG** cubre todos los tamaños declarados (evita generar múltiples PNGs).
- `display: "standalone"` es lo que hace que, una vez instalada, la app se abra sin barra de navegador (aspecto de app nativa).
- Enlazar el manifest desde `index.html`: `<link rel="manifest" href="./manifest.json">`.

### 6.2 `sw.js` (Service Worker)

Estrategia recomendada: **cache-first para assets estáticos propios y de CDN, bypass total para la API de datos**.

```js
const CACHE_NAME = 'mi-app-v1'; // subir el número al cambiar el set de assets cacheados
const ASSETS_TO_CACHE = [
  './', './index.html', './style.css', './app.js', './manifest.json', './icon.svg',
  './js/state.js', /* ...resto de js/*.js... */,
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Nunca cachear la API de datos ni peticiones no-GET
  if (event.request.method !== 'GET' || url.href.includes('supabase.co') || url.pathname.includes('/rest/v1/')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
```

Puntos clave a replicar:
- **Bypass explícito del dominio del backend** (`supabase.co`, `/rest/v1/`) — nunca cachear datos, solo assets estáticos, o la app mostrará datos obsoletos tras escrituras.
- Subir `CACHE_NAME` (p. ej. `v1` → `v2`) cada vez que cambie el conjunto de ficheros cacheados, para forzar invalidación de caché en los dispositivos ya instalados.
- Registrar el Service Worker **solo sobre HTTPS o `localhost`** (los navegadores lo exigen; en `app.js`: comprobar `location.protocol === 'https:' || hostname === 'localhost'` antes de `navigator.serviceWorker.register(...)`).

### 6.3 Instalación en el móvil

No requiere ninguna tienda de aplicaciones ni build nativo:

- **Android (Chrome)**: al visitar la URL HTTPS, Chrome puede ofrecer automáticamente el banner "Instalar app"; si no, menú ⋮ → "Instalar aplicación" / "Añadir a pantalla de inicio".
- **iOS (Safari)**: botón compartir (□↑) → "Añadir a pantalla de inicio". Safari no dispara el banner automático como Chrome; el usuario siempre lo hace manualmente.
- **Desktop (Chrome/Edge)**: icono de instalación en la barra de direcciones.

Requisitos imprescindibles para que el navegador considere la app "instalable": servir sobre **HTTPS**, tener `manifest.json` enlazado y válido, y tener un **Service Worker registrado con al menos un `fetch` handler**.

---

## 7. Control de versiones y despliegue (GitHub Pages)

### 7.1 Estructura del repo

Un repo Git plano, sin ramas de release: se trabaja y se despliega desde `main`. Sin `.github/workflows` obligatorio porque no hay build — GitHub Pages puede servir la rama directamente.

### 7.2 Configurar GitHub Pages (una vez, desde la web de GitHub)

1. Repo en GitHub → **Settings → Pages**.
2. **Source**: "Deploy from a branch".
3. **Branch**: `main`, carpeta `/ (root)` (ya que `index.html` está en la raíz del repo).
4. Guardar. GitHub publica la URL (`https://<usuario>.github.io/<repo>/`) en unos minutos.

Con esto, **cada `git push` a `main` despliega automáticamente** — no hace falta pipeline de CI/CD porque no hay paso de build que ejecutar.

### 7.3 Alternativa equivalente: GitLab Pages

Si en vez de GitHub se usa GitLab, el mismo patrón estático se sirve con GitLab Pages, que sí requiere un `.gitlab-ci.yml` mínimo (GitLab Pages siempre despliega desde un job de CI, aunque no haya nada que compilar):

```yaml
pages:
  stage: deploy
  script:
    - mkdir -p public
    - cp -r * public/ 2>/dev/null || true
  artifacts:
    paths:
      - public
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
```

Notas:
- GitLab Pages exige que los ficheros a servir vivan en una carpeta llamada `public/` como artefacto del job — de ahí el `cp -r * public/`.
- El resultado es funcionalmente idéntico a GitHub Pages: una URL HTTPS (`https://<usuario>.gitlab.io/<repo>/`) instalable como PWA igual que en §6.3.
- Si el proyecto nuevo usa GitLab, esta es la única pieza de infraestructura "de más" respecto al patrón GitHub (un CI mínimo de copiar ficheros, no de compilar nada).

### 7.4 Cosas a vigilar en despliegue estático sin build

- **Rutas relativas**: usar siempre `./fichero.js` en vez de `/fichero.js` en `index.html`/`sw.js`, porque si el sitio se sirve bajo una subruta (`usuario.github.io/repo/`, no en la raíz del dominio) las rutas absolutas romperían.
- **Cachear la versión del Service Worker**: tras cada despliegue con cambios, súbele el número a `CACHE_NAME` en `sw.js` (§6.2) o los usuarios que ya instalaron la PWA seguirán viendo assets antiguos indefinidamente.
- **Credenciales de Supabase nunca en el repo**: la URL y la Anon Key se introducen desde la UI de la app (pantalla de configuración) y se guardan en `localStorage` del dispositivo del usuario, no en variables de entorno ni en el código — porque no hay build step que las inyecte. Esto es coherente con el hecho de que la Anon Key ya es pública por diseño en Supabase (protegida por RLS, no por secretismo); ver §4.2.

---

## 8. Checklist para arrancar el proyecto nuevo desde esta plantilla

1. [ ] Crear repo nuevo (GitHub o GitLab) y clonar localmente.
2. [ ] Copiar la estructura de ficheros base (§3): `index.html`, `app.js`, `sw.js`, `manifest.json`, `icon.svg`, `style.css`, `js/state.js`, `js/utils.js`, `js/api.js`, `js/storage.js`, `js/event-handlers.js`.
3. [ ] Diseñar el modelo de datos del dominio nuevo (entidades planas, `activa` para soft-delete, convención `xxxId` para FKs) — inspirarse en el modelo de `DOCUMENTACIÓN-TECNICA.md` §3 pero adaptado al dominio.
4. [ ] Implementar y probar toda la lógica en **modo Demo/Local** primero (sin depender de Supabase), usando `apiRequest(action, method, data)` como única puerta de acceso a datos (§5).
5. [ ] Crear el proyecto en Supabase, las tablas, decidir política de RLS (§4.2), copiar URL + Anon Key.
6. [ ] Implementar la rama Supabase de `apiRequest` (fetch REST directo + Realtime) reutilizando las convenciones de §4.3–4.4.
7. [ ] Adaptar `manifest.json` (nombre, colores, icono) y `sw.js` (lista de assets a cachear, bypass del dominio Supabase) — §6.
8. [ ] Configurar GitHub Pages / GitLab Pages sobre `main` — §7.
9. [ ] Verificar en un móvil real: abrir la URL HTTPS, comprobar que aparece la opción de instalar, instalar, y probar que funciona offline para la UI (aunque sin datos frescos sin red).
10. [ ] Documentar el modelo de datos y las reglas de negocio específicas del dominio nuevo en un `DOCUMENTACIÓN-TECNICA.md` propio (igual que en este proyecto), dejando este documento (`ARQUITECTURA-PLANTILLA.md`) sin tocar como referencia de infraestructura reutilizable.

---

## 9. Limitaciones conocidas de este patrón (a tener en cuenta en el proyecto nuevo)

- **No apto para multiusuario con datos sensibles** sin añadir Supabase Auth + RLS por `user_id` — tal cual está, cualquiera con la URL + Anon Key tiene acceso completo de lectura/escritura.
- **Sin tests automatizados ni CI de calidad** — al no haber build, tampoco hay paso natural donde enganchar linter/tests; si el proyecto nuevo lo necesita, hay que añadirlo explícitamente (p. ej. GitHub Actions ejecutando un linter sobre los `.js`, opcional y desacoplado del despliegue).
- **Todo el estado es global** (`state`, `DOM`) — funciona bien para una app de tamaño pequeño/medio con un desarrollador; no escala igual de bien a equipos grandes o apps muy complejas sin introducir algo de modularidad.
- **Offline real limitado**: el Service Worker cachea la *interfaz*, no los *datos* — sin conexión se puede abrir la app pero no leer/escribir contra Supabase (a menos que se combine con el modo Local como caché de datos, no solo de backup manual).
