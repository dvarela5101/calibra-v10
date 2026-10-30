import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILA_DE_EJEMPLO } from "../../../../../../pruebas/diagnostico-sembrado";
import type { Rol } from "@/lib/auth/roles";
import { ErrorDeResultadoGuardado, proyectarResultado } from "@/lib/diagnostico/mostrar";

// HU-009: la página del resultado, sin navegador ni base: la sesión y la lectura son inventadas y `notFound()` lanza, como en
// Next. Se fija que la lectura solo ocurre para una persona con sesión, y que todo lo demás es «no encontramos ese resultado».
// Quién es el dueño lo decide la base (pgTAP); el 404 real y su `not-found.tsx` los ve la e2e.

const falsos = vi.hoisted(() => ({
  conexion: vi.fn(),
  sesion: null as { idUsuario: string; rol: Rol | null } | null,
  cliente: {} as object | null,
  leer: vi.fn(),
  lead: vi.fn(),
}));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => falsos.sesion }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => falsos.cliente }));
vi.mock("@/lib/diagnostico/lectura", () => ({ leerMiDiagnostico: (...args: unknown[]) => falsos.leer(...args) }));
vi.mock("next/server", () => ({ connection: async () => falsos.conexion() }));
// HU-010: si la sesión ya es Lead decide qué va en la ranura. La acción y la espera de la sesión anónima no corren aquí.
vi.mock("@/lib/leads/servidor", () => ({ leadDeLaSesion: (...args: unknown[]) => falsos.lead(...args) }));
vi.mock("./acciones", () => ({ dejarContactoDelDiagnostico: async () => ({ error: null, aviso: null, valores: {} }) }));
vi.mock("@/components/captcha/useExigirSesionAnonima", () => ({
  useExigirSesionAnonima: () => ({ alEnviar: () => false, aviso: null, verificando: false, reintentar: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

import ResultadoDeUnDiagnostico, { metadata } from "./page";

const ID = FILA_DE_EJEMPLO.id_diagnostico;
const PERSONA = { idUsuario: "5e000000-0000-4000-8000-000000000001", rol: "anonimo" as const };
const MENSAJE_DE_ERROR = "No pudimos cargar tu resultado. Recarga la página; si sigue igual, inténtalo más tarde.";

async function abrir(id: string): Promise<string> {
  return renderToStaticMarkup(await ResultadoDeUnDiagnostico({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  falsos.sesion = PERSONA;
  falsos.cliente = {};
  falsos.conexion.mockReset();
  falsos.leer.mockReset().mockResolvedValue(proyectarResultado(FILA_DE_EJEMPLO));
  falsos.lead.mockReset().mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("/diagnostico/resultado/[id]: la página", () => {
  it("es personal: no se indexa, y el título de la pestaña es «Tu resultado · Calibra»", () => {
    expect(metadata.title).toBe("Tu resultado · Calibra");
    expect(metadata.robots).toEqual({ index: false });
  });

  it("nunca se prerenderiza: pide la conexión aunque el id no sirva (criterio 13, Cache-Control privado)", async () => {
    await expect(abrir("no-es-un-uuid")).rejects.toThrow("notFound");
    expect(falsos.conexion).toHaveBeenCalledOnce();
  });

  it("lee con el cliente de la sesión y solo con el id, y pinta el resultado", async () => {
    const html = await abrir(ID);
    expect(falsos.leer).toHaveBeenCalledExactlyOnceWith(falsos.cliente, ID);
    expect(html).toContain("Tu resultado");
    expect(html).toContain("5 de 8 correctas");
    expect(html).toContain("Respondiste 8 preguntas");
    expect(html).toContain("Física II");
  });

  it("HU-010: sin Lead, después del resultado pide el contacto con el título y el botón de D-68 a", async () => {
    const html = await abrir(ID);
    expect(falsos.lead).toHaveBeenCalledExactlyOnceWith(PERSONA.idUsuario);
    expect(html).toContain("Déjanos tu contacto para agendar una monitoría y que Calibra te pueda escribir");
    expect(html).toContain("Guardar mis datos");
    expect(html).toContain(`name="id_diagnostico" value="${ID}"`);
    // P-34: el formulario va después del resultado, no lo tapa.
    expect(html.indexOf("5 de 8 correctas")).toBeLessThan(html.indexOf("<form"));
    expect(html).not.toContain("Ya tenemos tu contacto");
  });

  it("HU-010 (D-68 b): si la sesión ya es Lead, no hay formulario: «Ya tenemos tu contacto» y el enlace para cambiar sus datos", async () => {
    falsos.lead.mockResolvedValue({ id: "l1", nombre: "Ana", correo: "ana@calibra.test", numeroTelefono: null });
    const html = await abrir(ID);
    expect(html).toContain("Ya tenemos tu contacto");
    expect(html).toContain(`href="/agendar/contacto?editar=1&amp;siguiente=${encodeURIComponent(`/diagnostico/resultado/${ID}`)}"`);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("ana@calibra.test");
  });

  it("HU-010 (P-34): si no se sabe si es Lead, el resultado sale completo y sin el bloque; el error queda en el log", async () => {
    falsos.lead.mockRejectedValue(new Error("caída"));
    const html = await abrir(ID);
    expect(html).toContain("5 de 8 correctas");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Ya tenemos tu contacto");
    expect(console.error).toHaveBeenCalled();
  });

  it("no dice nada de repetido", async () => {
    expect((await abrir(ID)).toLowerCase()).not.toContain("repetid");
  });
});

describe("/diagnostico/resultado/[id]: todo lo demás es notFound() y no llama a la lectura (M48)", () => {
  it.each([["no-es-un-uuid"], [""], ["123"], [`${ID}x`], [`${ID} `]])("el id %j que no es un UUID", async (id) => {
    await expect(abrir(id)).rejects.toThrow("notFound");
    expect(falsos.leer).not.toHaveBeenCalled();
  });

  it("sin sesión", async () => {
    falsos.sesion = null;
    await expect(abrir(ID)).rejects.toThrow("notFound");
    expect(falsos.leer).not.toHaveBeenCalled();
  });

  it.each(["monitor", "admin"] as const)("una cuenta de %s", async (rol) => {
    falsos.sesion = { idUsuario: PERSONA.idUsuario, rol };
    await expect(abrir(ID)).rejects.toThrow("notFound");
    expect(falsos.leer).not.toHaveBeenCalled();
  });

  it("sin fila: no existe, no es suyo o es de otra sesión", async () => {
    falsos.leer.mockResolvedValue(null);
    await expect(abrir(ID)).rejects.toThrow("notFound");
    expect(falsos.leer).toHaveBeenCalledOnce();
  });
});

describe("/diagnostico/resultado/[id]: si falla la carga, el mensaje de error y no la pantalla de error de Next", () => {
  it("la lectura lanza", async () => {
    falsos.leer.mockRejectedValue(new Error("Falló «mi_diagnostico» (código 57014)."));
    const html = await abrir(ID);
    expect(html).toContain(MENSAJE_DE_ERROR);
    expect(html).toMatch(/<p role="alert"[^>]*>No pudimos cargar tu resultado/);
    expect(html).not.toContain("Ver el detalle por habilidad");
  });

  it("el resultado guardado está corrupto", async () => {
    falsos.leer.mockRejectedValue(new ErrorDeResultadoGuardado());
    expect(await abrir(ID)).toContain(MENSAJE_DE_ERROR);
  });

  it("no hay cliente de Supabase", async () => {
    falsos.cliente = null;
    expect(await abrir(ID)).toContain(MENSAJE_DE_ERROR);
    expect(falsos.leer).not.toHaveBeenCalled();
  });

  it("no es un notFound(): la persona sabe que fue un fallo", async () => {
    falsos.leer.mockRejectedValue(new Error("x"));
    await expect(abrir(ID)).resolves.toContain("alert");
  });
});
