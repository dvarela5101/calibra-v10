import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoDeReportar } from "@/lib/citas/reportar-reglas";
import { reportarInasistencia } from "./acciones-de-reporte";

// La acción de reportar con todas sus dependencias falsas: la sesión, el cliente de Supabase, las dos puertas de la
// base (`reportarInasistenciaPorToken`, `reportarInasistenciaDeMiCita`) y el `redirect` de Next, que aquí lanza un error
// con la ruta para poder leerla. Si la cita cabe reportar lo decide la base: se prueba en pgTAP e integración. El
// recorrido completo, con el navegador, lo cubre e2e/reportar.spec.ts.

const TOKEN = "b".repeat(64);
const ID = "5a5a5a5a-0000-4000-8000-000000000029";

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
vi.mock("@/lib/citas/reportar", () => ({
  reportarInasistenciaPorToken: (...args: unknown[]) => falsos.porToken(...args),
  reportarInasistenciaDeMiCita: (...args: unknown[]) => falsos.mia(...args),
}));

const SESION = { idUsuario: "c0c0c0c0-0000-4000-8000-000000000029", rol: "anonimo" };
const CLIENTE = { esElClienteDeLaSesion: true };

const formulario = (campos: Record<string, string | Blob>) => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

/** Lo que devuelve la acción, o la redirección que lanza (su ruta y su tipo). */
async function ejecutar(campos: Record<string, string | Blob>) {
  try {
    return { estado: await reportarInasistencia({ error: null }, formulario(campos)), redireccion: null };
  } catch (error) {
    if (error instanceof Redireccion) return { estado: null, redireccion: { ruta: error.ruta, tipo: error.tipo } };
    throw error;
  }
}

const NO_EXISTE = "No encontramos esta monitoría. Solo quien la agendó puede reportar.";

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

describe("reportarInasistencia (HU-029): con el enlace del correo", () => {
  it.each(["reportada", "ya_reportada"] as const)("con %s lleva a la misma cita, reemplazando la dirección en el historial", async (resultado) => {
    falsos.porToken.mockResolvedValue(resultado);
    const { estado, redireccion } = await ejecutar({ token: TOKEN });
    expect(estado).toBeNull();
    expect(redireccion).toEqual({ ruta: `/cita?token=${TOKEN}`, tipo: "replace" });
    expect(falsos.porToken).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });

  it("no usa la sesión: el token es la credencial", async () => {
    falsos.sesion = null;
    falsos.cliente = null;
    falsos.porToken.mockResolvedValue("reportada");
    expect((await ejecutar({ token: TOKEN })).redireccion?.ruta).toBe(`/cita?token=${TOKEN}`);
    expect(falsos.mia).not.toHaveBeenCalled();
  });

  it("recorta los espacios del campo", async () => {
    falsos.porToken.mockResolvedValue("reportada");
    await ejecutar({ token: `  ${TOKEN}\n` });
    expect(falsos.porToken).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });
});

describe("reportarInasistencia (HU-029): con la sesión del navegador", () => {
  it.each(["reportada", "ya_reportada"] as const)("con %s lleva a la cita de la sesión", async (resultado) => {
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
    expect(estado).toEqual({ error: NO_EXISTE });
    expect(falsos.mia).not.toHaveBeenCalled();
  });

  it("sin cliente de Supabase responde lo mismo", async () => {
    falsos.cliente = null;
    expect((await ejecutar({ id: ID })).estado?.error).toBe(NO_EXISTE);
    expect(falsos.mia).not.toHaveBeenCalled();
  });
});

describe("reportarInasistencia (HU-029): qué se le dice con cada resultado", () => {
  it.each([
    ["aun_no_empieza", "La monitoría todavía no empieza. Puedes reportar que el monitor no llegó desde su hora de inicio."],
    ["fuera_de_ventana", "Ya pasó el plazo para reportar que el monitor no llegó."],
    ["no_reportable", "Esta monitoría ya no se puede reportar."],
    ["no_individual", "Las monitorías grupales todavía no se reportan desde esta página."],
    ["no_existe", NO_EXISTE],
  ] as const satisfies readonly (readonly [ResultadoDeReportar, string])[])("%s se explica y no redirige", async (resultado, mensaje) => {
    falsos.porToken.mockResolvedValue(resultado);
    const { estado, redireccion } = await ejecutar({ token: TOKEN });
    expect(redireccion).toBeNull();
    expect(estado).toEqual({ error: mensaje });
  });

  it("sin admin deja rastro en el registro, no redirige y ofrece el correo de soporte", async () => {
    vi.stubEnv("CORREO_DATOS_PERSONALES", "soporte@calibra.example");
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    falsos.porToken.mockResolvedValue("sin_admin");
    const { estado, redireccion } = await ejecutar({ token: TOKEN });
    expect(redireccion).toBeNull();
    expect(estado).toEqual({ error: "No pudimos recibir tu reporte en este momento. Intenta de nuevo en unos minutos o escríbenos a soporte@calibra.example." });
    expect(registro).toHaveBeenCalledOnce();
    expect(String(registro.mock.calls[0][0])).toContain("no hay ningún admin activo");
    expect(JSON.stringify(registro.mock.calls)).not.toContain(TOKEN);
  });

  it("sin admin y sin correo de soporte configurado no promete un canal", async () => {
    vi.stubEnv("CORREO_DATOS_PERSONALES", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    falsos.mia.mockResolvedValue("sin_admin");
    expect((await ejecutar({ id: ID })).estado).toEqual({ error: "No pudimos recibir tu reporte en este momento. Intenta de nuevo en unos minutos." });
  });
});

describe("reportarInasistencia (HU-029): lo que no es una cita que se pueda reportar", () => {
  it.each([
    ["sin campos", {}],
    ["con campos vacíos", { token: "", id: "  " }],
    ["con las dos puertas a la vez", { token: TOKEN, id: ID }],
    ["con un archivo en vez de texto", { token: new Blob(["x"]) }],
  ] as const)("%s responde como si no existiera, sin llamar a la base", async (_caso, campos) => {
    const { estado, redireccion } = await ejecutar(campos);
    expect(redireccion).toBeNull();
    expect(estado?.error).toBe(NO_EXISTE);
    expect(falsos.porToken).not.toHaveBeenCalled();
    expect(falsos.mia).not.toHaveBeenCalled();
  });
});

describe("reportarInasistencia (HU-029): cuando la base falla", () => {
  it("dice que no se pudo, lo registra sin el token y no redirige como si hubiera reportado", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    falsos.porToken.mockRejectedValue(new Error("No se pudo reportar la inasistencia: conexión rechazada"));
    const { estado, redireccion } = await ejecutar({ token: TOKEN });
    expect(redireccion).toBeNull();
    expect(estado).toEqual({ error: "No pudimos enviar tu reporte. Intenta de nuevo." });
    expect(registro).toHaveBeenCalledOnce();
    expect(JSON.stringify(registro.mock.calls)).not.toContain(TOKEN);
  });

  it("una respuesta desconocida de la base (la puerta lanza) tampoco se toma por reportada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    falsos.mia.mockRejectedValue(new Error('Respuesta inesperada al reportar la inasistencia: "cancelada"'));
    const { estado, redireccion } = await ejecutar({ id: ID });
    expect(redireccion).toBeNull();
    expect(estado?.error).toBe("No pudimos enviar tu reporte. Intenta de nuevo.");
  });
});
