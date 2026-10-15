import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { PANEL_POR_ROL, tienePanel } from "@/lib/auth/roles";
import { obtenerSesion } from "@/lib/auth/sesion";
import { RUTA_DE_CITAS } from "@/lib/citas/reglas";
import { pantallaDeCuenta, PARAMETRO_ENVIADO, rutaParaCambiarDatos, rutaParaIngresar, TEXTOS } from "@/lib/cuentas/reglas";
import { leadTieneCuenta } from "@/lib/cuentas/servidor";
import { rutaSiguiente } from "@/lib/leads/reglas";
import { leadDeLaSesion } from "@/lib/leads/servidor";
import { FormularioContacto } from "../../agendar/contacto/FormularioContacto";
import { pedirCuenta } from "./acciones";
import estilos from "./cuenta.module.css";
import { FormularioCuenta, FormularioTerminar } from "./FormularioCuenta";

export const metadata: Metadata = {
  title: "Crea tu cuenta · Calibra",
  // Muestra el nombre y el correo de la persona: que no quede en buscadores.
  robots: { index: false, follow: false },
};

/** «¿Ya tienes cuenta? Inicia sesión»: a `/ingresar` con la misma ruta de regreso. */
function EnlaceDeIngreso({ siguiente }: { siguiente: string }) {
  return (
    <Link href={rutaParaIngresar(siguiente)} className={formulario.enlace}>
      {TEXTOS.yaTienesCuenta} {TEXTOS.iniciarSesion}
    </Link>
  );
}

/**
 * HU-032, criterio 1: pedir la cuenta de Estudiante. Qué ve cada quien lo decide `pantallaDeCuenta`; la página solo
 * lee la base cuando hay una sesión que puede tener Lead (anónima, o ya confirmada y sin rol). Vive en `(publico)`:
 * necesita la sesión anónima, que es la que se convierte en la cuenta.
 */
export default async function CrearCuenta({ searchParams }: PageProps<"/cuenta/crear">) {
  const { siguiente: pedido, [PARAMETRO_ENVIADO]: enviado } = await searchParams;
  const siguiente = rutaSiguiente(pedido);

  const sesion = await obtenerSesion();
  const pideLead = sesion !== null && (sesion.rol === "anonimo" || sesion.rol === null);
  const lead = pideLead ? await leadDeLaSesion(sesion.idUsuario) : null;
  const tieneCuenta = lead ? await leadTieneCuenta(lead.id) : false;

  const pantalla = pantallaDeCuenta({ sesion, hayLead: lead !== null, correoDelLead: lead?.correo ?? null, leadTieneCuenta: tieneCuenta });

  // Un Estudiante ya tiene cuenta: va a «Mis citas», sin formulario.
  if (pantalla === "estudiante") redirect(RUTA_DE_CITAS);

  switch (pantalla) {
    case "equipo":
      return (
        <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.equipoTitulo} subtitulo={TEXTOS.equipo}>
          {sesion && tienePanel(sesion.rol) && (
            <Link href={PANEL_POR_ROL[sesion.rol]} className={formulario.enlace}>
              {TEXTOS.irAMiPanel}
            </Link>
          )}
          <EnlaceDeIngreso siguiente={siguiente} />
        </Pantalla>
      );

    case "ya_tiene_cuenta":
      return (
        <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.yaTieneTitulo} subtitulo={TEXTOS.yaTiene}>
          <div className={estilos.enlaces}>
            <Link href={rutaParaIngresar(siguiente)} className={formulario.enlace}>
              Iniciar sesión
            </Link>
            <Link href="/restablecer" className={formulario.enlace}>
              {TEXTOS.olvideMiContrasena}
            </Link>
          </div>
          <EnlaceDeIngreso siguiente={siguiente} />
        </Pantalla>
      );

    case "terminar":
      return (
        <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.terminarTitulo} subtitulo={TEXTOS.terminar}>
          <FormularioTerminar />
          <EnlaceDeIngreso siguiente={siguiente} />
        </Pantalla>
      );

    case "sin_correo":
      return (
        <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.crearTitulo} subtitulo={TEXTOS.sinCorreo}>
          <Link href={rutaParaCambiarDatos(siguiente)} className={formulario.enlace}>
            {TEXTOS.cambiarMisDatos}
          </Link>
          <EnlaceDeIngreso siguiente={siguiente} />
        </Pantalla>
      );

    case "resumen":
      return (
        <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.crearTitulo} subtitulo={TEXTOS.resumen}>
          <dl className={estilos.datos}>
            <div className={estilos.dato}>
              <dt className={estilos.etiqueta}>{TEXTOS.etiquetaNombre}</dt>
              <dd className={estilos.valor}>{lead?.nombre}</dd>
            </div>
            <div className={estilos.dato}>
              <dt className={estilos.etiqueta}>{TEXTOS.etiquetaCorreo}</dt>
              <dd className={estilos.valor}>{lead?.correo}</dd>
            </div>
          </dl>
          <Link href={rutaParaCambiarDatos(siguiente)} className={formulario.enlace}>
            {TEXTOS.cambiarMisDatos}
          </Link>
          <FormularioCuenta
            siguiente={siguiente}
            // El correo ya salió (quien dejó su contacto y pidió la cuenta en el mismo paso llega con `?enviado=1`).
            avisoInicial={enviado === "1" && lead?.correo ? TEXTOS.avisoEnviado(lead.correo) : null}
          />
          <EnlaceDeIngreso siguiente={siguiente} />
        </Pantalla>
      );

    case "contacto":
      return (
        <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.crearTitulo} subtitulo={TEXTOS.crearContacto}>
          <FormularioContacto
            siguiente={siguiente}
            iniciales={{ nombre: "", correo: "", numero_telefono: "" }}
            accion={pedirCuenta}
            textoDelBoton={TEXTOS.botonCrear}
            textoDelBotonEnviando={TEXTOS.botonCreando}
            ayudaDelCorreo={TEXTOS.ayudaDelCorreo}
          />
          <EnlaceDeIngreso siguiente={siguiente} />
        </Pantalla>
      );
  }
}
