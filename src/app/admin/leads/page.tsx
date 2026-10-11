import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { exigirRol } from "@/lib/auth/sesion";
import { formatearFechaHora } from "@/lib/fechas";
import {
  contarParaContactar,
  listarLeads,
  listarMaterias,
  listarOrigenes,
  type MateriaDeFiltro,
  type PaginaDeLeads,
} from "@/lib/leads/admin";
import { ESTADOS_DE_LEAD, ETIQUETA_DE_ESTADO } from "@/lib/leads/estados";
import { direccionDeDescarga, direccionDeLeads, leerFiltrosDeLeads, SIN_ORIGEN, type FiltrosDeLeads } from "@/lib/leads/filtros";
import { resumenDeError } from "@/lib/leads/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { TarjetaDeLead } from "./TarjetaDeLead";
import estilos from "./leads.module.css";

export const metadata: Metadata = { title: "Leads · Calibra" };

const RUTA = "/admin/leads";

type Carga = {
  filtros: FiltrosDeLeads;
  materias: MateriaDeFiltro[];
  origenes: string[];
  pagina: PaginaDeLeads;
  paraContactar: number;
};

async function cargar(parametros: Record<string, string | string[] | undefined>): Promise<Carga | { filtros: FiltrosDeLeads; error: true }> {
  const supabase = await crearClienteServidor();
  const sinMaterias = leerFiltrosDeLeads(parametros, []);
  if (!supabase) return { filtros: sinMaterias, error: true };
  try {
    const [materias, origenes] = await Promise.all([listarMaterias(supabase), listarOrigenes(supabase)]);
    const filtros = leerFiltrosDeLeads(parametros, materias.map((m) => m.codigo));
    const idMateria = materias.find((m) => m.codigo === filtros.materia)?.id ?? null;
    const resueltos = { estado: filtros.estado, origen: filtros.origen, idMateria };
    const [pagina, paraContactar] = await Promise.all([
      listarLeads(supabase, { filtros: { ...resueltos, contacto: filtros.contacto }, pagina: filtros.pagina, materias }),
      contarParaContactar(supabase, resueltos),
    ]);
    return { filtros, materias, origenes, pagina, paraContactar };
  } catch (error) {
    // Solo el código y el mensaje: nunca nombres, correos ni teléfonos.
    console.error("[admin] no se pudieron leer los leads:", resumenDeError(error));
    return { filtros: sinMaterias, error: true };
  }
}

/**
 * HU-053 (D-61): los Leads que dejaron su contacto, del más nuevo al más antiguo, por páginas de 50. El admin los
 * filtra por estado, origen, materia y si aceptaron contacto (por defecto, solo los que sí), marca cada uno como
 * contactado o descartado y descarga en CSV los que puede contactar.
 */
export default async function Leads({ searchParams }: PageProps<"/admin/leads">) {
  await exigirRol("admin", RUTA);
  const resultado = await cargar(await searchParams);

  return (
    <Pantalla
      eyebrow="Administración"
      titulo="Leads"
      subtitulo="Personas que dejaron su contacto al hacer un diagnóstico o al agendar. Van de la más nueva a la más antigua."
    >
      {"error" in resultado ? (
        <p role="alert" className={estilos.error}>
          No pudimos cargar los leads. Recarga la página; si sigue igual, avisa al equipo.
        </p>
      ) : resultado.pagina.totalSinFiltros === 0 ? (
        <p className={estilos.vacio}>Todavía no hay leads. Aparece uno cuando alguien deja su contacto para agendar.</p>
      ) : (
        <>
          <Filtros filtros={resultado.filtros} materias={resultado.materias} origenes={resultado.origenes} />
          <Descarga filtros={resultado.filtros} cantidad={resultado.paraContactar} />
          <ListaDeLeads carga={resultado} />
        </>
      )}
      <Link href="/admin" className={formulario.enlace}>
        Volver a mi bandeja
      </Link>
    </Pantalla>
  );
}

