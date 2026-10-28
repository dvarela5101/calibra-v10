"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Evento, PropiedadesDeEvento } from "@/lib/analitica/eventos";

type Props = {
  href: string;
  evento: Evento;
  propiedades?: PropiedadesDeEvento;
  className?: string;
  children: ReactNode;
};

/**
 * HU-108 (D-77 g): un enlace que registra su evento en Vercel Web Analytics al tocarlo. Sin el script de Vercel (local,
 * pruebas) `track` no hace nada; la navegación nunca espera al evento.
 */
export function EnlaceConEvento({ href, evento, propiedades, className, children }: Props) {
  return (
    <Link href={href} className={className} onClick={() => track(evento, propiedades)} data-evento={evento}>
      {children}
    </Link>
  );
}
