import type { Metadata } from "next";
import Link from "next/link";
import formulario from "@/components/formulario.module.css";
import { Pantalla } from "@/components/Pantalla";
import { formatearFechaHora } from "@/lib/fechas";
import { formatearPesos } from "@/lib/moneda";
import { identidadDelProveedor } from "@/lib/pagos/configuracion";
import { TEXTO_SOLO_LA_LLAVE, vistaDeLaLlave, type LlaveDeReembolso } from "@/lib/reembolsos/reglas";
import { leerLlavePorToken } from "@/lib/reembolsos/servidor";
import { FormularioDeLlave } from "./FormularioDeLlave";
import estilos from "./reembolso.module.css";

export const metadata: Metadata = {
  title: "Tu reembolso · Calibra",
  // El enlace trae un token: que no quede en buscadores ni se filtre por el Referer.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const EYEBROW = "Tu reembolso";

/**
 * HU-025 (RN-44, RN-61, P-10): la página del enlace que le llega a quien pagó para que entregue la llave de su
 * reembolso. El token es la única credencial: va fuera del grupo `(publico)`, así que abrir el enlace no crea una
 * sesión anónima (quien pagó puede no ser el Lead). Abrirla no cambia nada; solo el formulario guarda. Mientras el
 * reembolso espera la llave y el plazo sigue abierto muestra el formulario; si no, cuenta en qué va (recibida,
 * devuelto o cerrado). Lo decide la base con su hora. La llave nunca se muestra (criterio 3).
 */
export default async function Reembolso({ searchParams }: PageProps<"/reembolso">) {
  const { token } = await searchParams;

  // Un token vacío o repetido (`?token=a&token=b` llega como arreglo) no es un enlace válido: la misma pantalla que
  // para uno inventado, sin consultar nada.
  let llave: LlaveDeReembolso | null;
  try {
    llave = typeof token === "string" ? await leerLlavePorToken(token) : null;
  } catch (error) {
    // Solo el mensaje: el token nunca va al registro.
    console.error("[reembolsos] no se pudo leer el reembolso del enlace:", error instanceof Error ? error.message : error);
    return (
      <Pantalla eyebrow={EYEBROW} titulo="No pudimos cargar tu reembolso">
        <p role="alert" className={formulario.error}>
          Recarga la página; si sigue igual, inténtalo más tarde.
        </p>
      </Pantalla>
    );
  }
  if (!llave || typeof token !== "string") return <EnlaceQueNoSirve />;

  const vista = vistaDeLaLlave(llave, identidadDelProveedor().correo);
  const esperando = llave.estado === "esperando_llave";

  return (
    <Pantalla eyebrow={EYEBROW} titulo={vista.titulo} subtitulo={vista.texto}>
      <dl className={estilos.resumen}>
        <div className={estilos.dato}>
          <dt className={estilos.rotulo}>Monto</dt>
          <dd className={estilos.valor}>{formatearPesos(llave.monto)}</dd>
        </div>
        <div className={estilos.dato}>
          <dt className={estilos.rotulo}>Motivo</dt>
          <dd className={estilos.valor}>{llave.motivo}</dd>
        </div>
        {esperando && (
          <div className={estilos.dato}>
            <dt className={estilos.rotulo}>Envíala hasta el</dt>
            <dd className={estilos.valor}>
              <time dateTime={llave.venceEn.toISOString()}>{formatearFechaHora(llave.venceEn)}</time>
            </dd>
          </div>
        )}
      </dl>

      {esperando ? (
        <>
          <FormularioDeLlave token={token} ayuda={vista.nota ?? ""} />
          <p className={estilos.nota}>{TEXTO_SOLO_LA_LLAVE}</p>
        </>
      ) : (
        <>
          {vista.nota && <p className={estilos.nota}>{vista.nota}</p>}
          <Link href="/" className={formulario.enlace}>
            Ir al inicio
          </Link>
        </>
      )}
    </Pantalla>
  );
}

/**
 * Token inventado, mal formado, repetido o vacío: una sola pantalla, sin ningún dato de ningún reembolso. Que el enlace
 * esté mal escrito y que no exista se ven igual.
 */
function EnlaceQueNoSirve() {
  return (
    <Pantalla
      eyebrow={EYEBROW}
      titulo="Este enlace no sirve"
      subtitulo="Está incompleto o no lo reconocemos. Abre de nuevo el enlace del correo que te mandamos."
    >
      <Link href="/" className={formulario.enlace}>
        Ir al inicio
      </Link>
    </Pantalla>
  );
}
