import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..");
const config = readFileSync(join(RAIZ, "supabase", "config.toml"), "utf8");

/** El texto de una sección `[nombre]` de config.toml, hasta la siguiente sección. */
function seccion(nombre: string): string {
  const inicio = config.search(new RegExp(`^\\[${nombre.replace(/\./g, "\\.")}\\][ \\t]*\\r?$`, "m"));
  expect(inicio, `config.toml debe tener la sección [${nombre}]`).toBeGreaterThanOrEqual(0);
  const resto = config.slice(inicio).split(/\r?\n/).slice(1);
  const hasta = resto.findIndex((linea) => /^\[/.test(linea));
  return (hasta === -1 ? resto : resto.slice(0, hasta)).join("\n");
}

/** El valor de una clave de una sección, sin comentarios ni comillas; undefined si no está o está comentada. */
function valor(texto: string, clave: string): string | undefined {
  const linea = texto.split(/\r?\n/).find((l) => new RegExp(`^${clave}\\s*=`).test(l));
  return linea?.replace(/^[^=]+=\s*/, "").replace(/\s+#.*$/, "").replace(/^"|"$/g, "").trim();
}

// HU-032, criterio 20 (D-18): la cuenta de Estudiante depende de dos ajustes de Auth que se leen al arrancar el stack. Esta
// prueba es estática (no necesita la base): si alguien los cambia, falla aquí y no en cada prueba con Auth. La guardia de
// e2e/preparacion.ts lo comprueba contra el Auth que corre de verdad.

describe("supabase/config.toml: las confirmaciones de correo (HU-032)", () => {
  it("[auth.email] pide confirmar el correo: sin esto, updateUser({ email }) convierte al anónimo sin que nadie confirme (RN-12)", () => {
    expect(valor(seccion("auth.email"), "enable_confirmations")).toBe("true");
  });

  it("el enlace del correo vence en una hora, como dice su texto", () => {
    // El texto del correo promete «vence en una hora» y §C de docs/pendientes-dvarela.md pide 3600 s en la nube.
    expect(valor(seccion("auth.email"), "otp_expiry")).toBe("3600");
  });

  it("la plantilla de cambio de correo existe, con el asunto de la HU y un archivo que está en el repo", () => {
    const plantilla = seccion("auth.email.template.email_change");

    expect(valor(plantilla, "subject")).toBe("Confirma tu correo para crear tu cuenta de Calibra");
    const ruta = valor(plantilla, "content_path");
    expect(ruta).toBe("./supabase/templates/confirmar-correo.html");
    expect(existsSync(join(RAIZ, ruta ?? "no-existe"))).toBe(true);
  });

  it("la de recuperar contraseña sigue como estaba", () => {
    const plantilla = seccion("auth.email.template.recovery");

    expect(valor(plantilla, "subject")).toBe("Restablece tu contraseña de Calibra");
    expect(valor(plantilla, "content_path")).toBe("./supabase/templates/recuperar.html");
  });
});

describe("supabase/templates/confirmar-correo.html (HU-032)", () => {
  const html = readFileSync(join(RAIZ, "supabase", "templates", "confirmar-correo.html"), "utf8");

  it("el enlace va a la página con botón, con el token del correo y el tipo, armado con el sitio de Auth", () => {
    expect(html).toContain('href="{{ .SiteURL }}/cuenta/confirmar?token_hash={{ .TokenHash }}&type=email_change"');
    // No usa /auth/confirmar, que verifica con un GET y gasta el token al abrirlo.
    expect(html).not.toContain("/auth/confirmar");
    // El enlace no depende del origen desde el que se pidió.
    expect(html).not.toContain("{{ .RedirectTo }}");
  });

  it("dice que el enlace sirve una vez, que vence en una hora y que, si no lo pidió, no se crea ninguna cuenta", () => {
    expect(html).toContain("Confirma tu correo");
    expect(html).toContain("Pediste crear tu cuenta de Calibra con este correo. Confirma que es tuyo con este enlace:");
    expect(html).toContain("Confirmar mi correo");
    expect(html).toContain("El enlace sirve una sola vez y vence en una hora.");
    expect(html).toContain("Si no lo pediste, ignora este correo: no se crea ninguna cuenta.");
  });

  it("es un documento en español, sin rayas largas ni emojis, y con el estilo de recuperar.html (mismos colores)", () => {
    expect(html).toContain('<html lang="es">');
    expect(html).not.toContain("—");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);

    const recuperar = readFileSync(join(RAIZ, "supabase", "templates", "recuperar.html"), "utf8");
    const colores = (texto: string) => new Set(texto.match(/#[0-9A-Fa-f]{6}/g));
    expect([...colores(html)].sort()).toEqual([...colores(recuperar)].sort());
  });

  it("no lleva el correo ni ningún dato de la persona: solo el enlace", () => {
    const variables = [...html.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]);

    expect(new Set(variables)).toEqual(new Set([".SiteURL", ".TokenHash"]));
  });
});

// HU-032 (revisión, hallazgo 4): los topes de `public.parametros_cuenta()` (3 por sesión y 20 en total por hora) están en el
// servidor de la app, y el navegador llama a Auth directo con la llave pública y su sesión anónima (`updateUser({ email })`)
// sin pasar por ellos. El único límite que acota los correos de Auth es `email_sent`, y su valor por defecto en el CLI (2)
// no deja ni pedir una cuenta cada media hora. Esta prueba fija que se haya puesto, que deje margen sobre el tope de la app
// para «Olvidé mi contraseña» y que siga siendo bajo, y que el corte (§C de docs/pendientes-dvarela.md) pida lo mismo en el
// panel de la nube.

describe("supabase/config.toml: el límite de correos de Auth (HU-032, revisión)", () => {
  const carpeta = join(RAIZ, "supabase", "migrations");
  const archivo = readdirSync(carpeta).find((nombre) => nombre.endsWith("_cuenta_de_estudiante.sql"));
  const migracion = readFileSync(join(carpeta, archivo ?? "no-existe.sql"), "utf8");
  /** El tope de pedidos de cuenta de todas las sesiones en una hora, como lo devuelve `public.parametros_cuenta()`. */
  const topeTotalDeLaApp = Number(/(\d+),\s*-- tope_envios_total/.exec(migracion)?.[1]);
  const limiteDeAuth = Number(valor(seccion("auth.rate_limit"), "email_sent"));

  it("la migración de la cuenta de Estudiante existe y su tope total de pedidos se puede leer", () => {
    expect(archivo, "supabase/migrations debe tener la migración *_cuenta_de_estudiante.sql").toBeDefined();
    expect(Number.isInteger(topeTotalDeLaApp)).toBe(true);
  });

  it("[auth.rate_limit] fija email_sent con un entero, no el 2 del CLI", () => {
    expect(Number.isInteger(limiteDeAuth), "email_sent debe estar en [auth.rate_limit] y no comentado").toBe(true);
    expect(limiteDeAuth).toBeGreaterThan(2);
  });

  it("email_sent deja al menos 10 correos por hora de margen sobre el tope de pedidos de cuenta, para «Olvidé mi contraseña»", () => {
    expect(limiteDeAuth).toBeGreaterThanOrEqual(topeTotalDeLaApp + 10);
  });

  it("y es bajo (60 o menos): un tope grande deja a cualquiera con una sesión anónima gastar el correo del proveedor", () => {
    expect(limiteDeAuth).toBeLessThanOrEqual(60);
  });

  it("§C de docs/pendientes-dvarela.md pide fijar el mismo límite en el panel de Supabase", () => {
    const pendientes = readFileSync(join(RAIZ, "docs", "pendientes-dvarela.md"), "utf8");
    const inicio = pendientes.indexOf("**Confirmar el correo al crear la cuenta de Estudiante (HU-032)");
    expect(inicio, "§C debe tener el ítem de HU-032").toBeGreaterThanOrEqual(0);
    // El ítem llega hasta el siguiente de la lista (`- [ ] **`).
    const resto = pendientes.slice(inicio + 1);
    const fin = resto.search(/^- \[[ x]\] /m);
    const item = fin === -1 ? resto : resto.slice(0, fin);

    expect(item).toContain("email_sent");
    expect(item).toContain(String(limiteDeAuth));
  });
});