/** Un formulario GET: los filtros quedan en la dirección y vuelven a la página 1. Sirve sin JavaScript. */
function Filtros({ filtros, materias, origenes }: { filtros: FiltrosDeLeads; materias: MateriaDeFiltro[]; origenes: string[] }) {
  return (
    <form method="get" action={RUTA} className={estilos.filtros} aria-label="Filtrar leads">
      <div className={formulario.campo}>
        <label htmlFor="estado" className={formulario.etiqueta}>
          Estado
        </label>
        <select id="estado" name="estado" defaultValue={filtros.estado ?? ""} className={formulario.entrada}>
          <option value="">Todos</option>
          {ESTADOS_DE_LEAD.map((estado) => (
            <option key={estado} value={estado}>
              {ETIQUETA_DE_ESTADO[estado]}
            </option>
          ))}
        </select>
      </div>
      <div className={formulario.campo}>
        <label htmlFor="origen" className={formulario.etiqueta}>
          Origen
        </label>
        <select id="origen" name="origen" defaultValue={filtros.origen ?? ""} className={formulario.entrada}>
          <option value="">Todos</option>
          <option value={SIN_ORIGEN}>Sin origen</option>
          {origenes.map((origen) => (
            <option key={origen} value={origen}>
              {origen}
            </option>
          ))}
        </select>
      </div>
      <div className={formulario.campo}>
        <label htmlFor="materia" className={formulario.etiqueta}>
          Materia
        </label>
        <select id="materia" name="materia" defaultValue={filtros.materia ?? ""} className={formulario.entrada}>
          <option value="">Todas</option>
          {materias.map((m) => (
            <option key={m.id} value={m.codigo}>
              {m.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className={formulario.campo}>
        <label htmlFor="contacto" className={formulario.etiqueta}>
          Acepta contacto
        </label>
        <select id="contacto" name="contacto" defaultValue={filtros.contacto} className={formulario.entrada}>
          <option value="si">Sí</option>
          <option value="no">No</option>
          <option value="todos">Todos</option>
        </select>
      </div>
      <div className={estilos.botonesFiltro}>
        <button type="submit" className={formulario.botonSecundario}>
          Filtrar
        </button>
        <Link href={RUTA} className={estilos.enlace}>
          Quitar los filtros
        </Link>
      </div>
      {filtros.contacto === "si" && (
        <p className={estilos.dato}>
          Muestra solo a quienes marcaron «Quiero que Calibra me escriba con novedades y ofertas». Para ver a los
          demás, cambia «Acepta contacto».
        </p>
      )}
    </form>
  );
}

/**
 * «Descargar para contactar» (D-61 c): con los filtros de estado, origen y materia, solo los que aceptaron contacto
 * y no están descartados. Sin ninguno, el botón no lleva a nada y lo dice.
 */
function Descarga({ filtros, cantidad }: { filtros: FiltrosDeLeads; cantidad: number }) {
  const texto = `Descargar para contactar (${cantidad})`;
  return (
    <section className={estilos.descarga} aria-labelledby="titulo-descarga">
      <h2 id="titulo-descarga" className={estilos.tituloDescarga}>
        Descargar para contactar
      </h2>
      <p className={estilos.dato}>
        Solo entran quienes aceptaron que los contactemos y no están descartados, con los filtros de estado, origen y
        materia de arriba. El filtro «Acepta contacto» no cambia el archivo.
      </p>
      <p className={estilos.dato}>El archivo trae datos personales. Guárdalo en un lugar seguro y bórralo cuando termines.</p>
      {cantidad > 0 ? (
        <a href={direccionDeDescarga(filtros)} download className={formulario.botonSecundario}>
          {texto}
        </a>
      ) : (
        // Sin enlace: no se puede pulsar ni baja nada. Se ve como el botón, apagado.
        <span className={`${formulario.botonSecundario} ${estilos.sinDescarga}`} aria-disabled="true">
          {texto}
        </span>
      )}
    </section>
  );
}

function ListaDeLeads({ carga: { filtros, pagina: p } }: { carga: Carga }) {
  if (p.total === 0) {
    return (
      <p className={estilos.vacio}>
        Ningún lead cumple estos filtros.{" "}
        <Link href={RUTA} className={estilos.enlace}>
          Quitar los filtros
        </Link>
      </p>
    );
  }
  if (p.leads.length === 0) {
    return (
      <p className={estilos.vacio}>
        Esta página no tiene leads.{" "}
        <Link href={direccionDeLeads({ ...filtros, pagina: 1 })} className={estilos.enlace}>
          Ir a la primera página
        </Link>
      </p>
    );
  }

  const desde = (p.pagina - 1) * p.porPagina + 1;
  const hasta = desde + p.leads.length - 1;
  const hayAnterior = p.pagina > 1;
  const haySiguiente = hasta < p.total;

  return (
    <>
      <p className={estilos.dato}>{`Leads ${desde} a ${hasta} de ${p.total}.`}</p>
      <ol className={estilos.lista} start={desde}>
        {p.leads.map((l) => (
          <li key={l.id} className={estilos.lead}>
            <TarjetaDeLead
              lead={{
                id: l.id,
                nombre: l.nombre,
                correo: l.correo,
                numeroTelefono: l.numeroTelefono,
                estado: l.estado,
                origen: l.origen,
                aceptaContacto: l.aceptaContacto,
                dejoSuContacto: formatearFechaHora(l.fechaCreacion),
                materias: l.materias,
                marcado: l.marcado
                  ? `Lo marcó ${l.marcado.porAdmin ?? "un admin"} el ${formatearFechaHora(l.marcado.en)}`
                  : null,
                sinContacto: l.sinContacto
                  ? `Pidió no recibir mensajes. Lo registró ${l.sinContacto.porAdmin ?? "un admin"} el ${formatearFechaHora(l.sinContacto.en)}`
                  : null,
              }}
            />
          </li>
        ))}
      </ol>
      {(hayAnterior || haySiguiente) && (
        <nav aria-label="Páginas de leads" className={estilos.paginas}>
          {hayAnterior && (
            <Link href={direccionDeLeads({ ...filtros, pagina: p.pagina - 1 })} className={estilos.enlace}>
              Más nuevos
            </Link>
          )}
          {haySiguiente && (
            <Link href={direccionDeLeads({ ...filtros, pagina: p.pagina + 1 })} className={estilos.enlace}>
              Más antiguos
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
