import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { diaDelNegocio, formatearDia } from "@/lib/fechas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import estilos from "./certificados.module.css";
import { FormularioCertificar, type Opcion } from "./FormularioCertificar";

export const metadata: Metadata = { title: "Certificar monitores · Calibra" };

type CertificadoEmitido = { id: string; materia: string; emision: string; evaluacion: string; admin: string };

/** HU-014 (P-19, RN-21): el admin certifica monitores por materia y ve los certificados emitidos. */
export default async function CertificarMonitores() {
  await exigirRol("admin", "/admin/certificados");
  const supabase = await crearClienteServidor();

  const [monitoresLeidos, privadosLeidos, materiasLeidas, certificadosLeidos] = await Promise.all([
    supabase!.from("monitor").select("id, nombre").order("nombre", { ascending: true }).order("id", { ascending: true }),
    supabase!.from("monitor_privado").select("id_monitor, correo"),
    supabase!.from("materia").select("id, nombre, codigo").order("nombre", { ascending: true }),
    supabase!
      .from("certificado")
      .select("id, id_monitor, fecha_emision, fecha_evaluacion, materia(nombre, codigo), admin(nombre)")
      .order("fecha_emision", { ascending: false })
      .order("id", { ascending: true }),
  ]);
  const fallo = monitoresLeidos.error ?? privadosLeidos.error ?? materiasLeidas.error ?? certificadosLeidos.error;
  if (fallo) {
    console.error("[admin] no se pudieron leer los monitores y sus certificados:", fallo.message);
    return (
      <Pantalla eyebrow="Administración" titulo="Certificar monitores">
        <p role="alert" className={formulario.error}>
          No pudimos cargar los monitores y sus certificados. Recarga la página; si sigue igual, avisa al equipo.
        </p>
        <Link href="/admin" className={formulario.enlace}>
          Volver a mi bandeja
        </Link>
      </Pantalla>
    );
  }

  const correos = new Map((privadosLeidos.data ?? []).map((p) => [p.id_monitor, p.correo]));
  const monitores = monitoresLeidos.data ?? [];
  const opcionesDeMonitor: Opcion[] = monitores.map((m) => ({
    id: m.id,
    texto: correos.has(m.id) ? `${m.nombre} · ${correos.get(m.id)}` : m.nombre,
  }));
  const opcionesDeMateria: Opcion[] = (materiasLeidas.data ?? []).map((m) => ({ id: m.id, texto: `${m.nombre} (${m.codigo})` }));

  const porMonitor = new Map<string, CertificadoEmitido[]>();
  for (const c of certificadosLeidos.data ?? []) {
    const lista = porMonitor.get(c.id_monitor) ?? [];
    lista.push({
      id: c.id,
      materia: c.materia ? `${c.materia.nombre} (${c.materia.codigo})` : "Materia",
      emision: c.fecha_emision,
      evaluacion: c.fecha_evaluacion,
      admin: c.admin?.nombre ?? "un admin",
    });
    porMonitor.set(c.id_monitor, lista);
  }
  const certificados = monitores.filter((m) => porMonitor.has(m.id));
  const total = (certificadosLeidos.data ?? []).length;

  return (
    <Pantalla
      eyebrow="Administración"
      titulo="Certificar monitores"
      subtitulo="Después de la evaluación presencial, certifica al monitor en cada materia que aprobó. El certificado no vence y el monitor solo da monitorías de lo que tiene certificado."
    >
      {monitores.length === 0 ? (
        <p role="status" className={formulario.ayuda}>
          Todavía no hay monitores con cuenta. Invita al aspirante después de su evaluación y certifícalo cuando la cree.
        </p>
      ) : opcionesDeMateria.length === 0 ? (
        <p role="status" className={formulario.ayuda}>
          Todavía no hay materias cargadas en Calibra, así que no se puede certificar.
        </p>
      ) : (
        <FormularioCertificar monitores={opcionesDeMonitor} materias={opcionesDeMateria} hoy={diaDelNegocio(new Date())} />
      )}

      <section aria-labelledby="emitidos" className={estilos.seccion}>
        <h2 id="emitidos" className={estilos.titulo}>
          Certificados emitidos ({total})
        </h2>
        {certificados.length === 0 ? (
          <p className={formulario.ayuda}>Todavía no hay monitores certificados.</p>
        ) : (
          <ul className={estilos.lista}>
            {certificados.map((m) => (
              <li key={m.id} className={estilos.fila}>
                <span className={estilos.nombre}>{m.nombre}</span>
                {correos.has(m.id) && <span className={estilos.meta}>{correos.get(m.id)}</span>}
                <ul className={estilos.materias}>
                  {porMonitor.get(m.id)!.map((c) => (
                    <li key={c.id} className={estilos.meta}>
                      {c.materia}: evaluación del {formatearDia(c.evaluacion)}, certificado el {formatearDia(c.emision)} por {c.admin}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/admin/monitores" className={formulario.enlace}>
        Invitar a un monitor
      </Link>
      <Link href="/admin" className={formulario.enlace}>
        Volver a mi bandeja
      </Link>
    </Pantalla>
  );
}
