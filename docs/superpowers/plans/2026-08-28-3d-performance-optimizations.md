# 3D Performance Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir trabajo redundante de GPU y fugas de recursos en la escena 3D sin cambiar su aspecto por defecto, conservar Leva y dejar una comparacion reproducible antes/despues.

**Architecture:** El primer lote mantiene el pipeline visual actual y elimina solo trabajo demostrablemente redundante: MSAA del canvas que no llega a la salida del composer, sombras inactivas, recompilaciones por clearcoat en cero y geometrias procedurales sin ownership explicito. La medicion se incorpora detras de un control Leva apagado por defecto; Adaptive DPR queda como experimento opt-in y no se habilita por defecto sin datos y revision visual.

**Tech Stack:** Next.js 15.5.24, React 19.1.0, TypeScript 5.9.3, Three.js 0.185.1, React Three Fiber 9.7.0, Drei 10.7.8, React Three Postprocessing 3.1.0, Leva 0.10.1, pnpm lockfile v9.

## Global Constraints

- Trabajar exclusivamente en `/Users/jeresrc/orca/workspaces/badges-demo/sander`; no crear otro worktree.
- Conservar Leva y todos sus controles funcionales.
- No quitar `transmission`, no reducir teselacion, no fusionar glifos y no dividir el contexto en este lote.
- No anadir GLTF, texturas externas ni dependencias de runtime; el repositorio no usa esos recursos.
- Mantener `<EffectComposer multisampling={8}>` y desactivar unicamente el antialiasing redundante del framebuffer del canvas.
- Mantener `dpr={[1, 2]}` como calidad inicial; Adaptive DPR debe quedar apagado por defecto y medirse como variante opt-in.
- Toda instrumentacion debe estar desmontada cuando `showDiagnostics` sea `false`; el valor por defecto es `false`.
- No usar `StatsGl`, no inyectar DOM o estilos y no dejar timers, queries ni listeners despues de desmontar diagnostics.
- Los contadores de `renderer.info` deben cubrir el frame completo de EffectComposer: `autoReset=false`, reset antes del frame, captura despues del composer y restauracion del valor previo al desmontar.
- No presentar `renderer.info` del ultimo pass como total ni presentar tiempo CPU como tiempo GPU.
- El timing GPU es opcional: si `EXT_disjoint_timer_query_webgl2` no existe, el reporte debe indicar `unavailable` y la comparacion usa solamente intervalos de frame, CPU submission y contadores del renderer.
- No modificar `pnpm-workspace.yaml` como parte de este lote: su `allowBuilds.unrs-resolver` invalido es un problema preexistente de setup, no una optimizacion 3D.
- No descartar ni sobrescribir cambios concurrentes del usuario.
- No crear commits durante esta ejecucion; la solicitud de esta fase y del lote es mantener los cambios sin commit.

---

## Preflight Confirmado

- Worktree enlazado: `/Users/jeresrc/orca/workspaces/badges-demo/sander` aparece en `git worktree list --porcelain`.
- Rama y HEAD iniciales: `sander` en `15e54ea8bb5b430bc18bf10c5f69dcd9b1c2c9a2`.
- Estado inicial: limpio (`git status --short --branch` devolvio solamente `## sander`).
- Lockfile: `pnpm-lock.yaml`, `lockfileVersion: '9.0'`.
- `pnpm install --frozen-lockfile` materializo 406 paquetes, pero termino con codigo 1 antes de aprobar builds porque `pnpm-workspace.yaml:2` contiene `unrs-resolver: set this to true or false`.
- Por el mismo chequeo automatico, `pnpm lint` y `pnpm build` terminan en el preflight de `pnpm install` y no invocan sus scripts. Es un fallo preexistente de configuracion.
- El comando real del script lint, `./node_modules/.bin/eslint`, termino con codigo 0 y sin salida.
- El comando real del script build, `./node_modules/.bin/next build --turbopack`, termino con codigo 0: compilo, ejecuto lint/typecheck, genero 5 paginas estaticas y reporto `/` con 362 kB y 476 kB de First Load JS.
- No existen scripts `typecheck` ni `test` en `package.json`; el build disponible ya ejecuto `Linting and checking validity of types`.
- El comando real de desarrollo, `./node_modules/.bin/next dev --turbopack -p 3100`, quedo listo en 1395 ms y `GET http://127.0.0.1:3100/` respondio 200.

## File Map

