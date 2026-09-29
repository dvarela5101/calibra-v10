import type { Metadata } from "next";
import { BotonSalir } from "@/components/BotonSalir";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Panel del monitor · Calibra" };

export default async function PanelMonitor() {
  const sesion = await exigirRol("monitor", "/monitor");
  const supabase = await crearClienteServidor();
  const { data: monitor } = await supabase!.from("monitor").select("nombre").eq("id", sesion.idUsuario).maybeSingle();

  return (
    <Pantalla
      eyebrow="Panel del monitor"
      titulo={monitor ? `Hola, ${monitor.nombre}` : "Hola"}
      subtitulo="Aquí verás tu agenda, tus franjas y el diagnóstico de cada estudiante. Estamos terminando de construirlo."
    >
      <BotonSalir />
    </Pantalla>
  );
}
