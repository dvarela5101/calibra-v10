import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Reserva } from "@/lib/agendar/servidor";
import type { Rol } from "@/lib/auth/roles";
import ReservaApartada from "./page";

// Sin navegador ni base: la página de la reserva con la sesión, la reserva y el Lead inventados, y se lee el HTML.
// Aquí se fija, sin depender de cuándo corre el proceso de cada minuto, que la reserva cancelada por vencer (HU-027)
// se ve como la vencida sin cancelar (criterio 4 de HU-018), para el Lead y para su monitor. El recorrido con la
// base lo cubre e2e/pagar.spec.ts.

const ID_LEAD = vi.hoisted(() => "1e1e1e1e-0000-4000-8000-000000000027");
const sesion = vi.hoisted(() => ({ actual: null as { idUsuario: string; rol: Rol | null } | null }));
const datos = vi.hoisted(() => ({ reserva: null as Reserva | null }));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => sesion.actual }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => ({}) }));
vi.mock("@/lib/agendar/servidor", () => ({ cargarReserva: async () => datos.reserva }));
vi.mock("@/lib/leads/servidor", () => ({
  leadDeLaSesion: async () => ({ id: ID_LEAD, nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numeroTelefono: null }),
}));
// El contador de la reserva vigente vuelve a pedir la página al vencer; fuera de Next no hay enrutador.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ refresh() {} }),
}));

const ID = "5a5a5a5a-0000-4000-8000-000000000027";
const AHORA = new Date("2026-10-05T15:00:00.000Z");
const MIN_MS = 60_000;
const EXPIRO = "La reserva expiró: ya no puedes adjuntar el comprobante.";
const VENCIO = "Tu reserva venció Pasó el tiempo para adjuntar el comprobante de pago. Puedes elegir otra fecha.";

const LEAD = { idUsuario: "c0c0c0c0-0000-4000-8000-000000000027", rol: "anonimo" as const };
const MONITOR = { idUsuario: "d0d0d0d0-0000-4000-8000-000000000027", rol: "monitor" as const };

/** Apartada hace 11 minutos para dentro de dos días: la reserva de 10 minutos ya venció y todavía se puede cancelar. */
function reserva(cambios: Partial<Reserva>): Reserva {
  const creada = AHORA.getTime() - 11 * MIN_MS;
  return {
    id: ID,
    idLead: ID_LEAD,
    estado: "pendiente_pago",
    motivoCancelacion: null,
    fecha: "2026-10-07",
    hora: "10:00:00",
    duracionMin: 60,
    presencial: true,
    valorTotal: 32_000,
    nombreMonitor: "Andrés Gómez",
    nombreMateria: "Cálculo Diferencial",
    codigoMateria: "MATE-1203",
    inicio: new Date("2026-10-07T15:00:00.000Z"),
    reservaHasta: new Date(creada + 10 * MIN_MS),
    cancelableHasta: new Date("2026-10-07T03:00:00.000Z"),
    ...cambios,
  };
}

async function pintar(quien: typeof LEAD | typeof MONITOR, cambios: Partial<Reserva>): Promise<string> {
  sesion.actual = quien;
  datos.reserva = reserva(cambios);
  return renderToStaticMarkup(await ReservaApartada({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) }));
}

/** El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  vi.useFakeTimers({ now: AHORA, toFake: ["Date"] });
  vi.stubEnv("LLAVE_PLATAFORMA", "3001234567");
  vi.stubEnv("LLAVE_PLATAFORMA_TITULAR", "Calibra SAS");
  vi.stubEnv("LLAVE_PLATAFORMA_QR_URL", "https://calibra.example/qr-llave.png");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const VENCIDA_SIN_CANCELAR: Partial<Reserva> = { estado: "pendiente_pago", motivoCancelacion: null };
const CANCELADA_POR_VENCER: Partial<Reserva> = { estado: "cancelada", motivoCancelacion: "reserva_expirada" };

describe("Página de la reserva (HU-027): la cancelada por vencer se ve como la vencida (criterio 4 de HU-018)", () => {
  it("al Lead le dice que venció y que ya no puede adjuntar el comprobante, sin pago ni formulario", async () => {
    const html = await pintar(LEAD, CANCELADA_POR_VENCER);
    const t = texto(html);
    expect(t).toContain(VENCIO);
    expect(t).toContain(EXPIRO);
    expect(t).not.toContain("Esta reserva se canceló");
    for (const ausente of ["<form", 'type="file"', "3001234567", "qr-llave.png", "Paga "]) {
      expect(html, ausente).not.toContain(ausente);
    }
  });

  it("dice lo mismo que la vencida que todavía sigue por pagar, para el Lead y para su monitor", async () => {
    expect(texto(await pintar(LEAD, CANCELADA_POR_VENCER))).toBe(texto(await pintar(LEAD, VENCIDA_SIN_CANCELAR)));
    const delMonitor = texto(await pintar(MONITOR, CANCELADA_POR_VENCER));
    expect(delMonitor).toBe(texto(await pintar(MONITOR, VENCIDA_SIN_CANCELAR)));
    // El aviso del pago es solo para el Lead que paga.
    expect(delMonitor).toContain(VENCIO);
    expect(delMonitor).not.toContain(EXPIRO);
  });

  it("no mira la hora: cancelada por vencer, sigue sin ofrecer el pago aunque el reloj de este servidor vaya detrás del de la base", async () => {
    const html = await pintar(LEAD, { ...CANCELADA_POR_VENCER, reservaHasta: new Date(AHORA.getTime() + 5 * MIN_MS) });
    expect(texto(html)).toContain(EXPIRO);
    expect(html).not.toContain("<form");
  });

  it.each(["estudiante", "pago_rechazado"] as const)("cancelada por otro motivo (%s) sigue diciendo que se canceló, sin el aviso de vencida", async (motivo) => {
    const t = texto(await pintar(LEAD, { estado: "cancelada", motivoCancelacion: motivo }));
    expect(t).toContain("Esta reserva se canceló");
    expect(t).not.toContain("venció");
    expect(t).not.toContain(EXPIRO);
  });

  it("la vigente sigue ofreciendo el pago", async () => {
    const html = await pintar(LEAD, { reservaHasta: new Date(AHORA.getTime() + 5 * MIN_MS) });
    expect(texto(html)).toContain("Apartamos tu fecha");
    expect(html).toContain("<form");
    expect(texto(html)).not.toContain(EXPIRO);
  });
});