- Modify: `components/Scene.tsx` para diagnostico opt-in con lifecycle propio, ownership del pipeline AA, clearcoat estable y experimento Adaptive DPR.
- Modify: `components/Studio.tsx` para corregir documentacion que afirma sombras inexistentes.
- Modify: `app/layout.tsx` para iniciar la descarga de `/fonts/typeface.json` desde el documento HTML.
- Modify: `components/badges/parts.tsx` para liberar todas las geometrias creadas por `extrudeCentered` al cambiar o desmontar una pieza.
- Modify: `components/badges/BoxedPin.tsx` para liberar las tres geometrias procedurales propias de la caja.
- Modify: `components/badges/Packaged.tsx` para liberar las dos geometrias densas de film.
- Modify: `components/badges/BoxedPin.tsx`, `components/badges/Packaged.tsx` y `components/badges/parts.tsx` para retirar flags de sombras que nunca pueden producir shadow maps.
- No change: `components/badges/Medallion.tsx`; los glifos y sus flags quedan fuera de este lote.
- No change: `components/badges/materials.tsx`; sus materiales consumen el clearcoat ya estabilizado por `Scene` y se preservan transmission, film y apariencia.
- No change: `components/badges/shapes.ts:66-89`; `extrudeCentered` ya libera correctamente la `ExtrudeGeometry` intermedia cuando `toCreasedNormals` devuelve otra instancia.

## Reproducible Measurement Protocol

- Before editing, run `git status --short --branch` and `git diff --name-only`, and retain their exact output in the session notes. Re-run both before every task; treat new unrelated paths as concurrent work, leave them untouched and report them instead of restoring or cleaning them.
- Use Chrome in one unchanged profile, browser zoom 100%, viewport `1440x900`, device scale factor 2, AC power and no open DevTools panels except Console/Performance. Keep `adaptiveDpr=false` for the main before/after comparison.
- Use production mode for measurements. Before starting, verify port 3100 is free; never kill a listener not started by this task:

```bash
if lsof -nP -iTCP:3100 -sTCP:LISTEN; then
  printf 'port 3100 is already in use; stop the owning process explicitly before measuring\n' >&2
  exit 1
fi
./node_modules/.bin/next build --turbopack
./node_modules/.bin/next start -p 3100
```

- Keep the server in the foreground. Stop it with `Ctrl-C` after each build and verify cleanup with `lsof -nP -iTCP:3100 -sTCP:LISTEN`; expected: no output. This applies equally when a task temporarily uses `./node_modules/.bin/next dev --turbopack -p 3100` for a functional check.
- After changing `gl.antialias`, stop the old server, rebuild, restart, choose `Empty Cache and Hard Reload`, and verify the new `[3d-performance]` report says `contextAntialias: false`. A hot reload cannot validate a WebGL context-creation option.
- For each variant, perform three independent runs. A run starts by toggling `showDiagnostics` from false to true, continuously orbiting until one report appears, then toggling it false. The probe discards 120 warmup frames and reports the next 300 frames.
- Compare the median of the three per-run medians. Accept no regression greater than 5% in `frameIntervalMs` or `cpuSubmitMs` for any variant; `calls` and `triangles` must not increase. Renderer memory/program counts are lifecycle checks, not frame-time metrics.
- A Chrome Performance trace may be recorded as supporting evidence. Treat a GPU track as GPU timing only when the browser exposes it. When `EXT_disjoint_timer_query_webgl2` is absent, record GPU timing as `unavailable`; do not substitute `cpuSubmitMs` or the last composer pass.

### Task 1: Add Lifecycle-Safe Opt-In Measurement Before Optimizing

**Files:**
- Modify: `components/Scene.tsx:3-14,34-65,94-136`

**Interfaces:**
- Consumes: `BadgeVariant`, R3F `useFrame`, `WebGLRenderer.info` and the composer render priority 1 confirmed in `@react-three/postprocessing`.
- Produces: control Leva `Performance.showDiagnostics: boolean` and one console report containing full-frame medians after warmup; no DOM overlay.

- [ ] **Step 1: Add the full-frame gated diagnostics component**

Replace the Fiber import, keep the Drei import free of stats components, and add these types/helpers plus `PerformanceDiagnostics` immediately below `PinStage`:

