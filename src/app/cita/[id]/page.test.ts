import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cita } from "@/lib/citas/reglas";
import MiCita from "./page";

// Sin navegador ni base: la página de una cita de la sesión, con la cita inventada y la hora fija. Aquí se fija cuándo
// sale el botón de cancelar con la sesión (solo con plazo, HU-024) y que lleva el id de la cita y no el token. La base
// decide de verdad si la cita es del Lead y si cabe; el recorrido completo lo cubre e2e/cancelar.spec.ts.

const datos = vi.hoisted(() => ({
  cita: null as Cita | null,
  sesion: null as { idUsuario: string; rol: string | null } | null,
}));

vi.mock("@/lib/citas/servidor", () => ({ leerMiCita: async () => datos.cita }));
vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => datos.sesion }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => ({}) }));
// La acción vive en el servidor y el botón es del navegador: aquí solo se pintan.
vi.mock("../acciones", () => ({ cancelarCita: async () => ({ error: null }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (ruta: string) => {
    throw new Error(`redirect ${ruta}`);
  },
  unstable_rethrow: () => {},
}));

const HORA = 3_600_000;
const ID = "5a5a5a5a-0000-4000-8000-000000000024";
const INICIO = new Date("2026-10-07T15:00:00.000Z");
const CANCELABLE_HASTA = new Date(INICIO.getTime() - 12 * HORA);
const FUERZA_MAYOR = "Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin";
const SESION = { idUsuario: "c0c0c0c0-0000-4000-8000-000000000024", rol: "anonimo" };

const CITA: Cita = {
  idMonitoria: ID,
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
  estadoPago: "en_revision",
  estadoReembolso: null,
  estadoReporte: null,
};

async function pintar(cita: Cita | null, ahora: Date): Promise<string> {
  vi.setSystemTime(ahora);
  datos.cita = cita;
  return renderToStaticMarkup(await MiCita({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) }));
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
  datos.sesion = SESION;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Página de una cita de la sesión (HU-024)", () => {
  it("con plazo ofrece cancelar, con el id de la cita en un campo oculto y sin token, y ofrece volver a Mis citas", async () => {
    const html = await pintar(CITA, new Date(CANCELABLE_HASTA.getTime() - 4 * HORA));
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Cancelar mi monitoría<\/button>/);
    expect(html).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="id"[^>]*value="${ID}"`));
    expect(html).not.toContain('name="token"');
    expect(texto(html)).not.toContain("fuerza mayor");
    expect(texto(html)).toContain("Ver mis citas");
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

  it("una cancelada por el Lead con el pago todavía en revisión explica qué pasa con el dinero, sin botones", async () => {
    const html = await pintar({ ...CITA, estado: "cancelada", motivoCancelacion: "estudiante" }, new Date(CANCELABLE_HASTA.getTime() - HORA));
    expect(texto(html)).toContain("La cancelaste tú.");
    expect(texto(html)).toContain("Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.");
    expect(html).not.toContain("<button");
  });

  it("una cita que no es de la sesión (la base no la entrega) o sin sesión es un 404 y no ofrece nada", async () => {
    await expect(pintar(null, CANCELABLE_HASTA)).rejects.toThrow("notFound");
    datos.sesion = null;
    await expect(pintar(CITA, CANCELABLE_HASTA)).rejects.toThrow("notFound");
  });
});
