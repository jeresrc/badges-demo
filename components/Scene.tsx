"use client";

import { Suspense, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Leva, useControls } from "leva";
import type { Mesh } from "three";

function PlaceholderBadge({ rotationSpeed }: { rotationSpeed: number }) {
  const mesh = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (mesh.current) {
      mesh.current.rotation.y += delta * rotationSpeed;
    }
  });

  return (
    <mesh ref={mesh} rotation={[Math.PI / 5, 0, 0]}>
      <torusGeometry args={[1.2, 0.38, 64, 128]} />
      <meshStandardMaterial
        color="#d51f45"
        metalness={0.35}
        roughness={0.2}
      />
    </mesh>
  );
}

export default function Scene() {
  const { rotationSpeed } = useControls({
    rotationSpeed: { value: 0.35, min: 0, max: 2, step: 0.05 },
  });

  return (
    <main style={{ width: "100vw", height: "100vh", background: "#000" }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        <color attach="background" args={["#000"]} />
        <ambientLight intensity={0.45} />
        <spotLight position={[4, 5, 5]} intensity={80} angle={0.35} />
        <spotLight
          position={[-4, -1, 3]}
          intensity={45}
          angle={0.45}
          color="#8db6ff"
        />
        <Suspense fallback={null}>
          <PlaceholderBadge rotationSpeed={rotationSpeed} />
        </Suspense>
        <OrbitControls enableDamping />
      </Canvas>
      <Leva collapsed={false} />
    </main>
  );
}