```tsx
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";

type DiagnosticSample = {
  frameIntervalMs: number;
  cpuSubmitMs: number;
  calls: number;
  triangles: number;
  pixelRatio: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function PerformanceDiagnostics({
  variant,
  clearcoat,
}: {
  variant: BadgeVariant;
  clearcoat: number;
}) {
  const gl = useThree((state) => state.gl);
  const frameStartedAt = useRef(0);
  const frameCount = useRef(0);
  const samples = useRef<DiagnosticSample[]>([]);
  const reported = useRef(false);
  const gpuTimerAvailable = useRef(false);

  useEffect(() => {
    const previousAutoReset = gl.info.autoReset;
    const context = gl.getContext();
    gpuTimerAvailable.current =
      context instanceof WebGL2RenderingContext &&
      context.getExtension("EXT_disjoint_timer_query_webgl2") !== null;
    gl.info.autoReset = false;
    gl.info.reset();

    return () => {
      gl.info.autoReset = previousAutoReset;
      gl.info.reset();
      frameCount.current = 0;
      samples.current = [];
      reported.current = false;
    };
  }, [gl]);

  useFrame(() => {
    gl.info.reset();
    frameStartedAt.current = performance.now();
  }, Number.NEGATIVE_INFINITY);

  useFrame((_, delta) => {
    frameCount.current += 1;
    if (frameCount.current <= 120 || reported.current) return;

    samples.current.push({
      frameIntervalMs: delta * 1000,
      cpuSubmitMs: performance.now() - frameStartedAt.current,
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      pixelRatio: gl.getPixelRatio(),
    });

    if (samples.current.length === 300) {
      const current = samples.current;
      reported.current = true;
      console.info("[3d-performance]", {
        variant,
        clearcoat,
        contextAntialias: gl.getContext().getContextAttributes()?.antialias ?? null,
        gpuTiming: gpuTimerAvailable.current
          ? "not measured in app; use a verified browser GPU trace"
          : "unavailable: EXT_disjoint_timer_query_webgl2 is absent",
        frameIntervalMs: median(current.map((sample) => sample.frameIntervalMs)),
        cpuSubmitMs: median(current.map((sample) => sample.cpuSubmitMs)),
        calls: median(current.map((sample) => sample.calls)),
        triangles: median(current.map((sample) => sample.triangles)),
        pixelRatio: median(current.map((sample) => sample.pixelRatio)),
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
      });
    }
  }, Number.POSITIVE_INFINITY);

  return null;
}
```

The negative-priority callback resets counters before scene/composer work. The positive-infinity callback runs after `EffectComposer` priority 1, so calls and triangles are totals for all passes. The component creates no query, DOM node, style, timer or event listener; cleanup restores the prior `autoReset` value and clears retained samples.

- [ ] **Step 2: Add a default-off Leva flag**

Add this control after the existing `Scene` controls in `Scene()`:

```tsx
  const { showDiagnostics } = useControls("Performance", {
    showDiagnostics: false,
  });
```

Mount diagnostics as the final child inside `Canvas`, after `EffectComposer`:

```tsx
        {showDiagnostics && (
          <PerformanceDiagnostics variant={variant} clearcoat={clearcoat} />
        )}
```

- [ ] **Step 3: Verify zero default instrumentation and a passing build**

Run:

```bash
rg -n 'showDiagnostics|PerformanceDiagnostics|autoReset|Number\.NEGATIVE_INFINITY|Number\.POSITIVE_INFINITY' components/Scene.tsx
if rg -n 'StatsGl|trackGPU' components; then exit 1; fi
./node_modules/.bin/eslint
./node_modules/.bin/next build --turbopack
```

Expected: `showDiagnostics` has literal default `false`, both frame boundaries and restore logic are present, the forbidden search has no output, ESLint exits 0, and Next completes lint/typecheck with exit 0.

- [ ] **Step 4: Capture the instrumented baseline before any optimization task**

Use the production server lifecycle from the reproducible protocol. Open `http://localhost:3100`, keep `adaptiveDpr=false`, and measure each Leva variant in this fixed order: `medallion`, `hex`, `packaged`, `boxed`. Run each variant three times by toggling diagnostics off/on and orbit continuously until the report appears. Record all 12 `[3d-performance]` objects and the median of the three reports per variant before changing AA or shadows.

Expected: each mount emits exactly one report after 120 warmup plus 300 measured frames; `calls` and `triangles` represent the whole composer frame; `gpuTiming` either directs the operator to a separately verified browser trace or explicitly says unavailable, never a fabricated duration.

### Task 2: Remove Duplicate Antialiasing and Dead Shadows

