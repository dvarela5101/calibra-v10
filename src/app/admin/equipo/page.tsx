import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { cargarEquipo } from "@/lib/admin/equipo";
import {
  MENSAJES_DE_MOVER,
  MENSAJES_PARA_NO_DESACTIVAR,
  motivoParaNoDesactivar,
  siguienteActivo,
  textoDeCasos,
  type MiembroDelEquipo,
} from "@/lib/admin/equipo-reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import { desactivar, mover } from "./acciones";
import estilos from "./equipo.module.css";

export const metadata: Metadata = { title: "Equipo de admins · Calibra" };

const RUTA = "/admin/equipo";

type Aviso = { exito: boolean; texto: string };

const MENSAJES_DE_ERROR: Record<string, string> = {
  ...MENSAJES_DE_MOVER,
  ...MENSAJES_PARA_NO_DESACTIVAR,
  fallo: "No pudimos guardar el cambio. Intenta de nuevo; si sigue igual, avisa al equipo.",
};

function avisoDe(consulta: Record<string, string | string[] | undefined>): Aviso | null {
  const valor = (clave: string) => (typeof consulta[clave] === "string" ? (consulta[clave] as string) : null);
  if (valor("movido")) return { exito: true, texto: "Listo: el orden de revisión cambió." };
  const desactivado = valor("desactivado");
  if (desactivado) {
    const recibe = valor("recibe");
    return {
      exito: true,
      texto: `${desactivado} quedó desactivado: ya no puede entrar.${recibe ? ` Sus casos abiertos pasaron a ${recibe}.` : ""}`,
    };
  }
  const error = valor("error");
  if (error) return { exito: false, texto: MENSAJES_DE_ERROR[error] ?? MENSAJES_DE_ERROR.fallo };
  return null;
}

/**
 * HU-054: el orden de revisión del equipo de admins (RN-07) y desactivar a uno (RN-23). Al desactivar, sus casos
 * abiertos pasan al siguiente admin activo (P-44). Nadie se desactiva a sí mismo ni deja el equipo sin admins activos.
 */
export default async function EquipoDeAdmins({ searchParams }: PageProps<"/admin/equipo">) {
  const sesion = await exigirRol("admin", RUTA);
  const aviso = avisoDe(await searchParams);

  let equipo: MiembroDelEquipo[] | null = null;
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    equipo = await cargarEquipo(supabase);
  } catch (error) {
    console.error("[equipo] no se pudo cargar el equipo:", error instanceof Error ? error.message : error);
  }

  return (
    <Pantalla
      eyebrow="Administración"
      titulo="Equipo de admins"
      subtitulo="Los pagos se reparten en este orden, saltándose a los desactivados. Si desactivas a alguien, sus pagos en revisión y sus reembolsos y reportes abiertos pasan al siguiente admin activo."
    >
      {aviso && (
        <p role={aviso.exito ? "status" : "alert"} className={aviso.exito ? formulario.exito : formulario.error}>
          {aviso.texto}
        </p>
      )}

      {equipo ? (
        <ol className={estilos.lista} aria-label="Orden de revisión">
          {equipo.map((m, i) => (
            <Miembro key={m.id} miembro={m} equipo={equipo} idPropio={sesion.idUsuario} primero={i === 0} ultimo={i === equipo.length - 1} />
          ))}
        </ol>
      ) : (
        <p role="alert" className={formulario.error}>
          No pudimos cargar el equipo. Recarga la página; si sigue igual, avisa al equipo.
        </p>
      )}

      <Link href="/admin" className={formulario.enlace}>
        Volver a mi bandeja
      </Link>
    </Pantalla>
  );
}

function Miembro({
  miembro: m,
  equipo,
  idPropio,
  primero,
  ultimo,
}: {
  miembro: MiembroDelEquipo;
  equipo: MiembroDelEquipo[];
  idPropio: string;
  primero: boolean;
  ultimo: boolean;
}) {
  const cabeza = `admin-${m.id}`;
  const puedeDesactivarse = motivoParaNoDesactivar(equipo, idPropio, m.id) === null;
  const recibe = siguienteActivo(equipo, m.id);

  return (
    <li className={estilos.tarjeta}>
      <span id={cabeza} className={estilos.cabeza}>
        {m.nombre}
        {m.id === idPropio ? " (tú)" : ""}
      </span>
      <span className={estilos.dato}>{m.correo}</span>
      <span className={estilos.dato}>
        {m.activo ? "Activo" : "Desactivado"} · {textoDeCasos(m.casosAbiertos)}
      </span>

      <div className={estilos.acciones}>
        {!primero && (
          <form action={mover}>
            <input type="hidden" name="admin" value={m.id} />
            <input type="hidden" name="direccion" value="arriba" />
            <button type="submit" aria-describedby={cabeza} className={formulario.botonSecundario}>
              Subir
            </button>
          </form>
        )}
        {!ultimo && (
          <form action={mover}>
            <input type="hidden" name="admin" value={m.id} />
            <input type="hidden" name="direccion" value="abajo" />
            <button type="submit" aria-describedby={cabeza} className={formulario.botonSecundario}>
              Bajar
            </button>
          </form>
        )}
      </div>

      {puedeDesactivarse && (
        <details className={estilos.desactivar}>
          <summary className={estilos.resumen}>Desactivar a {m.nombre}</summary>
          <p className={formulario.ayuda}>
            {m.nombre} ya no podrá entrar a Calibra. Sus certificados y revisiones se conservan.
            {m.casosAbiertos > 0 && recibe ? ` Sus casos abiertos pasan a ${recibe.nombre}.` : ""}
          </p>
          <form action={desactivar}>
            <input type="hidden" name="admin" value={m.id} />
            <button type="submit" aria-describedby={cabeza} className={formulario.boton}>
              Sí, desactivar a {m.nombre}
            </button>
          </form>
        </details>
      )}
    </li>
  );
}
