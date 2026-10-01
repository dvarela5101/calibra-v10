import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { formatearFechaHora } from "@/lib/fechas";
import { listarSolicitudes, paginaDeLaPrimeraAbierta, type PaginaDeSolicitudes } from "@/lib/solicitudes/admin";
import { leerPagina } from "@/lib/solicitudes/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { TarjetaDeSolicitud } from "./TarjetaDeSolicitud";
import estilos from "./solicitudes.module.css";

export const metadata: Metadata = { title: "Solicitudes para ser monitor · Calibra" };

const RUTA = "/admin/solicitudes";
// Siempre con el número: al marcar una solicitud la página se vuelve a pintar con la misma dirección, y sin
// número podría abrir en otra (la de la abierta más antigua cambia cuando se cierra esa).
const rutaDePagina = (pagina: number) => `${RUTA}?pagina=${pagina}`;

async function cargar(pagina: number): Promise<PaginaDeSolicitudes | null> {
  const supabase = await crearClienteServidor();
  if (!supabase) return null;
  try {
    return await listarSolicitudes(supabase, { pagina });
  } catch (error) {
    console.error("[admin] no se pudieron leer las solicitudes:", error instanceof Error ? error.message : error);
    return null;
  }
}

async function paginaDeInicio(): Promise<number> {
  const supabase = await crearClienteServidor();
  if (!supabase) return 1;
  try {
    return await paginaDeLaPrimeraAbierta(supabase);
  } catch (error) {
    console.error("[admin] no se pudo ubicar la primera solicitud abierta:", error instanceof Error ? error.message : error);
    return 1;
  }
}

/**
 * HU-062 (P-19): las solicitudes de quienes quieren ser monitor, de la más antigua a la más nueva y por
 * páginas. Sin `?pagina=` abre en la de la solicitud abierta más antigua, para que lo pendiente quede a la
 * vista. El admin contacta a cada persona, hace la evaluación presencial y la marca. Si la aprueba, la
 * invita (HU-013) y la certifica (HU-014) desde sus propias pantallas.
 */
export default async function Solicitudes({ searchParams }: PageProps<"/admin/solicitudes">) {
  await exigirRol("admin", RUTA);
  const { pagina: pedida } = await searchParams;
  if (pedida === undefined) redirect(rutaDePagina(await paginaDeInicio()));
  const resultado = await cargar(leerPagina(pedida));

  return (
    <Pantalla
      eyebrow="Administración"
      titulo="Solicitudes para ser monitor"
      subtitulo="Contacta a cada persona para agendar su evaluación presencial. Van de la más antigua a la más nueva, y la lista abre en la primera que sigue abierta."
    >
      {resultado === null ? (
        <p role="alert" className={estilos.error}>
          No pudimos cargar las solicitudes. Recarga la página; si sigue igual, avisa al equipo.
        </p>
      ) : resultado.total === 0 ? (
        <p className={estilos.vacio}>Todavía no hay solicitudes.</p>
      ) : resultado.solicitudes.length === 0 ? (
        <p className={estilos.vacio}>
          Esta página no tiene solicitudes.{" "}
          <Link href={RUTA} className={estilos.enlace}>
            Ir a la primera que sigue abierta
          </Link>
        </p>
      ) : (
        <ListaDeSolicitudes resultado={resultado} />
      )}
      <Link href="/admin/monitores" className={formulario.enlace}>
        Invitar a un monitor
      </Link>
      <Link href="/admin" className={formulario.enlace}>
        Volver a mi bandeja
      </Link>
    </Pantalla>
  );
}

function ListaDeSolicitudes({ resultado: { solicitudes, total, abiertas, pagina, porPagina } }: { resultado: PaginaDeSolicitudes }) {
  const desde = (pagina - 1) * porPagina + 1;
  const hasta = desde + solicitudes.length - 1;
  const hayAnterior = pagina > 1;
  const haySiguiente = hasta < total;

  return (
    <>
      <p className={estilos.dato}>
        {total === 1 ? "1 solicitud" : `Solicitudes ${desde} a ${hasta} de ${total}`}.{" "}
        {abiertas === 1 ? "1 sigue abierta." : `${abiertas} siguen abiertas.`}
      </p>
      <ol className={estilos.lista} start={desde}>
        {solicitudes.map((s) => (
          <li key={s.id} className={estilos.solicitud}>
            <TarjetaDeSolicitud
              solicitud={{
                id: s.id,
                nombre: s.nombre,
                correo: s.correo,
                numeroTelefono: s.numeroTelefono,
                estado: s.estado,
                enviada: formatearFechaHora(s.creadaEn),
                materias: s.materias,
              }}
            />
          </li>
        ))}
      </ol>
      {(hayAnterior || haySiguiente) && (
        <nav aria-label="Páginas de solicitudes" className={estilos.paginas}>
          {hayAnterior && (
            <Link href={rutaDePagina(pagina - 1)} className={estilos.enlace}>
              Más antiguas
            </Link>
          )}
          {haySiguiente && (
            <Link href={rutaDePagina(pagina + 1)} className={estilos.enlace}>
              Más nuevas
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
