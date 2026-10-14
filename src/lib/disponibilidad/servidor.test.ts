import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/tipos";
import { cargarPerfiles } from "./servidor";

// HU-049 sin base: los perfiles de la lista con un cliente falso que responde o falla.

type Respuesta = { data: unknown; error: { code: string; message: string } | null };

function clienteQueResponde(respuesta: Respuesta) {
  const consulta = { select: vi.fn(), in: vi.fn() };
  consulta.select.mockReturnValue(consulta);
  consulta.in.mockResolvedValue(respuesta);
  const desde = vi.fn().mockReturnValue(consulta);
  return { cliente: { from: desde } as unknown as SupabaseClient<Database>, desde, consulta };
}

afterEach(() => vi.restoreAllMocks());

describe("cargarPerfiles", () => {
  it("lee solo los perfiles de los monitores de la lista y los indexa por monitor", async () => {
    const { cliente, desde, consulta } = clienteQueResponde({
      data: [{ id_monitor: "m1", carrera: "Física", semestre: 4, presentacion: "Hola" }],
      error: null,
    });
    const perfiles = await cargarPerfiles(cliente, ["m1", "m2"]);
    expect(desde).toHaveBeenCalledWith("perfil_monitor");
    expect(consulta.in).toHaveBeenCalledWith("id_monitor", ["m1", "m2"]);
    expect(perfiles.get("m1")).toEqual({ carrera: "Física", semestre: 4, presentacion: "Hola" });
    expect(perfiles.has("m2")).toBe(false);
  });

  it("sin monitores no consulta", async () => {
    const { cliente, desde } = clienteQueResponde({ data: [], error: null });
    expect((await cargarPerfiles(cliente, [])).size).toBe(0);
    expect(desde).not.toHaveBeenCalled();
  });

  it("si la lectura falla, la lista sigue sin perfiles y el código queda en el log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteQueResponde({ data: null, error: { code: "42501", message: "permiso denegado" } });
    const perfiles = await cargarPerfiles(cliente, ["m1"]);
    expect(perfiles.size).toBe(0);
    expect(log).toHaveBeenCalledWith("[monitores] no se pudieron leer los perfiles:", "42501");
  });
});
