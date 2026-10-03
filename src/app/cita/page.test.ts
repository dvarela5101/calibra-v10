import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cita } from "@/lib/citas/reglas";
import PaginaDeCita from "./page";

// Sin navegador ni base: la página de la cita con el enlace del correo, con la cita inventada y la hora fija. Aquí se
// fija cuándo sale el botón de cancelar (solo con plazo, HU-024) y qué se dice cuando no hay. La base decide de verdad
// si cabe; el recorrido completo lo cubre e2e/cancelar.spec.ts.

const datos = vi.hoisted(() => ({ cita: null as Cita | null }));

vi.mock("@/lib/citas/servidor", () => ({ leerCitaPorToken: async () => datos.cita, leerMisCitas: async () => [] }));
vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => null }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => null }));
// La acción vive en el servidor y el botón es del navegador: aquí solo se pintan.
vi.mock("./acciones", () => ({ cancelarCita: async () => ({ error: null }) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));

const HORA = 3_600_000;
const TOKEN = "d".repeat(64);
const INICIO = new Date("2026-10-07T15:00:00.000Z");
const CANCELABLE_HASTA = new Date(INICIO.getTime() - 12 * HORA);
const FUERZA_MAYOR = "Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin";

const CITA: Cita = {
  idMonitoria: "5a5a5a5a-0000-4000-8000-000000000024",
  estado: "confirmada",
  motivoCancelacion: null,
  nombreMonitor: "Laura Gómez",
  nombreMateria: "Cálculo Diferencial",
  codigoMateria: "MATE-1203",
  fecha: "2026-10-07",
  hora: "10:00:00",
  duracionMin: 60,
  presencial: true,
  valorTotal: 32_000,
  lugar: "Edificio Santo Domingo, salón 301",
  enlace: null,
  inicio: INICIO,
  finProgramado: new Date(INICIO.getTime() + HORA),
  cancelableHasta: CANCELABLE_HASTA,
  reporteHasta: new Date(INICIO.getTime() + 25 * HORA),
  estadoPago: "aprobado",
  estadoReembolso: null,
  estadoReporte: null,
};

async function pintar(cita: Cita | null, ahora: Date, token: string | string[] = TOKEN): Promise<string> {
  vi.setSystemTime(ahora);
  datos.cita = cita;
  return renderToStaticMarkup(await PaginaDeCita({ params: Promise.resolve({}), searchParams: Promise.resolve({ token }) }));
}

/** El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("CORREO_DATOS_PERSONALES", "soporte@calibra.example");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Página de la cita con el enlace del correo (HU-024)", () => {
  it("con plazo ofrece cancelar, con el token del enlace en un campo oculto, y no habla de fuerza mayor", async () => {
    const html = await pintar(CITA, new Date(CANCELABLE_HASTA.getTime() - 4 * HORA));
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Cancelar mi monitoría<\/button>/);
    expect(html).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="token"[^>]*value="${TOKEN}"`));
    expect(html).not.toContain('name="id"');
    expect(texto(html)).toContain("Puedes cancelarla hasta el");
    expect(texto(html)).not.toContain("fuerza mayor");
  });

  it("con el límite exacto todavía ofrece cancelar (P-40)", async () => {
    expect(await pintar(CITA, CANCELABLE_HASTA)).toContain("Cancelar mi monitoría");
  });

  it("pasado el plazo no ofrece cancelar y explica que los casos de fuerza mayor los resuelve un admin, con el correo de soporte", async () => {
    const html = await pintar(CITA, new Date(CANCELABLE_HASTA.getTime() + 1));
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
    expect(texto(html)).toContain(`${FUERZA_MAYOR}: escríbenos a soporte@calibra.example.`);
  });

  it("sin correo de soporte configurado, el texto de fuera de plazo no promete un canal", async () => {
    vi.stubEnv("CORREO_DATOS_PERSONALES", "");
    const t = texto(await pintar(CITA, new Date(CANCELABLE_HASTA.getTime() + 1)));
    expect(t).toContain(`${FUERZA_MAYOR}.`);
    expect(t).not.toContain("escríbenos");
  });

  it("una cita en curso, terminada o ya cancelada no ofrece cancelar", async () => {
    const casos: [Cita, Date][] = [
      [CITA, new Date(INICIO.getTime() + 30 * 60_000)],
      [CITA, new Date(CITA.finProgramado.getTime() + 1)],
      [{ ...CITA, estado: "realizada" }, new Date(INICIO.getTime() + 2 * HORA)],
      [{ ...CITA, estado: "cancelada", motivoCancelacion: "estudiante" }, new Date(CANCELABLE_HASTA.getTime() - HORA)],
    ];
    for (const [cita, ahora] of casos) {
      const html = await pintar(cita, ahora);
      expect(html, cita.estado).not.toContain("<button");
      expect(texto(html), cita.estado).not.toContain("fuerza mayor");
    }
  });

  it("una cita que el Lead canceló dice que la cancelaste tú y cómo va el dinero, sin botones", async () => {
    const html = await pintar(
      { ...CITA, estado: "cancelada", motivoCancelacion: "estudiante", estadoReembolso: "esperando_llave" },
      new Date(CANCELABLE_HASTA.getTime() - HORA),
    );
    expect(texto(html)).toContain("Esta monitoría se canceló");
    expect(texto(html)).toContain("La cancelaste tú.");
    expect(texto(html)).toContain("Vamos a devolverte el dinero.");
    expect(html).not.toContain("<button");
  });

  it("un enlace que no sirve no ofrece nada: ni cita ni botón", async () => {
    for (const html of [await pintar(null, CANCELABLE_HASTA), await pintar(CITA, CANCELABLE_HASTA, [TOKEN, TOKEN])]) {
      expect(texto(html)).toContain("Este enlace no sirve");
      expect(html).not.toContain("<button");
      expect(html).not.toContain(TOKEN);
    }
  });
});
