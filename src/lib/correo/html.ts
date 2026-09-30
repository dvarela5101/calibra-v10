/**
 * Armado del HTML y del texto plano de un correo. Todo lo que llega de fuera (nombres, motivos,
 * enlaces) se escapa aquí: las plantillas nunca concatenan datos en el HTML a mano.
 *
 * El diseño repite el de `supabase/templates/recuperar.html` (el correo de Auth). Los colores son los
 * de `src/styles/tokens.css`, copiados como valores porque un correo no puede leer variables CSS.
 * Ningún texto baja de 14 px y el botón mide más de 44 px de alto.
 */

const COLOR = {
  fondo: "#FFFDF5", // --bg
  texto: "#0B1B33", // --text
  primario: "#005EFF", // --primary
  apagado: "#636F81", // --muted
} as const;

export type Contenido = {
  titulo: string;
  /** Párrafos de texto corrido, sin formato. */
  parrafos: string[];
  boton?: { texto: string; enlace: string };
  pie?: string;
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (caracter) => ESCAPES[caracter]);
}

type Entorno = Record<string, string | undefined>;

/** Los nombres de esta máquina: un enlace http hacia ellos no sale a la red. */
const HOSTS_LOCALES = ["localhost", "127.0.0.1", "[::1]"];

/**
 * ¿Se acepta el protocolo de esta URL en un correo? https siempre. http solo en local: fuera de
 * producción, o en producción hacia esta misma máquina (la e2e corre el build de producción contra
 * localhost). Los enlaces de los correos llevan tokens (invitaciones, gestionar una cita) y en
 * producción no viajan en claro. HU-064.
 */
export function protocoloAdmitido(url: URL, entorno: Entorno = process.env): boolean {
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return entorno.NODE_ENV !== "production" || HOSTS_LOCALES.includes(url.hostname);
}

/**
 * Valida un enlace antes de ponerlo en un href: https (o http en local, ver `protocoloAdmitido`), sin
 * espacios ni caracteres de control. Rechaza `javascript:`, `data:` y lo que no se pueda leer como URL.
 * Devuelve la URL normalizada.
 */
export function enlaceSeguro(enlace: string, entorno: Entorno = process.env): string {
  if (/[\s\u0000-\u001f\u007f]/.test(enlace)) throw new RangeError("El enlace no puede tener espacios ni caracteres de control.");
  let url: URL;
  try {
    url = new URL(enlace);
  } catch {
    throw new RangeError("El enlace no es una URL válida.");
  }
  if (!protocoloAdmitido(url, entorno)) {
    throw new RangeError(
      url.protocol === "http:" ? "En producción el enlace debe ser https." : `El enlace debe ser http o https (llegó "${url.protocol}").`,
    );
  }
  return url.href;
}

export function armarHtml({ titulo, parrafos, boton, pie }: Contenido): string {
  const enlace = boton ? enlaceSeguro(boton.enlace) : null;
  const partes = [
    `<!doctype html>`,
    `<html lang="es">`,
    `  <head>`,
    `    <meta charset="utf-8">`,
    `    <meta name="viewport" content="width=device-width, initial-scale=1">`,
    `    <title>${escaparHtml(titulo)}</title>`,
    `  </head>`,
    `  <body style="margin:0;padding:24px;background:${COLOR.fondo};color:${COLOR.texto};font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5;">`,
    `    <p style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLOR.primario};">Calibra</p>`,
    `    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;">${escaparHtml(titulo)}</h1>`,
    ...parrafos.map((parrafo) => `    <p style="margin:0 0 16px;">${escaparHtml(parrafo)}</p>`),
  ];
  if (boton && enlace) {
    partes.push(
      `    <p style="margin:0 0 16px;">`,
      `      <a href="${escaparHtml(enlace)}" style="display:inline-block;padding:14px 20px;min-height:20px;background:${COLOR.primario};color:#ffffff;border-radius:14px;font-weight:600;text-decoration:none;">${escaparHtml(boton.texto)}</a>`,
      `    </p>`,
      `    <p style="margin:0 0 16px;color:${COLOR.apagado};font-size:14px;word-break:break-all;">Si el botón no abre, copia este enlace en tu navegador: ${escaparHtml(enlace)}</p>`,
    );
  }
  if (pie) partes.push(`    <p style="margin:0;color:${COLOR.apagado};font-size:14px;">${escaparHtml(pie)}</p>`);
  partes.push(`  </body>`, `</html>`);
  return partes.join("\n");
}

export function armarTexto({ titulo, parrafos, boton, pie }: Contenido): string {
  const bloques = ["Calibra", titulo, ...parrafos];
  if (boton) bloques.push(`${boton.texto}: ${enlaceSeguro(boton.enlace)}`);
  if (pie) bloques.push(pie);
  return `${bloques.join("\n\n")}\n`;
}
