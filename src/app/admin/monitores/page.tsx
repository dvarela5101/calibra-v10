import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { FormularioInvitar } from "./FormularioInvitar";

export const metadata: Metadata = { title: "Invitar a un monitor · Calibra" };

/** HU-013 (P-20): el admin invita al aspirante después de su evaluación presencial. */
export default async function InvitarMonitor() {
  await exigirRol("admin", "/admin/monitores");

  return (
    <Pantalla
      eyebrow="Administración"
      titulo="Invitar a un monitor"
      subtitulo="Después de la evaluación presencial, escribe el correo del aspirante. Le llega un enlace para crear su cuenta, que sirve una sola vez y vence en 7 días."
    >
      <FormularioInvitar />
      <Link href="/admin" className={formulario.enlace}>
        Volver a mi bandeja
      </Link>
    </Pantalla>
  );
}
