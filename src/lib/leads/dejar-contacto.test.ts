import { beforeEach, describe, expect, it, vi } from "vitest";
import { avisoDeVerificacion, CORREO_FIJO } from "@/lib/leads/avisos";
import type { LeadDeSesion } from "@/lib/leads/servidor";
import { CASILLA_TRATAMIENTO, ERROR_SIN_AUTORIZACION, MARCADA } from "@/lib/privacidad/consentimiento";

// HU-010: la pieza común de agendar (HU-068) y del resultado del diagnóstico, sin base. La sesión, la cookie de campaña,
// `leadDeLaSesion` y `registrarContacto` son inventados; lo que se fija es qué ve el formulario en cada caso y qué recibe
// `registrarContacto`. HU-032 suma el correo fijo de un Estudiante (D-55 b).

const falsos = vi.hoisted(() => ({
  sesion: null as { idUsuario: string; rol: string | null } | null,
  origen: undefined as string | undefined,
  registrar: vi.fn(),
  lead: vi.fn(),
  // HU-031: lo que se programa para después de responder, sin correrlo.
  programadas: [] as (() => Promise<unknown>)[],
  mandar: vi.fn(),
}));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => falsos.sesion }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (falsos.origen === undefined ? undefined : { value: falsos.origen }) }),
}));
vi.mock("@/lib/leads/servidor", () => ({
  registrarContacto: (...args: unknown[]) => falsos.registrar(...args),
  leadDeLaSesion: (...args: unknown[]) => falsos.lead(...args),
}));
vi.mock("@/lib/diagnostico/recuperacion", () => ({
  programarEnlace: (tarea: () => Promise<unknown>) => falsos.programadas.push(tarea),
  mandarEnlaceDelUltimoDiagnostico: (...args: unknown[]) => falsos.mandar(...args),
}));

import { procesarContacto } from "./dejar-contacto";

const SESION = { idUsuario: "5e000000-0000-4000-8000-000000000001", rol: "anonimo" };
const DESTINO = { siguienteDeVerificacion: "/agendar" };
const LEAD_DEL_ESTUDIANTE: LeadDeSesion = {
  id: "1e1e1e1e-0000-4000-8000-000000000068",
  nombre: "Ana Pérez",
  correo: "ana@calibra.test",
  numeroTelefono: null,
};

function formulario(campos: Record<string, string> = {}): FormData {
  const datos = new FormData();
  const todos = { nombre: "Ana Pérez", correo: "ana@calibra.test", numero_telefono: "", [CASILLA_TRATAMIENTO]: MARCADA, ...campos };
  for (const [nombre, valor] of Object.entries(todos)) if (valor !== "") datos.set(nombre, valor);
  return datos;
}

