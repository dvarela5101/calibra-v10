import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Pantalla } from "@/components/Pantalla";
import { obtenerSesion } from "@/lib/auth/sesion";
import { rutaSiguiente } from "@/lib/leads/reglas";
import { leadDeLaSesion } from "@/lib/leads/servidor";
import { FormularioContacto } from "./FormularioContacto";

export const metadata: Metadata = { title: "Tus datos para agendar · Calibra" };

/**
 * HU-068 (D-3): antes de reservar, el visitante que todavía no es Lead deja su contacto. El diagnóstico es
 * opcional. Quien ya es Lead sigue de largo (criterio 4); con `?editar=1` puede cambiar sus datos.
 */
export default async function ContactoParaAgendar({ searchParams }: PageProps<"/agendar/contacto">) {
  const { siguiente: pedido, editar } = await searchParams;
  const siguiente = rutaSiguiente(pedido);

  const sesion = await obtenerSesion();
  const lead = sesion ? await leadDeLaSesion(sesion.idUsuario) : null;
  if (lead && editar !== "1") redirect(siguiente);

  return (
    <Pantalla
      eyebrow="Agendar"
      titulo={lead ? "Cambia tus datos" : "Tus datos para agendar"}
      subtitulo="Con ellos te confirmamos la cita. No necesitas haber hecho el diagnóstico: si ya sabes qué necesitas, agenda directo."
    >
      <FormularioContacto
        siguiente={siguiente}
        iniciales={{ nombre: lead?.nombre ?? "", correo: lead?.correo ?? "", numero_telefono: lead?.numeroTelefono ?? "" }}
      />
    </Pantalla>
  );
}
