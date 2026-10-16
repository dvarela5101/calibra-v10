import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RegistroMonitor from "./page";

// HU-096 (D-71 b) sin navegador ni base: la página del registro con la búsqueda de la invitación y la lectura de
// `parametros_comision()` inventadas, y se lee el HTML. Qué invitaciones sirven lo cubren la integración y
// e2e/monitores.spec.ts; aquí se fija la línea de la regla general de la comisión.

const TOKEN = "ab".repeat(32);
const VENCE = "2026-10-19T15:00:00.000Z";
// Intl separa el signo de pesos con un espacio duro (U+00A0).
const normal = (texto: string) => texto.replace(/\xa0/g, " ");

const h = vi.hoisted(() => ({
  buscar: vi.fn(),
  parametros: vi.fn(),
  crearAdmin: vi.fn(),
}));

vi.mock("@/lib/monitores/servidor", () => ({ buscarInvitacion: h.buscar }));
vi.mock("@/lib/supabase/admin", () => ({ crearClienteAdmin: h.crearAdmin }));
vi.mock("./acciones", () => ({ registrarse: async () => ({ error: null, invitacionNoSirve: false, valores: {} }) }));

const pintar = async (consulta: Record<string, string | string[] | undefined>) =>
  normal(renderToStaticMarkup(await RegistroMonitor({ params: Promise.resolve({}), searchParams: Promise.resolve(consulta) })));

/** El cliente de la llave secreta, con `parametros_comision()` respondiendo lo que diga `h.parametros`. */
const clienteConParametros = () => ({ rpc: () => ({ single: async () => h.parametros() }) });

beforeEach(() => {
  h.buscar.mockReset().mockResolvedValue({ vigente: true, correo: "nuevo@calibra.test", venceEn: VENCE });
  h.parametros.mockReset().mockResolvedValue({ data: { comision_porcentaje: 10, comision_tope: 15000 }, error: null });
  h.crearAdmin.mockReset().mockImplementation(clienteConParametros);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** La ayuda de la comisión: el párrafo con id `llave-regla`. */
const lineaDe = (html: string) => /<p id="llave-regla" class="[^"]*">([^<]*)<\/p>/.exec(html)?.[1];

describe("la línea de la comisión con una invitación vigente", () => {
  it("con el 10 % y 15.000 de RN-81 dice el texto de la HU, junto a «Tu llave» y antes del botón", async () => {
    const html = await pintar({ token: TOKEN });
    expect(lineaDe(html)).toBe(
      "Por cada monitoría, Calibra descuenta una comisión del 10 % del total pagado, con un máximo de $ 15.000. Se descuenta de lo que te transferimos.",
    );
    expect(html.indexOf('for="llave"')).toBeLessThan(html.indexOf('id="llave-regla"'));
    expect(html.indexOf('id="llave-regla"')).toBeLessThan(html.indexOf('id="llave"'));
    expect(html.indexOf('id="llave"')).toBeLessThan(html.indexOf("Crear mi cuenta"));
    expect(h.buscar).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });

  it("con otros valores en la base (12 y 20.000) la línea cambia sin tocar la app", async () => {
    h.parametros.mockResolvedValue({ data: { comision_porcentaje: 12, comision_tope: 20000 }, error: null });
    const linea = lineaDe(await pintar({ token: TOKEN }));
    expect(linea).toContain("del 12 % del total pagado");
    expect(linea).toContain("un máximo de $ 20.000.");
    expect(linea).not.toMatch(/10 %|15\.000/);
  });

  it("el campo «Tu llave» queda descrito por su ayuda y por la línea, y no hay ningún campo, casilla ni enlace nuevo", async () => {
    const html = await pintar({ token: TOKEN });
    const llave = /<input id="llave"[^>]*>/.exec(html)?.[0] ?? "";
    expect(llave).toContain('aria-describedby="llave-ayuda llave-regla"');
    expect([...html.matchAll(/<form/g)]).toHaveLength(1);
    expect([...html.matchAll(/<input id="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "correo",
      "nombre",
      "numero_telefono",
      "llave",
      "contrasena",
      "confirmacion",
    ]);
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toMatch(/acepto/i);
  });

  it("la línea no promete, no usa «bruto» ni «neto» y no trae un ejemplo con montos; la página no trae más cifras de comisión", async () => {
    const html = await pintar({ token: TOKEN });
    expect(lineaDe(html)).not.toMatch(/bruto|neto|ejemplo|ganancia|plazo/i);
    // En toda la página, la palabra solo sale en esa línea.
    expect(html.match(/comisi[oó]n/gi)).toHaveLength(1);
    expect(html).not.toMatch(/bruto/i);
  });
});

describe("sin una invitación vigente la página ni lee la comisión", () => {
  it.each([
    ["sin token", {}],
    ["con un token inventado", { token: "basura" }],
    ["con un token repetido", { token: [TOKEN, TOKEN] }],
  ])("%s: «Necesitas una invitación vigente», sin formulario ni línea", async (_caso, consulta) => {
    h.buscar.mockResolvedValue({ vigente: false });
    const html = await pintar(consulta);
    expect(html).toContain("Necesitas una invitación vigente");
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/comisi[oó]n|llave-regla/i);
    expect(h.crearAdmin).not.toHaveBeenCalled();
    expect(h.parametros).not.toHaveBeenCalled();
  });
});

describe("si la lectura de la comisión falla, el registro sigue funcionando", () => {
  it.each([
    ["la base responde un error de permisos", () => h.parametros.mockResolvedValue({ data: null, error: { message: "permission denied" } })],
    ["la base devuelve una fila rara", () => h.parametros.mockResolvedValue({ data: { comision_porcentaje: -3, comision_tope: 15000 }, error: null })],
    ["la lectura lanza", () => h.parametros.mockRejectedValue(new Error("sin red"))],
    ["falta la llave secreta y no se puede ni crear el cliente", () => h.crearAdmin.mockImplementation(() => { throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL"); })],
  ])("%s: el formulario sale sin la línea y el fallo queda en el registro del servidor", async (_caso, fallar) => {
    fallar();
    const html = await pintar({ token: TOKEN });
    expect(html).toContain("Crea tu cuenta de monitor");
    expect(html).toContain("<form");
    expect(html).toContain('type="password"');
    expect(html).toContain("Crear mi cuenta");
    expect(html).not.toMatch(/comisi[oó]n|llave-regla/i);
    const llave = /<input id="llave"[^>]*>/.exec(html)?.[0] ?? "";
    expect(llave).toContain('aria-describedby="llave-ayuda"');
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