**Files:**
- Modify: `components/Scene.tsx:96-100,113-122`
- Modify: `components/Studio.tsx:5-17`
- Modify: `components/badges/parts.tsx:38-94`
- Modify: `components/badges/BoxedPin.tsx:81-97`
- Modify: `components/badges/Packaged.tsx:71-136`
- No change: `components/badges/Medallion.tsx:41-86`

**Interfaces:**
- Consumes: the existing composer-owned postprocessing path.
- Produces: exactly one active MSAA owner, `EffectComposer multisampling={8}`, and no enabled shadow-map path; protected Medallion glyph flags remain inert.

- [ ] **Step 1: Make EffectComposer the only MSAA owner**

Replace the Canvas opening props in `components/Scene.tsx` with:

```tsx
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: false }}
        camera={{ position: [0, 0, 4.4], fov: 45, near: 0.1, far: 100 }}
      >
```

Keep this line unchanged:

```tsx
        <EffectComposer multisampling={8}>
```

The canvas context MSAA only affects the default framebuffer, while this scene renders through composer targets; keeping both does not improve the final image.

- [ ] **Step 2: Remove inert mesh shadow flags**

Remove every `castShadow` and `receiveShadow` prop from `parts.tsx`, `BoxedPin.tsx`, and `Packaged.tsx`. Preserve every other prop and child. For example, the four meshes in `parts.tsx` become:

```tsx
    <mesh geometry={geometry}>
    <mesh geometry={geometry} position={[offset[0], offset[1], zPos]}>
    <mesh geometry={geometry} position={[0, 0, z]}>
    <mesh geometry={geometry} position={[0, 0, BACK_Z]}>
```

The two real spot lights have no `castShadow`, so these flags and `<Canvas shadows>` cannot currently produce a visible shadow. Do not edit `Medallion.tsx`: its per-glyph flags remain inert once Canvas shadows are disabled, and glyph changes are explicitly outside this batch.

- [ ] **Step 3: Correct the lighting-rig comment**

Replace `components/Studio.tsx:15-16` with:

```tsx
 * Two real spot lights sit on top of that to give directional, controllable
 * shading across the recessed enamel without allocating shadow maps.
```

- [ ] **Step 4: Verify one AA path and no shadow configuration**

Run:

```bash
rg -n 'antialias|multisampling|shadows|castShadow|receiveShadow' components/Scene.tsx components/Studio.tsx components/badges/parts.tsx components/badges/BoxedPin.tsx components/badges/Packaged.tsx
rg -n 'castShadow|receiveShadow' components/badges/Medallion.tsx
./node_modules/.bin/eslint
./node_modules/.bin/next build --turbopack
```

Expected: the first search shows only `gl={{ antialias: false }}`, `<EffectComposer multisampling={8}>`, and prose that does not claim rendered shadows. The second search still shows untouched glyph flags at current lines 74-75. ESLint and build exit 0.

- [ ] **Step 5: Recreate the WebGL context before measuring AA**

Stop the baseline server with `Ctrl-C`, verify port 3100 is free, rebuild, restart with the production lifecycle, and use Chrome `Empty Cache and Hard Reload`. Run the three-report protocol again with `adaptiveDpr=false`.

Expected: every report says `contextAntialias: false`; no comparison uses a hot-reloaded context created with the previous `antialias: true` option.

### Task 3: Keep the Clearcoat Shader Variant Stable

**Files:**
- Modify: `components/Scene.tsx:73-92`

**Interfaces:**
- Consumes: Leva `clearcoat` range `[0, 1]` unchanged for the user.
- Produces: `PinMaterialSettings.clearcoat` always strictly greater than zero, preventing Three.js `MeshPhysicalMaterial.clearcoat` from crossing its shader-define boundary.

- [ ] **Step 1: Clamp only the renderer-facing value above zero**

Change the clearcoat property inside the existing `materials` memo to:

```tsx
      // Three recompiles MeshPhysicalMaterial when clearcoat crosses zero.
      // Epsilon is visually zero while keeping the shader define stable.
      clearcoat: Math.max(clearcoat, Number.EPSILON),
```

Keep `clearcoat` in the dependency array and keep the Leva definition unchanged:

```tsx
    clearcoat: { value: 1, min: 0, max: 1, step: 0.01 },
```

- [ ] **Step 2: Verify the shader program count does not grow across zero**

