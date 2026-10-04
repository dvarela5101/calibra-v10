import type { Metadata } from "next";
import Link from "next/link";
import { BotonSalir } from "@/components/BotonSalir";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { cargarBandeja, type Bandeja } from "@/lib/admin/bandeja";
import { exigirRol } from "@/lib/auth/sesion";
import { avisoDeReabrir } from "@/lib/reembolsos/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { BandejaAdmin } from "./BandejaAdmin";
import estilos from "./bandeja.module.css";

export const metadata: Metadata = { title: "Administración · Calibra" };

export default async function PanelAdmin({ searchParams }: PageProps<"/admin">) {
  const sesion = await exigirRol("admin", "/admin");
  // HU-025: lo que pasó al reabrir un caso cerrado sin llave (`?reembolso=`, lo deja la acción).
  const aviso = avisoDeReabrir(await searchParams);
  const supabase = await crearClienteServidor();
  const { data: admin } = await supabase!.from("admin").select("nombre").eq("id", sesion.idUsuario).maybeSingle();

  // La bandeja siempre se pide con el id de la sesión: las políticas dejan leer a todo admin, y nunca
  // debe llegar un id desde el navegador (HU-012: lo asignado a otros admins queda fuera de alcance).
  let bandeja: Bandeja | null = null;
  try {
    bandeja = await cargarBandeja(supabase!, sesion.idUsuario, new Date());
  } catch (error) {
    console.error("[admin] no se pudo cargar la bandeja:", error);
  }

  return (
    <Pantalla
      eyebrow="Administración"
      titulo={admin ? `Hola, ${admin.nombre}` : "Hola"}
      subtitulo="Esto es lo que tienes asignado."
    >
      {aviso && (
        <p role={aviso.exito ? "status" : "alert"} className={aviso.exito ? formulario.exito : formulario.error}>
          {aviso.texto}
        </p>
      )}
      {bandeja ? (
        <BandejaAdmin bandeja={bandeja} />
      ) : (
        <p role="alert" className={estilos.error}>
          No pudimos cargar tu bandeja. Recarga la página; si sigue igual, avisa al equipo.
        </p>
      )}
      <Link href="/admin/monitores" className={formulario.enlace}>
        Invitar a un monitor
      </Link>
      <Link href="/admin/certificados" className={formulario.enlace}>
        Certificar monitores
      </Link>
      <Link href="/admin/solicitudes" className={formulario.enlace}>
        Solicitudes para ser monitor
      </Link>
      <Link href="/admin/equipo" className={formulario.enlace}>
        Equipo de admins
      </Link>
      <BotonSalir />
    </Pantalla>
  );
}
