import type { Metadata } from "next";
import Link from "next/link";
import { BotonSalir } from "@/components/BotonSalir";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { formatearDia } from "@/lib/fechas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { FormularioLlave } from "./FormularioLlave";
import estilos from "./monitor.module.css";

export const metadata: Metadata = { title: "Panel del monitor · Calibra" };

export default async function PanelMonitor() {
  const sesion = await exigirRol("monitor", "/monitor");
  const supabase = await crearClienteServidor();
  const [{ data: monitor }, { data: privado }, { data: certificados, error: errorCertificados }] = await Promise.all([
    supabase!.from("monitor").select("nombre").eq("id", sesion.idUsuario).maybeSingle(),
    supabase!.from("monitor_privado").select("llave").eq("id_monitor", sesion.idUsuario).maybeSingle(),
    // HU-014: sus materias certificadas, con la fecha del certificado.
    supabase!
      .from("certificado")
      .select("id, fecha_emision, materia(nombre, codigo)")
      .eq("id_monitor", sesion.idUsuario)
      .order("fecha_emision", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (errorCertificados) console.error("[monitor] no se pudieron leer los certificados:", errorCertificados.message);
  // Si la lectura falló no se sabe si tiene certificados: ni la lista ni "aún no tienes".
  const conCertificados = !errorCertificados && Boolean(certificados?.length);
  const sinCertificados = !errorCertificados && !certificados?.length;

  return (
    <Pantalla
      eyebrow="Panel del monitor"
      titulo={monitor ? `Hola, ${monitor.nombre}` : "Hola"}
      subtitulo={
        sinCertificados
          ? "Tu cuenta está lista. Espera a que un admin te certifique en tu materia: cuando lo haga, podrás abrir tus franjas y recibir estudiantes."
          : "Abre tus franjas para que te agenden. Pronto verás aquí tu agenda y el diagnóstico de cada estudiante."
      }
    >
      {errorCertificados && (
        <p role="alert" className={formulario.error}>
          No pudimos cargar tus materias certificadas. Recarga la página; si sigue igual, avisa al equipo.
        </p>
      )}
      {sinCertificados && (
        <p role="status" className={formulario.ayuda}>
          Aún no tienes materias certificadas.
        </p>
      )}
      {conCertificados && (
        <section aria-labelledby="materias-certificadas" className={estilos.seccion}>
          <h2 id="materias-certificadas" className={estilos.titulo}>
            Tus materias certificadas
          </h2>
          <ul className={estilos.lista}>
            {certificados!.map((c) => (
              <li key={c.id}>
                {c.materia ? `${c.materia.nombre} (${c.materia.codigo})` : "Materia"}
                <span className={estilos.meta}> · desde el {formatearDia(c.fecha_emision)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {conCertificados && (
        <Link href="/monitor/franjas" className={formulario.enlace}>
          Mis franjas
        </Link>
      )}
      {privado && <FormularioLlave llave={privado.llave} />}
      <BotonSalir />
    </Pantalla>
  );
}