Use the production server lifecycle. Enable `Performance > showDiagnostics`, select `medallion`, and collect one warmed report at clearcoat 1. Toggle diagnostics off, set clearcoat 0, toggle diagnostics on and collect the next report. Repeat at 1 and 0.

Expected: all four post-warmup reports have the same `programs` count, the material remains visually uncoated at slider value 0, and no black frame or interaction stall appears.

- [ ] **Step 3: Run static verification**

Run:

```bash
rg -n 'Math\.max\(clearcoat, Number\.EPSILON\)|clearcoat: \{ value: 1, min: 0' components/Scene.tsx
./node_modules/.bin/eslint
./node_modules/.bin/next build --turbopack
```

Expected: both patterns are present; ESLint and build exit 0.

### Task 4: Preload the Typeface JSON

**Files:**
- Modify: `app/layout.tsx:14-17`

**Interfaces:**
- Consumes: same-origin static asset `/fonts/typeface.json` already consumed by `Text3D` in `components/badges/Medallion.tsx:34,65-67`.
- Produces: an HTML fetch preload matching Drei `useFont`'s fetch request; no second font format or dependency.

- [ ] **Step 1: Add the document-level preload**

Replace the returned HTML in `RootLayout` with:

```tsx
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/typeface.json"
          as="fetch"
          type="application/json"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
```

- [ ] **Step 2: Verify asset and generated markup**

Run:

```bash
./node_modules/.bin/next build --turbopack
if lsof -nP -iTCP:3100 -sTCP:LISTEN; then exit 1; fi
./node_modules/.bin/next start -p 3100
```

In a second terminal run:

```bash
curl -fsS http://127.0.0.1:3100/ | rg 'rel="preload"[^>]+/fonts/typeface.json'
curl -fsSI http://127.0.0.1:3100/fonts/typeface.json | rg -i '^HTTP/|^content-type:'
```

Expected: the page contains one preload for `/fonts/typeface.json`; the asset responds 200 with a JSON content type; the build exits 0.

- [ ] **Step 3: Verify preload reuse and exactly one transferred body**

Open a fresh Chrome tab with DevTools Network open, enable `Disable cache`, clear the Network log, and choose `Empty Cache and Hard Reload` exactly once. Filter Network by `typeface.json`; expected: one request with status 200, not separate preload and Text3D downloads.

Run this once in the DevTools Console after the medallion is visible:

```js
performance
  .getEntriesByName(`${location.origin}/fonts/typeface.json`)
  .map((entry) => ({
    initiatorType: entry.initiatorType,
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
  }));
```

Expected: Resource Timing and Network together show one response body transfer. A reused entry may have `transferSize: 0`, but there must be exactly one Network download with non-zero transferred bytes and no second 200 response for the same URL. If two bodies transfer, the preload credentials do not match Drei's fetch and this task is not complete.

### Task 5: Give Procedural Geometries Explicit Disposal Ownership

**Files:**
- Modify: `components/badges/parts.tsx:3,26-35`
- Modify: `components/badges/BoxedPin.tsx:3,51-81`
- Modify: `components/badges/Packaged.tsx:3,28-60`

**Interfaces:**
- Consumes: every `BufferGeometry` allocated manually inside `useMemo`.
- Produces: one `dispose()` call when each memoized geometry is replaced or its owner unmounts.

- [ ] **Step 1: Dispose shared extruded piece geometry**

Change the React import in `parts.tsx` and replace `useExtruded` with:

```tsx
import { useEffect, useMemo } from "react";

function useExtruded(
  shape: Shape | Shape[],
  depth: number,
  bevel: number,
  curveSegments: number,
) {
  const geometry = useMemo(
    () => extrudeCentered(shape, { depth, bevel, curveSegments }),
    [shape, depth, bevel, curveSegments],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  return geometry;
}
```

- [ ] **Step 2: Dispose the box-owned geometries**

Change the React import in `BoxedPin.tsx` to:

```tsx
import { useEffect, useMemo } from "react";
```

After the `lidGeometry` memo and before `return`, add:

```tsx
  useEffect(
    () => () => {
      wallGeometry.dispose();
      floorGeometry.dispose();
      lidGeometry.dispose();
    },
    [floorGeometry, lidGeometry, wallGeometry],
  );
```

- [ ] **Step 3: Dispose each dense film plane**

Change the React import in `Packaged.tsx` and replace the end of `useBagGeometry` with:

