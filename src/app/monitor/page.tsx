import type { Metadata } from "next";
import { BotonSalir } from "@/components/BotonSalir";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { FormularioLlave } from "./FormularioLlave";

export const metadata: Metadata = { title: "Panel del monitor · Calibra" };

export default async function PanelMonitor() {
  const sesion = await exigirRol("monitor", "/monitor");
  const supabase = await crearClienteServidor();
  const [{ data: monitor }, { data: privado }, { count: certificados }] = await Promise.all([
    supabase!.from("monitor").select("nombre").eq("id", sesion.idUsuario).maybeSingle(),
    supabase!.from("monitor_privado").select("llave").eq("id_monitor", sesion.idUsuario).maybeSingle(),
    supabase!.from("certificado").select("id", { count: "exact", head: true }).eq("id_monitor", sesion.idUsuario),
  ]);
  const sinCertificados = !certificados;

  return (
    <Pantalla
      eyebrow="Panel del monitor"
      titulo={monitor ? `Hola, ${monitor.nombre}` : "Hola"}
      subtitulo={
        sinCertificados
          ? "Tu cuenta está lista. Espera a que un admin te certifique en tu materia: cuando lo haga, podrás abrir tus franjas y recibir estudiantes."
          : "Aquí verás tu agenda, tus franjas y el diagnóstico de cada estudiante. Estamos terminando de construirlo."
      }
    >
      {sinCertificados && (
        <p role="status" className={formulario.ayuda}>
          Aún no tienes materias certificadas.
        </p>
      )}
      {privado && <FormularioLlave llave={privado.llave} />}
      <BotonSalir />
    </Pantalla>
  );
}
