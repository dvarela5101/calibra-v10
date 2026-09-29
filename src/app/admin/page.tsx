import type { Metadata } from "next";
import { BotonSalir } from "@/components/BotonSalir";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Administración · Calibra" };

export default async function PanelAdmin() {
  const sesion = await exigirRol("admin", "/admin");
  const supabase = await crearClienteServidor();
  const { data: admin } = await supabase!.from("admin").select("nombre").eq("id", sesion.idUsuario).maybeSingle();

  return (
    <Pantalla
      eyebrow="Administración"
      titulo={admin ? `Hola, ${admin.nombre}` : "Hola"}
      subtitulo="Aquí verás tu bandeja de pagos, reembolsos, reportes y desembolsos. Estamos terminando de construirla."
    >
      <BotonSalir />
    </Pantalla>
  );
}