```tsx
import { useEffect, useMemo } from "react";

  const geometry = useMemo(() => {
    const geometry = new PlaneGeometry(BAG_WIDTH, BAG_HEIGHT, 140, 180);
    const position = geometry.attributes.position;

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const fadeX = smoothstep(0, 0.16, BAG_WIDTH / 2 - Math.abs(x));
      const fadeY = smoothstep(0, 0.14, BAG_HEIGHT / 2 - Math.abs(y));
      const fade = fadeX * fadeY;
      const dx = x / 0.62;
      const dy = (y - POUCH_Y) / 0.72;
      const bulge = Math.exp(-(dx * dx + dy * dy)) * (mirror ? 0.1 : 0.34);
      const quilt = 0.007 * Math.sin(x * 17) * Math.sin(y * 17);
      const crinkle =
        0.008 * Math.sin(x * 9.7 + y * 5.3) +
        0.005 * Math.sin(x * 16.1 - y * 12.9 + 1.7) +
        0.0025 * Math.sin(x * 29 + y * 23 + 4.2);

      position.setZ(i, (bulge + quilt + crinkle) * fade);
    }

    geometry.computeVertexNormals();
    return geometry;
  }, [mirror]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return geometry;
```

Do not add manual disposal to `<boxGeometry>`, `<torusGeometry>`, `<cylinderGeometry>` or Drei `<Text3D>`: those are declarative R3F child instances and the reconciler owns their disposal. Do not add a second disposal inside `extrudeCentered`; its temporary source is already disposed at `components/badges/shapes.ts:82-83`.

- [ ] **Step 4: Verify geometry memory settles after repeated switches**

Use the production server lifecycle. Enable `Performance > showDiagnostics`. Cycle `medallion -> hex -> packaged -> boxed` ten times, toggling diagnostics off/on for each sample and waiting for its warmed report so R3F's idle-priority disposal can run.

Expected: after the first warm cycle, each named variant's `geometries` count returns to its prior value instead of increasing each cycle. `gl.info.autoReset` is restored whenever diagnostics is toggled off.

- [ ] **Step 5: Run static and build verification**

Run:

```bash
rg -n 'useEffect\(.*geometry\.dispose|wallGeometry\.dispose|floorGeometry\.dispose|lidGeometry\.dispose' components/badges
./node_modules/.bin/eslint
./node_modules/.bin/next build --turbopack
```

Expected: cleanup ownership appears in `parts.tsx`, `BoxedPin.tsx`, and `Packaged.tsx`; ESLint and build exit 0.

### Task 6: Add Adaptive DPR as an Opt-In A/B Variant

**Files:**
- Modify: `components/Scene.tsx:4,60-65,96-121`

**Interfaces:**
- Consumes: R3F performance regression state triggered by Drei `OrbitControls regress`.
- Produces: Leva `Performance.adaptiveDpr: boolean`, default `false`; when enabled, `<AdaptiveDpr />` lowers DPR during regressed interaction and restores it after debounce.

- [ ] **Step 1: Extend the existing performance control**

Change the Drei import to:

```tsx
import { AdaptiveDpr, OrbitControls } from "@react-three/drei";
```

Replace the Performance control with:

```tsx
  const { adaptiveDpr, showDiagnostics } = useControls("Performance", {
    adaptiveDpr: false,
    showDiagnostics: false,
  });
```

Add explicit R3F regression bounds to Canvas while retaining the initial DPR range and canvas AA setting:

```tsx
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: false }}
        performance={{ min: 0.5, max: 1, debounce: 200 }}
        camera={{ position: [0, 0, 4.4], fov: 45, near: 0.1, far: 100 }}
      >
```

- [ ] **Step 2: Wire regression only when the experiment is enabled**

Add Adaptive DPR before OrbitControls and add its regress prop:

```tsx
        {adaptiveDpr && <AdaptiveDpr />}

        <OrbitControls
          makeDefault
          regress={adaptiveDpr}
          enableDamping
          dampingFactor={0.08}
          enablePan={false}
          minDistance={2.4}
          maxDistance={9}
        />
```

- [ ] **Step 3: Verify the complete off/on/off lifecycle**

Use the production server lifecycle, enable diagnostics, and define these Chrome Console helpers:

```js
const canvas = document.querySelector("canvas");
const canvasDpr = () => canvas.width / canvas.getBoundingClientRect().width;
const listenerCounts = () =>
  Object.fromEntries(
    Object.entries(getEventListeners(canvas)).map(([type, listeners]) => [
      type,
      listeners.length,
    ]),
  );
const initialDpr = Math.min(2, Math.max(1, window.devicePixelRatio));
const listenersBefore = listenerCounts();
```