beforeEach(() => {
  falsos.sesion = SESION;
  falsos.origen = undefined;
  falsos.registrar.mockReset().mockResolvedValue({ resultado: "lead" });
  falsos.lead.mockReset().mockResolvedValue(LEAD_DEL_ESTUDIANTE);
  falsos.programadas = [];
  falsos.mandar.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("procesarContacto: el enlace de resultados al crear el Lead (HU-031)", () => {
  const ID_LEAD = "1e000000-0000-4000-8000-000000000031";

  it("con un Lead recién creado programa el enlace de su último diagnóstico y no lo espera", async () => {
    falsos.registrar.mockResolvedValue({ resultado: "lead", idLeadNuevo: ID_LEAD });
    // El proveedor nunca contesta: igual sigue, porque el envío no se espera.
    falsos.mandar.mockReturnValue(new Promise(() => {}));
    await expect(procesarContacto(formulario(), DESTINO)).resolves.toEqual({ listo: true });
    expect(falsos.mandar).not.toHaveBeenCalled();
    expect(falsos.programadas).toHaveLength(1);
    void falsos.programadas[0]();
    expect(falsos.mandar).toHaveBeenCalledExactlyOnceWith(ID_LEAD);
  });

  it("al actualizar un Lead, al pedir verificación (P-23) o con un error no programa nada", async () => {
    for (const resultado of [
      { resultado: "lead" },
      { resultado: "verificar", envio: "enviado" },
      { resultado: "error", error: "Ese correo ya es de otro contacto de Calibra. Escribe el tuyo." },
    ]) {
      falsos.registrar.mockResolvedValue(resultado);
      await procesarContacto(formulario(), DESTINO);
    }
    expect(falsos.programadas).toHaveLength(0);
  });
});

describe("procesarContacto", () => {
  it("deja a la sesión como Lead con la campaña de la cookie y el destino del enlace de P-23", async () => {
    falsos.origen = "feria-2026";
    await expect(procesarContacto(formulario(), DESTINO)).resolves.toEqual({ listo: true });
    expect(falsos.registrar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        idSesion: SESION.idUsuario,
        contacto: expect.objectContaining({ nombre: "Ana Pérez", correo: "ana@calibra.test" }),
        origen: "feria-2026",
        siguiente: "/agendar",
      }),
    );
  });

  it("sin sesión no guarda nada y pide recargar", async () => {
    falsos.sesion = null;
    const estado = await procesarContacto(formulario(), DESTINO);
    expect(estado).toMatchObject({ error: expect.stringContaining("Recarga la página") });
    expect(falsos.registrar).not.toHaveBeenCalled();
  });

  it.each(["monitor", "admin"])("con una cuenta del equipo (%s) no guarda nada", async (rol) => {
    falsos.sesion = { ...SESION, rol };
    const estado = await procesarContacto(formulario(), DESTINO);
    expect(estado).toMatchObject({ error: expect.stringContaining("cuenta del equipo") });
    expect(falsos.registrar).not.toHaveBeenCalled();
  });

  it("sin nombre o con un correo inválido no guarda nada y conserva lo escrito", async () => {
    expect(await procesarContacto(formulario({ nombre: "" }), DESTINO)).toMatchObject({ error: "Escribe tu nombre." });
    const estado = await procesarContacto(formulario({ correo: "no-es-un-correo" }), DESTINO);
    expect(estado).toMatchObject({ error: expect.stringContaining("correo válido"), valores: { correo: "no-es-un-correo" } });
    expect(falsos.registrar).not.toHaveBeenCalled();
  });

  it("sin la autorización no guarda nada (criterio 6)", async () => {
    const estado = await procesarContacto(formulario({ [CASILLA_TRATAMIENTO]: "" }), DESTINO);
    expect(estado).toMatchObject({ error: ERROR_SIN_AUTORIZACION });
    expect(falsos.registrar).not.toHaveBeenCalled();
  });

  it.each([
    ["enviado", "te llega un enlace para confirmarlo"],
    ["frenado", "ya le mandamos varios enlaces"],
    ["fallido", "no pudimos mandarte el enlace"],
  ])("con un correo de otro Lead (P-23, %s) avisa sin error y conserva lo escrito", async (envio, texto) => {
    falsos.registrar.mockResolvedValue({ resultado: "verificar", envio });
    const estado = await procesarContacto(formulario(), DESTINO);
    expect(estado).toMatchObject({ error: null, aviso: expect.stringContaining(texto), valores: { nombre: "Ana Pérez" } });
  });

  it("el aviso de P-23 es el de siempre, con «sigues agendando aquí» (HU-032 lo comparte con /cuenta/crear)", async () => {
    for (const envio of ["enviado", "frenado", "fallido"] as const) {
      falsos.registrar.mockResolvedValueOnce({ resultado: "verificar", envio });
      const estado = await procesarContacto(formulario(), DESTINO);
      expect(estado, envio).toMatchObject({ error: null, aviso: avisoDeVerificacion(envio, "agendando") });
    }
    falsos.registrar.mockResolvedValueOnce({ resultado: "verificar", envio: "enviado" });
    expect(await procesarContacto(formulario(), DESTINO)).toMatchObject({
      aviso: expect.stringContaining("ábrelo en este navegador y sigues agendando aquí"),
    });
  });

  it("muestra el error que devuelve registrarContacto (el tope de correos de HU-075, por ejemplo)", async () => {
    falsos.registrar.mockResolvedValue({ resultado: "error", error: "Probaste varios correos seguidos." });
    expect(await procesarContacto(formulario(), DESTINO)).toMatchObject({ error: "Probaste varios correos seguidos." });
  });

  it("si registrarContacto falla, pide intentar de nuevo y deja el error en el log", async () => {
    falsos.registrar.mockRejectedValue(new Error("caída"));
    expect(await procesarContacto(formulario(), DESTINO)).toMatchObject({ error: "No pudimos guardar tus datos. Intenta de nuevo." });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("procesarContacto: el correo de un Estudiante queda fijo (HU-032, D-55 b, criterio 12)", () => {
  beforeEach(() => {
    falsos.sesion = { ...SESION, rol: "estudiante" };
  });

  it("con otro correo responde el mensaje, con lo escrito, y NO llama a registrarContacto: no se cambia nada", async () => {
    const estado = await procesarContacto(formulario({ correo: "otro@calibra.test", nombre: "Ana P." }), DESTINO);

    expect(estado).toEqual({
      error: CORREO_FIJO,
      aviso: null,
      valores: { nombre: "Ana P.", correo: "otro@calibra.test", numero_telefono: "" },
    });
    expect(falsos.lead).toHaveBeenCalledExactlyOnceWith(SESION.idUsuario);
    expect(falsos.registrar).not.toHaveBeenCalled();
  });

  it("el correo se compara normalizado (mayúsculas y espacios): el mismo correo escrito distinto pasa", async () => {
    await expect(procesarContacto(formulario({ correo: "  ANA@Calibra.test ", nombre: "Ana P." }), DESTINO)).resolves.toEqual({ listo: true });
    expect(falsos.registrar).toHaveBeenCalledTimes(1);
    expect(falsos.registrar.mock.calls[0][0].contacto).toMatchObject({ nombre: "Ana P.", correo: "ana@calibra.test" });
  });

  it("con su mismo correo cambia el nombre y el teléfono", async () => {
    await expect(procesarContacto(formulario({ nombre: "Ana Pérez Gómez", numero_telefono: "3001234567" }), DESTINO)).resolves.toEqual({
      listo: true,
    });
    expect(falsos.registrar.mock.calls[0][0].contacto).toEqual({
      nombre: "Ana Pérez Gómez",
      correo: "ana@calibra.test",
      numeroTelefono: "+573001234567",
    });
  });

  it("el Lead sale de la base, no del formulario; si no se puede leer, no guarda", async () => {
    falsos.lead.mockRejectedValueOnce(new Error("falló"));

    expect(await procesarContacto(formulario(), DESTINO)).toMatchObject({ error: "No pudimos guardar tus datos. Intenta de nuevo." });
    expect(falsos.registrar).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("un correo que no es un correo da el error de siempre, antes de leer el Lead", async () => {
    expect(await procesarContacto(formulario({ correo: "no-es-un-correo" }), DESTINO)).toMatchObject({ error: expect.stringContaining("correo válido") });
    expect(falsos.lead).not.toHaveBeenCalled();
    expect(falsos.registrar).not.toHaveBeenCalled();
  });

  it("quien no es Estudiante (un visitante) no pasa por la guarda: no se lee su Lead", async () => {
    falsos.sesion = SESION;
    await expect(procesarContacto(formulario({ correo: "otro@calibra.test" }), DESTINO)).resolves.toEqual({ listo: true });
    expect(falsos.lead).not.toHaveBeenCalled();
    expect(falsos.registrar).toHaveBeenCalledTimes(1);
  });
});
