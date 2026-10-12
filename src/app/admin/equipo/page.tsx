import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import casillas from "@/components/casillas.module.css";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { cargarEquipo } from "@/lib/admin/equipo";
import {
  MENSAJES_DE_MOVER,
  MENSAJES_PARA_NO_DESACTIVAR,
  MENSAJES_PARA_NO_REACTIVAR,
  motivoParaNoDesactivar,
  quedariaPrimero,
  siguienteActivo,
  textoDeCasos,
  type MiembroDelEquipo,
} from "@/lib/admin/equipo-reglas";
import { listarInvitaciones } from "@/lib/admin/invitaciones";
import { AVISO_DE_DATOS, MENSAJES_DE_CANCELAR, MENSAJES_DE_INVITAR, type InvitacionAbierta } from "@/lib/admin/invitaciones-reglas";
import { esUuid } from "@/lib/agendar/reglas";
import { exigirRol } from "@/lib/auth/sesion";
import { formatearFechaHora } from "@/lib/fechas";
import { crearClienteServidor } from "@/lib/supabase/servidor";
import type { Database } from "@/lib/supabase/tipos";
import { cancelarInvitacion, desactivar, invitar, mover, reactivar } from "./acciones";
import estilos from "./equipo.module.css";

export const metadata: Metadata = { title: "Equipo de admins · Calibra" };

const RUTA = "/admin/equipo";

type Aviso = { exito: boolean; texto: string };

const MENSAJES_DE_ERROR: Record<string, string> = {
  ...MENSAJES_DE_MOVER,
  ...MENSAJES_PARA_NO_DESACTIVAR,
  ...MENSAJES_PARA_NO_REACTIVAR,
  ...MENSAJES_DE_INVITAR,
  ...MENSAJES_DE_CANCELAR,
  fallo: "No pudimos guardar el cambio. Intenta de nuevo; si sigue igual, avisa al equipo.",
};

/**
 * El aviso que trae la dirección. `equipo` es el que la página acaba de cargar con la sesión: el aviso de reactivar viene con
 * el id de la persona y su nombre sale de ahí, nunca de la dirección, que cualquiera puede escribir a mano.
 */
function avisoDe(consulta: Record<string, string | string[] | undefined>, equipo: MiembroDelEquipo[] | null): Aviso | null {
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
  const reactivado = valor("reactivado");
  if (reactivado) {
    // Un id que no es del equipo, o que no está activo, no dice nada: la dirección no puede poner texto en un aviso de éxito.
    const miembro = esUuid(reactivado) ? equipo?.find((m) => m.id === reactivado && m.activo) : undefined;
    if (!miembro) return null;
    return { exito: true, texto: `${miembro.nombre} quedó reactivado: ya puede volver a entrar. Conserva su lugar en el orden de revisión.` };
  }
  const invitada = valor("invitada");
  if (invitada === "1") {
    return { exito: true, texto: "Enviamos la invitación. El enlace sirve una sola vez y vence en 7 días. La ves en «Invitaciones abiertas»." };
  }
  if (invitada === "sin_correo") {
    return {
      exito: false,
      texto:
        "La invitación quedó creada, pero el correo no salió todavía. Calibra lo reintenta solo; si no sale, lo verás en tu bandeja en «Correos que no salieron». No hace falta invitar de nuevo.",
    };
  }
  if (valor("cancelada")) return { exito: true, texto: "La invitación quedó cancelada: su enlace ya no sirve." };
  const error = valor("error");
  if (error) return { exito: false, texto: Object.hasOwn(MENSAJES_DE_ERROR, error) ? MENSAJES_DE_ERROR[error] : MENSAJES_DE_ERROR.fallo };
  return null;
}

