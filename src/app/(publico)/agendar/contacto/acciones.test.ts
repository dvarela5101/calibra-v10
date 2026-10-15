import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rol } from "@/lib/auth/roles";
import { avisoDeVerificacion, CORREO_FIJO } from "@/lib/leads/avisos";
import type { LeadDeSesion, ResultadoContacto } from "@/lib/leads/servidor";
import { dejarContacto } from "./acciones";

// Sin Auth ni base: `dejarContacto` (HU-068) con todo lo de afuera inventado. Hasta HU-032 no tenía prueba unitaria. Aquí
// se fija la guarda del equipo, el aviso de P-23 (idéntico al de antes con «agendando») y la guarda del correo fijo de un
// Estudiante (D-55 b): si manda otro correo por fuera de la pantalla, se dice y no se llama a registrarContacto.

const sesion = vi.hoisted(() => ({ actual: null as { idUsuario: string; rol: Rol | null } | null }));
const servidor = vi.hoisted(() => ({ leadDeLaSesion: vi.fn(), registrarContacto: vi.fn() }));
const almacen = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => sesion.actual }));
vi.mock("@/lib/leads/servidor", () => ({ leadDeLaSesion: servidor.leadDeLaSesion, registrarContacto: servidor.registrarContacto }));
vi.mock("next/headers", () => ({ cookies: async () => almacen }));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`redirect:${ruta}`);
  },
}));

const ID_SESION = "5a5a5a5a-0000-4000-8000-000000000068";
const LEAD: LeadDeSesion = { id: "1e1e1e1e-0000-4000-8000-000000000068", nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numeroTelefono: null };
const ESTADO = { error: null, aviso: null, valores: {} };

const como = (rol: Rol | null) => {
  sesion.actual = { idUsuario: ID_SESION, rol };
};

function formulario(campos: Record<string, string> = {}): FormData {
  const datos = new FormData();
  const todos = { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numero_telefono: "", acepta_tratamiento_datos: "si", ...campos };
  for (const [clave, valor] of Object.entries(todos)) datos.set(clave, valor);
  return datos;
}

beforeEach(() => {
  sesion.actual = null;
  for (const mock of [...Object.values(servidor), almacen.get]) mock.mockReset();
  almacen.get.mockReturnValue(undefined);
  servidor.registrarContacto.mockResolvedValue({ resultado: "lead" } satisfies ResultadoContacto);
  servidor.leadDeLaSesion.mockResolvedValue(LEAD);
});

describe("dejarContacto: las guardas", () => {
  it("sin sesión pide recargar y no guarda nada", async () => {
    expect(await dejarContacto(ESTADO, formulario())).toMatchObject({ error: "No pudimos verificar tu navegador. Recarga la página e intenta de nuevo." });
    expect(servidor.registrarContacto).not.toHaveBeenCalled();
  });

  it("un monitor o un admin con su cuenta no agenda como estudiante", async () => {
    for (const rol of ["monitor", "admin"] as const) {
      como(rol);
      const estado = await dejarContacto(ESTADO, formulario());
      expect(estado.error, rol).toContain("Estás con tu cuenta del equipo de Calibra");
    }
    expect(servidor.registrarContacto).not.toHaveBeenCalled();
    expect(servidor.leadDeLaSesion).not.toHaveBeenCalled();
  });

  it("sin la autorización de datos no guarda nada", async () => {
    como("anonimo");
    const datos = formulario();
    datos.delete("acepta_tratamiento_datos");

    expect((await dejarContacto(ESTADO, datos)).error).toContain("autorización");
    expect(servidor.registrarContacto).not.toHaveBeenCalled();
  });
});