For each of the four variants, perform this exact sequence three times:

1. Set `adaptiveDpr=false`; toggle diagnostics off/on and orbit until a report appears. Expected median `pixelRatio` and `canvasDpr()` are within 0.05 of `initialDpr`.
2. Set `adaptiveDpr=true`; keep orbiting continuously through the 120 warmup and 300 measured frames. Expected regressed median `pixelRatio` and `canvasDpr()` are within 0.05 of `initialDpr * 0.5`.
3. While the pointer is still orbiting and DPR is reduced, set `adaptiveDpr=false`. On the next rendered frame, `canvasDpr()` must return within 0.05 of `initialDpr`; orbit and zoom must continue working. This verifies AdaptiveDpr unmount cleanup during an active regression, not only after recovery.
4. Set `adaptiveDpr=true` again, orbit for 2 seconds, release controls and wait until damping emits its final visible change. At 100 ms DPR may still be reduced; by 500 ms it must be within 0.05 of `initialDpr`, consistent with `debounce: 200` after the last regression.
5. Set `adaptiveDpr=false` to finish the run. Expected DPR remains within 0.05 of `initialDpr` and controls remain responsive.

Then toggle `adaptiveDpr` `false -> true -> false` five additional times without reloading and run:

```js
({ listenersBefore, listenersAfter: listenerCounts(), dpr: canvasDpr() });
```

Expected: `listenersAfter` equals `listenersBefore`, no control callback fires twice, controls remain responsive, and DPR is restored. Keep the checked-in defaults `adaptiveDpr=false` and `showDiagnostics=false` even if the experiment helps; changing the product default requires separate visual approval at device DPR 1 and 2.

- [ ] **Step 4: Verify implementation and build**

Run:

```bash
rg -n 'adaptiveDpr: false|showDiagnostics: false|adaptiveDpr && <AdaptiveDpr|regress=\{adaptiveDpr\}|dpr=\{\[1, 2\]\}|performance=\{\{ min: 0\.5, max: 1, debounce: 200 \}\}' components/Scene.tsx
if rg -n 'StatsGl|trackGPU' components; then exit 1; fi
./node_modules/.bin/eslint
./node_modules/.bin/next build --turbopack
```

Expected: both controls remain false by default, the fixed initial DPR and explicit regression bounds are present, forbidden instrumentation is absent, and ESLint/build exit 0.

### Task 7: Final Visual and Performance Comparison

**Files:**
- Verify: `components/Scene.tsx`
- Verify: `components/Studio.tsx`
- Verify: `app/layout.tsx`
- Verify: `components/badges/parts.tsx`
- Verify: `components/badges/BoxedPin.tsx`
- Verify: `components/badges/Packaged.tsx`
- Verify unchanged by this batch: `components/badges/Medallion.tsx`
- Verify unchanged by this batch: `components/badges/HexBadge.tsx`
- Verify unchanged by this batch: `components/badges/materials.tsx`

**Interfaces:**
- Consumes: Task 1 baseline captured with identical viewport, device zoom and motion protocol.
- Produces: evidence for accepting this batch without activating visually risky follow-ups.

- [ ] **Step 1: Run all repository-supported checks**

Run:

```bash
git diff --check -- components/Scene.tsx components/Studio.tsx app/layout.tsx components/badges/parts.tsx components/badges/BoxedPin.tsx components/badges/Packaged.tsx docs/superpowers/plans/2026-08-28-3d-performance-optimizations.md
./node_modules/.bin/eslint
./node_modules/.bin/next build --turbopack
git status --short --branch
git diff --name-only
```

Expected: diff check, lint, type validation and production build exit 0. Review status without assuming it contains only this batch: preserve every concurrent path and never clean, restore, stage or discard it. The intended batch paths are `Scene.tsx`, `Studio.tsx`, `layout.tsx`, `parts.tsx`, `BoxedPin.tsx`, `Packaged.tsx` and this plan; `pnpm-workspace.yaml` and the lockfile are not modified by this batch.

- [ ] **Step 2: Compare the optimized default to Task 1 baseline**

Use the production server lifecycle and the exact Task 1 order with `adaptiveDpr=false`: `medallion`, `hex`, `packaged`, `boxed`. Perform three independent diagnostic mounts per variant after a full reload of the post-AA build. Compare the median of those three report medians to the baseline captured before Task 2.

