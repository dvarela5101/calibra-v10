import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoDeCancelar } from "@/lib/citas/cancelar-reglas";
import { cancelarCita } from "./acciones";

// La acción de cancelar con todas sus dependencias falsas: la sesión, el cliente de Supabase, las dos puertas de la
// base (`cancelarCitaPorToken`, `cancelarMiCita`) y el `redirect` de Next, que aquí lanza un error con la ruta para
// poder leerla. Qué cita cabe cancelar lo decide la base: se prueba en pgTAP e integración. El recorrido completo, con
// el navegador, lo cubre e2e/cancelar.spec.ts.

const TOKEN = "b".repeat(64);
const ID = "5a5a5a5a-0000-4000-8000-000000000024";

const falsos = vi.hoisted(() => ({
  sesion: null as { idUsuario: string; rol: string | null } | null,
  cliente: null as object | null,
  porToken: vi.fn(),
  mia: vi.fn(),
}));

class Redireccion extends Error {
  constructor(
    readonly ruta: string,
    readonly tipo: string | undefined,
  ) {
    super(`NEXT_REDIRECT ${ruta}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (ruta: string, tipo?: string) => {
    throw new Redireccion(ruta, tipo);
  },
}));
vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => falsos.sesion }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => falsos.cliente }));
vi.mock("@/lib/citas/cancelar", () => ({
  cancelarCitaPorToken: (...args: unknown[]) => falsos.porToken(...args),
  cancelarMiCita: (...args: unknown[]) => falsos.mia(...args),
}));

const SESION = { idUsuario: "c0c0c0c0-0000-4000-8000-000000000024", rol: "anonimo" };
const CLIENTE = { esElClienteDeLaSesion: true };

const formulario = (campos: Record<string, string | Blob>) => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

/** Lo que devuelve la acción, o la redirección que lanza (su ruta y su tipo). */
async function ejecutar(campos: Record<string, string | Blob>) {
  try {
    return { estado: await cancelarCita({ error: null }, formulario(campos)), redireccion: null };
  } catch (error) {
    if (error instanceof Redireccion) return { estado: null, redireccion: { ruta: error.ruta, tipo: error.tipo } };
    throw error;
  }
}

const FUERA_DE_PLAZO = "Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin";

beforeEach(() => {
  falsos.sesion = SESION;
  falsos.cliente = CLIENTE;
  falsos.porToken.mockReset();
  falsos.mia.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cancelarCita (HU-024): con el enlace del correo", () => {
  it.each(["cancelada", "ya_cancelada"] as const)("con %s lleva a la misma cita, reemplazando la dirección en el historial", async (resultado) => {
    falsos.porToken.mockResolvedValue(resultado);
    const { estado, redireccion } = await ejecutar({ token: TOKEN });
    expect(estado).toBeNull();
    expect(redireccion).toEqual({ ruta: `/cita?token=${TOKEN}`, tipo: "replace" });
    expect(falsos.porToken).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });

  it("no usa la sesión: el token es la credencial", async () => {
    falsos.sesion = null;
    falsos.cliente = null;
    falsos.porToken.mockResolvedValue("cancelada");
    expect((await ejecutar({ token: TOKEN })).redireccion?.ruta).toBe(`/cita?token=${TOKEN}`);
    expect(falsos.mia).not.toHaveBeenCalled();
  });

  it("recorta los espacios del campo", async () => {
    falsos.porToken.mockResolvedValue("cancelada");
    await ejecutar({ token: `  ${TOKEN}\n` });
    expect(falsos.porToken).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });
});

describe("cancelarCita (HU-024): con la sesión del navegador", () => {
  it.each(["cancelada", "ya_cancelada"] as const)("con %s lleva a la cita de la sesión", async (resultado) => {
    falsos.mia.mockResolvedValue(resultado);
    const { estado, redireccion } = await ejecutar({ id: ID });
    expect(estado).toBeNull();
    expect(redireccion).toEqual({ ruta: `/cita/${ID}`, tipo: "replace" });
    // Con el cliente de la sesión, no con la llave secreta.
    expect(falsos.mia).toHaveBeenCalledExactlyOnceWith(CLIENTE, ID);
    expect(falsos.porToken).not.toHaveBeenCalled();
  });

  it("sin sesión no consulta nada y responde como si la cita no existiera (no revela qué citas hay)", async () => {
    falsos.sesion = null;
    const { estado } = await ejecutar({ id: ID });
    expect(estado).toEqual({ error: "No encontramos esta monitoría. Solo quien la agendó puede cancelarla." });
    expect(falsos.mia).not.toHaveBeenCalled();
  });

  it("sin cliente de Supabase responde lo mismo", async () => {
    falsos.cliente = null;
    expect((await ejecutar({ id: ID })).estado?.error).toContain("No encontramos esta monitoría");
    expect(falsos.mia).not.toHaveBeenCalled();
  });
});

describe("cancelarCita (HU-024): qué se le dice con cada resultado", () => {
  it("fuera de plazo explica que los casos de fuerza mayor los resuelve un admin y da el correo de soporte", async () => {
    vi.stubEnv("CORREO_DATOS_PERSONALES", "soporte@calibra.example");
    falsos.porToken.mockResolvedValue("fuera_de_plazo");
    expect((await ejecutar({ token: TOKEN })).estado).toEqual({ error: `${FUERA_DE_PLAZO}: escríbenos a soporte@calibra.example.` });
  });

  it("fuera de plazo, sin correo de soporte configurado, no promete un canal", async () => {
    vi.stubEnv("CORREO_DATOS_PERSONALES", "");
    falsos.mia.mockResolvedValue("fuera_de_plazo");
    expect((await ejecutar({ id: ID })).estado).toEqual({ error: `${FUERA_DE_PLAZO}.` });
  });

  it.each([
    ["no_cancelable", "Esta monitoría ya no se puede cancelar."],
    ["no_individual", "Las monitorías grupales todavía no se cancelan desde esta página."],
    ["no_existe", "No encontramos esta monitoría. Solo quien la agendó puede cancelarla."],
  ] as const satisfies readonly (readonly [ResultadoDeCancelar, string])[])("%s se explica y no redirige", async (resultado, mensaje) => {
    falsos.porToken.mockResolvedValue(resultado);
    const { estado, redireccion } = await ejecutar({ token: TOKEN });
    expect(redireccion).toBeNull();
    expect(estado).toEqual({ error: mensaje });
  });
});

describe("cancelarCita (HU-024): lo que no es una cita que se pueda cancelar", () => {
  it.each([
    ["sin campos", {}],
    ["con campos vacíos", { token: "", id: "  " }],
    ["con las dos puertas a la vez", { token: TOKEN, id: ID }],
    ["con un archivo en vez de texto", { token: new Blob(["x"]) }],
  ] as const)("%s responde como si no existiera, sin llamar a la base", async (_caso, campos) => {
    const { estado, redireccion } = await ejecutar(campos);
    expect(redireccion).toBeNull();
    expect(estado?.error).toContain("No encontramos esta monitoría");
    expect(falsos.porToken).not.toHaveBeenCalled();
    expect(falsos.mia).not.toHaveBeenCalled();
  });
});

describe("cancelarCita (HU-024): cuando la base falla", () => {
  it("dice que no se pudo, lo registra sin el token y no redirige como si hubiera cancelado", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    falsos.porToken.mockRejectedValue(new Error("No se pudo cancelar la cita: conexión rechazada"));
    const { estado, redireccion } = await ejecutar({ token: TOKEN });
    expect(redireccion).toBeNull();
    expect(estado).toEqual({ error: "No pudimos cancelar tu monitoría. Intenta de nuevo." });
    expect(registro).toHaveBeenCalledOnce();
    expect(JSON.stringify(registro.mock.calls)).not.toContain(TOKEN);
  });

  it("una respuesta desconocida de la base (la puerta lanza) tampoco se toma por cancelada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    falsos.mia.mockRejectedValue(new Error('Respuesta inesperada al cancelar la cita: "sin_admin"'));
    const { estado, redireccion } = await ejecutar({ id: ID });
    expect(redireccion).toBeNull();
    expect(estado?.error).toBe("No pudimos cancelar tu monitoría. Intenta de nuevo.");
  });
});