/** Una lectura con la sesión del admin. Si falla se deja en el registro y vuelve `null`: que falle una no esconde la otra. */
async function leer<T>(que: string, lectura: (cliente: SupabaseClient<Database>) => Promise<T>): Promise<T | null> {
  try {
    const supabase = await crearClienteServidor();
    if (!supabase) throw new Error("Faltan las variables de Supabase.");
    return await lectura(supabase);
  } catch (error) {
    console.error(`[equipo] no se pudo cargar ${que}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * HU-054: el orden de revisión del equipo de admins (RN-07) y desactivar a uno (RN-23). Al desactivar, sus casos
 * abiertos pasan al siguiente admin activo (P-44). Nadie se desactiva a sí mismo ni deja el equipo sin admins activos.
 *
 * HU-072: invitar a una persona al equipo por correo, ver y cancelar las invitaciones abiertas, y reactivar a un admin
 * desactivado desde su tarjeta (D-64 a). Solo hay un aviso con rol (`status` o `alert`) arriba: lo demás es texto común.
 */
export default async function EquipoDeAdmins({ searchParams }: PageProps<"/admin/equipo">) {
  const sesion = await exigirRol("admin", RUTA);
  const consulta = await searchParams;

  const [equipo, invitaciones] = await Promise.all([
    leer("el equipo", (supabase) => cargarEquipo(supabase)),
    leer("las invitaciones", (supabase) => listarInvitaciones(supabase)),
  ]);
  const aviso = avisoDe(consulta, equipo);

  return (
    <Pantalla
      eyebrow="Administración"
      titulo="Equipo de admins"
      subtitulo="Los pagos se reparten en este orden, saltándose a los desactivados. Si desactivas a alguien, sus pagos en revisión y sus reembolsos y reportes abiertos pasan al siguiente admin activo. También puedes invitar a una persona al equipo."
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

      <section aria-labelledby="titulo-invitaciones" className={estilos.seccion}>
        <h2 id="titulo-invitaciones" className={estilos.titulo}>
          {invitaciones ? `Invitaciones abiertas (${invitaciones.length})` : "Invitaciones abiertas"}
        </h2>
        {invitaciones === null ? (
          <p role="alert" className={formulario.error}>
            No pudimos cargar las invitaciones. Recarga la página; si sigue igual, avisa al equipo.
          </p>
        ) : invitaciones.length === 0 ? (
          <p className={formulario.ayuda}>No hay invitaciones abiertas.</p>
        ) : (
          <ul className={estilos.lista} aria-label="Invitaciones abiertas">
            {invitaciones.map((invitacion) => (
              <Invitacion key={invitacion.id} invitacion={invitacion} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titulo-invitar" className={estilos.seccion}>
        <h2 id="titulo-invitar" className={estilos.titulo}>
          Invitar a una persona al equipo
        </h2>
        {/* Un Server Component con una acción de servidor: funciona sin JavaScript. noValidate para que los mensajes salgan del servidor. */}
        <form action={invitar} noValidate className={estilos.formulario}>
          <div className={formulario.campo}>
            <label htmlFor="correo" className={formulario.etiqueta}>
              Correo de la persona
            </label>
            <p id="correo-ayuda" className={formulario.ayuda}>
              Le llega un enlace para crear su cuenta de admin. Sirve una sola vez y vence en 7 días.
            </p>
            <input
              id="correo"
              name="correo"
              type="email"
              autoComplete="off"
              aria-describedby="correo-ayuda"
              required
              className={formulario.entrada}
            />
          </div>
          <div className={formulario.campo}>
            <label htmlFor="correo_repetido" className={formulario.etiqueta}>
              Escribe el correo otra vez
            </label>
            <input id="correo_repetido" name="correo_repetido" type="email" autoComplete="off" required className={formulario.entrada} />
          </div>
          <div className={casillas.casilla}>
            <input id="entiendo" name="entiendo" type="checkbox" value="si" required className={casillas.control} />
            <label htmlFor="entiendo" className={casillas.texto}>
              {AVISO_DE_DATOS}
            </label>
          </div>
          <button type="submit" className={formulario.boton}>
            Enviar invitación
          </button>
        </form>
      </section>

      <Link href="/admin" className={formulario.enlace}>
        Volver a mi bandeja
      </Link>
    </Pantalla>
  );
}

function Invitacion({ invitacion: i }: { invitacion: InvitacionAbierta }) {
  const cabeza = `invitacion-${i.id}`;
  return (
    <li className={estilos.tarjeta}>
      <span id={cabeza} className={estilos.cabeza}>
        {i.correo}
      </span>
      {/* En un solo elemento: así el nombre de quien invitó no se confunde con la cabecera de la tarjeta de un admin. */}
      <span className={estilos.dato}>{i.invitoActivo ? `Invitó ${i.invitadaPor}` : `Invitó ${i.invitadaPor} (desactivado)`}</span>
      {/* Una invitación de un admin desactivado no sirve (se comprueba al abrir el enlace y al registrarse); vuelve a servir si lo reactivan. */}
      <span className={estilos.dato}>
        {i.invitoActivo
          ? `Vigente · vence el ${formatearFechaHora(i.venceEn)}`
          : `No sirve mientras quien invitó siga desactivado · vence el ${formatearFechaHora(i.venceEn)}`}
      </span>

      <details className={estilos.confirmar}>
        <summary className={estilos.resumen}>{`Cancelar la invitación a ${i.correo}`}</summary>
        <p className={formulario.ayuda}>El enlace que ya salió dejará de servir. Si lo necesitas, puedes invitar de nuevo.</p>
        <form action={cancelarInvitacion}>
          <input type="hidden" name="invitacion" value={i.id} />
          <button type="submit" aria-describedby={cabeza} className={formulario.boton}>
            Sí, cancelar la invitación
          </button>
        </form>
      </details>
    </li>
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
            <button type="submit" aria-describedby={cabeza} className={`${formulario.boton} ${estilos.botonConNombre}`}>
              Sí, desactivar a {m.nombre}
            </button>
          </form>
        </details>
      )}

      {!m.activo && (
        <details className={estilos.confirmar}>
          <summary className={estilos.resumen}>{`Reactivar a ${m.nombre}`}</summary>
          <p className={formulario.ayuda}>
            {`${m.nombre} podrá volver a entrar a Calibra con su contraseña de siempre y conserva su lugar en el orden de revisión. Sus casos abiertos no se le devuelven.`}
            {quedariaPrimero(equipo, m.id) ? " Queda primero entre los activos: volverá a recibir los pagos nuevos." : ""}
          </p>
          <form action={reactivar}>
            <input type="hidden" name="admin" value={m.id} />
            <button type="submit" aria-describedby={cabeza} className={`${formulario.boton} ${estilos.botonConNombre}`}>
              {`Sí, reactivar a ${m.nombre}`}
            </button>
          </form>
        </details>
      )}
    </li>
  );
}