describe("dejarContacto: guardar y seguir", () => {
  it("un visitante guarda su contacto y vuelve a la ruta pedida", async () => {
    como("anonimo");

    await expect(dejarContacto(ESTADO, formulario({ siguiente: "/agendar/reserva" }))).rejects.toThrow(new Error("redirect:/agendar/reserva"));
    expect(servidor.registrarContacto).toHaveBeenCalledTimes(1);
    expect(servidor.registrarContacto.mock.calls[0][0]).toMatchObject({
      idSesion: ID_SESION,
      contacto: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", numeroTelefono: null },
      siguiente: "/agendar/reserva",
    });
    // Un visitante no es Estudiante: no se lee su Lead para la guarda del correo fijo.
    expect(servidor.leadDeLaSesion).not.toHaveBeenCalled();
  });

  it("el aviso de P-23 es el de siempre, con «sigues agendando aquí»", async () => {
    como("anonimo");
    for (const envio of ["enviado", "frenado", "fallido"] as const) {
      servidor.registrarContacto.mockResolvedValueOnce({ resultado: "verificar", envio });

      const estado = await dejarContacto(ESTADO, formulario());
      expect(estado.aviso, envio).toBe(avisoDeVerificacion(envio, "agendando"));
      expect(estado.error, envio).toBeNull();
    }
    servidor.registrarContacto.mockResolvedValueOnce({ resultado: "verificar", envio: "enviado" });
    expect((await dejarContacto(ESTADO, formulario())).aviso).toContain("ábrelo en este navegador y sigues agendando aquí");
  });

  it("un error de registrarContacto (el tope de correos) se devuelve con lo escrito", async () => {
    como("anonimo");
    servidor.registrarContacto.mockResolvedValueOnce({ resultado: "error", error: "Probaste varios correos seguidos." });

    expect(await dejarContacto(ESTADO, formulario())).toMatchObject({
      error: "Probaste varios correos seguidos.",
      valores: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co" },
    });
  });

  it("si registrarContacto lanza, no se ve el error del servidor", async () => {
    como("anonimo");
    vi.spyOn(console, "error").mockImplementation(() => {});
    servidor.registrarContacto.mockRejectedValueOnce(new Error("se cayó la base"));

    expect((await dejarContacto(ESTADO, formulario())).error).toBe("No pudimos guardar tus datos. Intenta de nuevo.");
    vi.restoreAllMocks();
  });
});

describe("dejarContacto: el correo de un Estudiante queda fijo (D-55 b, criterio 12)", () => {
  beforeEach(() => como("estudiante"));

  it("con otro correo responde el mensaje, con lo escrito, y NO llama a registrarContacto: no se cambia nada", async () => {
    const estado = await dejarContacto(ESTADO, formulario({ correo: "otro@uniandes.edu.co", nombre: "Camila R." }));

    expect(estado).toEqual({
      error: CORREO_FIJO,
      aviso: null,
      valores: { nombre: "Camila R.", correo: "otro@uniandes.edu.co", numero_telefono: "" },
    });
    expect(servidor.leadDeLaSesion).toHaveBeenCalledWith(ID_SESION);
    expect(servidor.registrarContacto).not.toHaveBeenCalled();
  });

  it("el correo se compara normalizado (mayúsculas y espacios): el mismo correo escrito distinto pasa", async () => {
    await expect(dejarContacto(ESTADO, formulario({ correo: "  CAMILA@Uniandes.edu.co ", nombre: "Camila R.", siguiente: "/cuenta/crear" }))).rejects.toThrow(new Error("redirect:/cuenta/crear"));
    expect(servidor.registrarContacto).toHaveBeenCalledTimes(1);
    expect(servidor.registrarContacto.mock.calls[0][0].contacto).toMatchObject({ nombre: "Camila R.", correo: "camila@uniandes.edu.co" });
  });

  it("con su mismo correo cambia el nombre y el teléfono", async () => {
    await expect(dejarContacto(ESTADO, formulario({ nombre: "Camila Rojas Pérez", numero_telefono: "3001234567" }))).rejects.toThrow(new Error("redirect:/"));
    expect(servidor.registrarContacto.mock.calls[0][0].contacto).toEqual({
      nombre: "Camila Rojas Pérez",
      correo: "camila@uniandes.edu.co",
      numeroTelefono: "+573001234567",
    });
  });

  it("el Lead sale de la base, no del formulario; si no se puede leer, no guarda", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    servidor.leadDeLaSesion.mockRejectedValueOnce(new Error("falló"));

    expect((await dejarContacto(ESTADO, formulario())).error).toBe("No pudimos guardar tus datos. Intenta de nuevo.");
    expect(servidor.registrarContacto).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("un correo que no es un correo da el error de siempre, antes de leer el Lead", async () => {
    expect((await dejarContacto(ESTADO, formulario({ correo: "no-es-un-correo" }))).error).toMatch(/correo válido/);
    expect(servidor.leadDeLaSesion).not.toHaveBeenCalled();
    expect(servidor.registrarContacto).not.toHaveBeenCalled();
  });
});
