import type { Metadata } from "next";
import type { ReactNode } from "react";

// HU-135: nada de este segmento debe quedar en buscadores. Las páginas que declaran su propio `robots` lo reemplazan por uno igual o más estricto.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function LayoutCuentas({ children }: { children: ReactNode }) {
  return children;
}
