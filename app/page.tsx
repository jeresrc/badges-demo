import { Suspense } from "react";
import Scene from "@/components/Scene";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Scene />
    </Suspense>
  );
}
