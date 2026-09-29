import type { ReactNode } from "react";
import { SesionAnonima } from "@/components/SesionAnonima";

/** Páginas del visitante: aquí nace la sesión anónima. Las de cuentas y paneles no la crean. */
export default function LayoutPublico({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SesionAnonima />
    </>
  );
}
