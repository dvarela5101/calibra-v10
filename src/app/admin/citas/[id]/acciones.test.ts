import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMBIOS_DE_LA_CITA,
  MENSAJE_DE_FALLO,
  MENSAJES_DE_AUTORIZACION,
  MENSAJES_DEL_FORMULARIO,
  RESULTADOS_DE_AUTORIZACION,
} from "@/lib/admin/citas-reglas";
import { autorizar, type EstadoAutorizacion } from "./acciones";

// HU-052 sin navegador ni base: la acción con la sesión y la autorización inventadas. Aquí se fija a dónde vuelve con cada
// resultado, que la acción no manda ningún correo (los anota la base y salen por los procesos programados), que un error
// no vacía lo escrito, que la nota no llega al log y que un formulario inválido no llega a la base. La base de verdad la
// cubre integracion/cancelar-fuera-de-plazo.test.ts.

const ID = "52525252-0000-4000-8000-000000000052";
const RUTA = `/admin/citas/${ID}`;

const h = vi.hoisted(() => {
  class Redireccion extends Error {
    constructor(readonly destino: string) {
      super(`redirect:${destino}`);
    }
  }
  return {
    Redireccion,
    cliente: { soy: "el cliente de la sesión" } as { soy: string } | null,
    exigirRol: vi.fn<(rol: string, ruta: string) => Promise<{ idUsuario: string; rol: string }>>(async () => ({
      idUsuario: "a0a0a0a0-0000-4000-8000-000000000052",
      rol: "admin",
    })),
    autorizarCancelacion: vi.fn(),
    revalidatePath: vi.fn(),
    enviarCorreo: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/admin/citas", () => ({ autorizarCancelacion: h.autorizarCancelacion }));
vi.mock("@/lib/correo/servidor", () => ({ enviarCorreoDesdeServidor: h.enviarCorreo, urlDelSitio: (ruta: string) => ruta }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));

const INICIAL: EstadoAutorizacion = { error: null, valores: { categoria: "", nota: "" } };

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

/** Lo que hizo la acción: a dónde redirigió o qué estado devolvió. */
async function enviar(campos: Record<string, string>): Promise<{ destino: string } | { estado: EstadoAutorizacion }> {
  try {
    return { estado: await autorizar(INICIAL, formulario(campos)) };
  } catch (error) {
    if (error instanceof h.Redireccion) return { destino: error.destino };
    throw error;
  }
}

const FUERZA_MAYOR = { id_monitoria: ID, categoria: "fuerza_mayor", nota: " Accidente de tránsito. " };
const OTRO = { id_monitoria: ID, categoria: "otro", nota: "Un error nuestro." };

beforeEach(() => {
  h.cliente = { soy: "el cliente de la sesión" };
  h.exigirRol.mockClear();
  h.autorizarCancelacion.mockReset();
  h.revalidatePath.mockClear();
  h.enviarCorreo.mockClear();
});

describe("autorizar (HU-052): lo que se guardó", () => {
  it("vuelve a la cita con el éxito, refresca la bandeja, la lista y la página, y no manda correos", async () => {
    h.autorizarCancelacion.mockResolvedValue("autorizada");
    expect(await enviar(FUERZA_MAYOR)).toEqual({ destino: `${RUTA}?autorizada=1` });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", RUTA);
    // Con la sesión del admin, la misma que autoriza, y con la nota recortada.
    expect(h.autorizarCancelacion).toHaveBeenCalledWith(h.cliente, { idMonitoria: ID, categoria: "fuerza_mayor", nota: "Accidente de tránsito." });
    expect(h.revalidatePath.mock.calls.map(([ruta]) => ruta).sort()).toEqual(["/admin", "/admin/citas", RUTA].sort());
    expect(h.enviarCorreo).not.toHaveBeenCalled();
  });

  it("sin nota (con fuerza mayor o falla de Calibra) la manda como ninguna; la de puros espacios también", async () => {
    h.autorizarCancelacion.mockResolvedValue("autorizada");
    await enviar({ id_monitoria: ID, categoria: "falla_de_calibra" });
    expect(h.autorizarCancelacion).toHaveBeenLastCalledWith(h.cliente, { idMonitoria: ID, categoria: "falla_de_calibra", nota: null });
    await enviar({ ...FUERZA_MAYOR, nota: " \n\t " });
    expect(h.autorizarCancelacion).toHaveBeenLastCalledWith(h.cliente, { idMonitoria: ID, categoria: "fuerza_mayor", nota: null });
  });

  it("acepta el id en mayúsculas y con espacios: lo normaliza antes de usarlo", async () => {
    h.autorizarCancelacion.mockResolvedValue("autorizada");
    expect(await enviar({ ...FUERZA_MAYOR, id_monitoria: ` ${ID.toUpperCase()} ` })).toEqual({ destino: `${RUTA}?autorizada=1` });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", RUTA);
    expect(h.autorizarCancelacion).toHaveBeenCalledWith(h.cliente, expect.objectContaining({ idMonitoria: ID }));
  });

  it("la sesión se comprueba antes de leer el formulario y de llamar a la base", async () => {
    h.autorizarCancelacion.mockResolvedValue("autorizada");
    await enviar(FUERZA_MAYOR);
    expect(h.exigirRol.mock.invocationCallOrder[0]).toBeLessThan(h.autorizarCancelacion.mock.invocationCallOrder[0]);
  });
});

describe("autorizar: lo que no se guardó", () => {
  it.each(CAMBIOS_DE_LA_CITA)("%s cambió mientras el admin miraba: vuelve a la cita, que se pinta como está ahora", async (resultado) => {
    h.autorizarCancelacion.mockResolvedValue(resultado);
    expect(await enviar(FUERZA_MAYOR)).toEqual({ destino: `${RUTA}?error=${resultado}` });
    expect(h.revalidatePath.mock.calls.map(([ruta]) => ruta).sort()).toEqual(["/admin", "/admin/citas", RUTA].sort());
  });

  it.each(["categoria_invalida", "nota_invalida", "no_existe", "sin_permiso", "sin_sesion"] as const)(
    "%s se dice en el formulario, con lo escrito sin recortar",
    async (resultado) => {
      h.autorizarCancelacion.mockResolvedValue(resultado);
      expect(await enviar(FUERZA_MAYOR)).toEqual({
        estado: { error: MENSAJES_DE_AUTORIZACION[resultado], valores: { categoria: "fuerza_mayor", nota: FUERZA_MAYOR.nota } },
      });
      // Nada se refresca ni se redirige: no pasó nada.
      expect(h.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("cada resultado de la base termina en una redirección o en un mensaje: ninguno queda sin destino", async () => {
    for (const resultado of RESULTADOS_DE_AUTORIZACION) {
      h.autorizarCancelacion.mockResolvedValue(resultado);
      const hecho = await enviar(OTRO);
      if ("destino" in hecho) {
        const esperado = resultado === "autorizada" ? "autorizada=1" : `error=${resultado}`;
        expect(hecho.destino, resultado).toBe(`${RUTA}?${esperado}`);
      } else {
        expect(hecho.estado.error, resultado).toBe(MENSAJES_DE_AUTORIZACION[resultado as keyof typeof MENSAJES_DE_AUTORIZACION]);
      }
    }
  });

  it("si la base falla, pide intentar de nuevo sin perder lo escrito y sin poner la nota en el log", async () => {
    h.autorizarCancelacion.mockRejectedValue(new Error("No se pudo autorizar la cancelación: 08006 se cayó la base"));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const nota = "Dato sensible de quien agendó";
    expect(await enviar({ ...OTRO, nota })).toEqual({ estado: { error: MENSAJE_DE_FALLO, valores: { categoria: "otro", nota } } });
    expect(espia).toHaveBeenCalled();
    expect(JSON.stringify(espia.mock.calls)).not.toContain("Dato sensible");
    expect(JSON.stringify(espia.mock.calls)).toContain("se cayó la base");
    espia.mockRestore();
    // Un fallo no redirige ni refresca: el formulario sigue abierto con lo escrito.
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("sin las variables de Supabase pide intentar de nuevo, sin llamar a la base", async () => {
    h.cliente = null;
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar(OTRO)).toEqual({ estado: { error: MENSAJE_DE_FALLO, valores: { categoria: "otro", nota: OTRO.nota } } });
    espia.mockRestore();
    expect(h.autorizarCancelacion).not.toHaveBeenCalled();
  });

  it("una redirección de la autorización no se confunde con un fallo: el redirect queda fuera del try", async () => {
    // Si estuviera dentro, el `catch` la tomaría por un error y devolvería el mensaje de fallo en vez de redirigir.
    h.autorizarCancelacion.mockResolvedValue("autorizada");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enviar(FUERZA_MAYOR)).toEqual({ destino: `${RUTA}?autorizada=1` });
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it("se protege sola: sin admin, exigirRol redirige antes de leer o autorizar nada", async () => {
    h.exigirRol.mockRejectedValueOnce(new h.Redireccion("/ingresar"));
    expect(await enviar(FUERZA_MAYOR)).toEqual({ destino: "/ingresar" });
    expect(h.autorizarCancelacion).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("autorizar: un formulario inválido no llega a la base y conserva lo escrito", () => {
  it("sin una cita válida, la ruta de ingreso no lleva a una cita que no existe", async () => {
    expect(await enviar({ id_monitoria: "otro", categoria: "fuerza_mayor" })).toEqual({
      estado: { error: MENSAJES_DE_AUTORIZACION.no_existe, valores: { categoria: "fuerza_mayor", nota: "" } },
    });
    expect(h.exigirRol).toHaveBeenCalledWith("admin", "/admin");
    expect(h.autorizarCancelacion).not.toHaveBeenCalled();
  });

  it("sin motivo, o con uno fuera de la lista, pide escoger de la lista y no manda la nota a ningún lado", async () => {
    for (const categoria of [undefined, "", "x", "FUERZA_MAYOR"]) {
      const campos: Record<string, string> = categoria === undefined ? { id_monitoria: ID, nota: "Lo que escribí." } : { id_monitoria: ID, categoria, nota: "Lo que escribí." };
      expect(await enviar(campos), String(categoria)).toEqual({
        estado: { error: MENSAJES_DE_AUTORIZACION.categoria_invalida, valores: { categoria: categoria ?? "", nota: "Lo que escribí." } },
      });
    }
    expect(h.autorizarCancelacion).not.toHaveBeenCalled();
  });

  it("«Otro» sin nota, o con una nota de puros espacios y saltos de línea, pide la nota", async () => {
    for (const nota of [undefined, "", "   ", " \r\n \r\n "]) {
      const campos: Record<string, string> = nota === undefined ? { id_monitoria: ID, categoria: "otro" } : { id_monitoria: ID, categoria: "otro", nota };
      expect(await enviar(campos), JSON.stringify(nota)).toEqual({
        estado: { error: MENSAJES_DEL_FORMULARIO.nota_obligatoria, valores: { categoria: "otro", nota: nota ?? "" } },
      });
    }
    expect(h.autorizarCancelacion).not.toHaveBeenCalled();
  });

  it("una nota demasiado larga no llega a la base, y se cuenta por caracteres", async () => {
    const larga = "a".repeat(501);
    expect(await enviar({ ...FUERZA_MAYOR, nota: larga })).toEqual({
      estado: { error: MENSAJES_DEL_FORMULARIO.nota_larga, valores: { categoria: "fuerza_mayor", nota: larga } },
    });
    expect(h.autorizarCancelacion).not.toHaveBeenCalled();
    // 500 caracteres de cuatro bytes caben: el límite es de la base, en caracteres.
    h.autorizarCancelacion.mockResolvedValue("autorizada");
    expect(await enviar({ ...FUERZA_MAYOR, nota: "\u{1D11E}".repeat(500) })).toEqual({ destino: `${RUTA}?autorizada=1` });
  });

  it("los saltos de línea que manda el navegador (CRLF) cuentan uno: 500 caracteres en el campo llegan completos a la base, con LF", async () => {
    // 489 letras y 11 saltos: el campo las acepta (maxlength cuenta cada salto como uno) y el formulario envía 511 caracteres.
    const lineas = Array.from({ length: 12 }, (_, i) => "a".repeat(i < 9 ? 41 : 40));
    h.autorizarCancelacion.mockResolvedValue("autorizada");
    expect(await enviar({ ...FUERZA_MAYOR, nota: lineas.join("\r\n") })).toEqual({ destino: `${RUTA}?autorizada=1` });
    expect(h.autorizarCancelacion).toHaveBeenCalledWith(h.cliente, { idMonitoria: ID, categoria: "fuerza_mayor", nota: lineas.join("\n") });

    // Con un carácter más (501 ya normalizados) no llega a la base y devuelve lo escrito tal cual.
    h.autorizarCancelacion.mockClear();
    const demasiado = `${lineas.join("\r\n")}a`;
    expect(await enviar({ ...FUERZA_MAYOR, nota: demasiado })).toEqual({
      estado: { error: MENSAJES_DEL_FORMULARIO.nota_larga, valores: { categoria: "fuerza_mayor", nota: demasiado } },
    });
    expect(h.autorizarCancelacion).not.toHaveBeenCalled();
  });
});
