# Badges Demo — Design

Demo repo: Next.js 15 + react-three-fiber showcase of 3D enamel pins/badges on a pure black background.

Phase 1 scope: 4 generic procedural pin variants (no IP references, simple shapes: circle, hexagon, shield, oval), focused on high-quality materials — glossy enamel with clearcoat, polished gold/chrome/silver metal rims, product-photography studio lighting, subtle bloom. Leva panel: badge selector + fine material controls (metalness, roughness, clearcoat, envMapIntensity, bloom intensity, rotation speed).

Deferred (phase 2): dissolve/noise transition shader between badges, fancy switch animations.

Stack: pnpm, Next.js App Router, TypeScript, three, @react-three/fiber, @react-three/drei, @react-three/postprocessing, leva.

Structure: app/{layout,page}.tsx, components/Scene.tsx, components/badges/*.tsx, later lib/ for shaders.