Accept the batch only if every variant stays within the explicit 5% tolerance for `frameIntervalMs` and `cpuSubmitMs`, calls/triangles do not increase, geometry counts settle after cycling, shader programs stay stable across clearcoat zero, and the default render has no visible aliasing, missing highlights, changed composition or changed material appearance. If the browser lacks a trustworthy GPU track, write `GPU timing unavailable`; renderer.info and CPU submission are not substitutes for GPU duration.

- [ ] **Step 3: Check responsive rendering**

In Chrome DevTools, verify at `390x844` and `1440x900` with device scale factor 1 and 2. For every badge variant, orbit, zoom to min/max distance and change each existing Leva material control. Expected: canvas fills the viewport, controls remain usable, the medallion font appears after the same preloaded request, and no WebGL warning or uncaught error appears.

- [ ] **Step 4: Review the final diff without committing**

Run:

```bash
git diff -- components/Scene.tsx components/Studio.tsx app/layout.tsx components/badges/parts.tsx components/badges/BoxedPin.tsx components/badges/Packaged.tsx
git diff -- components/badges/Medallion.tsx components/badges/HexBadge.tsx components/badges/materials.tsx
git diff --check -- components/Scene.tsx components/Studio.tsx app/layout.tsx components/badges/parts.tsx components/badges/BoxedPin.tsx components/badges/Packaged.tsx docs/superpowers/plans/2026-08-28-3d-performance-optimizations.md
git status --short --branch
```

Expected: the first diff contains only this batch's planned edits; the second is empty unless it contains pre-existing or concurrent user work, which must remain untouched and be reported separately. No transmission/tessellation/glyph/context change is introduced by this batch, whitespace validation passes, all status entries are preserved, and everything remains uncommitted.

## Profile-Gated Follow-Ups Outside This Batch

- Transmission: only prototype an off/on material variant if a trustworthy browser GPU trace shows `packaged` or `hex` remains GPU-bound above 16.7 ms per frame at DPR 2 after Tasks 2-6. Review candy depth and film readability side-by-side before accepting any reduction.
- Film tessellation: only compare the current `140 x 180` plane against a lower grid if a trustworthy browser GPU trace shows `packaged` dominates triangle cost and remains above 16.7 ms GPU time. Reject the reduction if silhouette, crinkles or specular motion visibly change.
- Extrude tessellation: only lower default `curveSegments=96` after per-variant triangle counts identify extrusions as the limiting GPU cost; inspect circular rims at maximum OrbitControls zoom before acceptance.
- Glyph merging: only investigate merged text geometry if the medallion is CPU/draw-call bound while GPU frame time is within budget. Preserve per-character arc placement and bevels in the comparison.
- Context splitting: only separate material controls from scene controls if React Profiler demonstrates unrelated subtree commits during Leva edits. The current context is small and must not be split speculatively.

## Plan Self-Review

- Spec coverage: the first batch covers duplicate canvas/composer AA, dead shadows, font preload, procedural geometry disposal, clearcoat shader stability, gated diagnostics, Leva preservation and Adaptive DPR evaluation.
- Scope: transmission, film/extrude tessellation, glyph merging and context splitting are explicitly excluded and each has a concrete profiling gate.
- Ownership: manually memoized geometries receive cleanup; R3F-owned declarative geometries are deliberately not double-disposed; the intermediate extrusion cleanup remains single-owner.
- Visual consistency: composer MSAA stays at 8, DPR stays `[1, 2]`, clearcoat UI stays `[0, 1]`, and Adaptive DPR stays off by default.
- Diagnostics consistency: no StatsGl, style injection or persistent listener exists; renderer counters span all composer passes and `autoReset` is restored on unmount.
- Measurement consistency: AA requires rebuild/restart/full reload; each result is the median of three runs with a 5% regression tolerance and explicit GPU-unavailable fallback.
- Protected scope: `Medallion.tsx`, transmission, tessellation, glyph structure, material context and `pnpm-workspace.yaml` are not modified by this batch.
- Command consistency: because pnpm's preexisting config blocks script dispatch, every verification invokes the exact binary/arguments defined by `package.json` rather than claiming `pnpm lint` or `pnpm build` succeeds.
- Marker scan: every task names exact files, commands, expected results and complete implementation bodies.
- Commit consistency: no task includes a commit, matching the explicit no-commit constraint.
