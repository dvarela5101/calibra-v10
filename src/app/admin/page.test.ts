import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bandeja } from "@/lib/admin/bandeja";
import PanelAdmin from "./page";

// Sin navegador ni base: la bandeja con la sesión y una bandeja vacía inventadas, y se lee el HTML. Aquí solo se fijan
// los avisos que dejan las acciones al volver a /admin: reabrir (HU-025, `?reembolso=`) y lo que la página de un
// reembolso no puede decir al reenviar su enlace (HU-026, `?reenvio=`). Las secciones las cubre BandejaAdmin.test.ts.

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: async () => ({ idUsuario: "a0a0a0a0-0000-4000-8000-000000000026", rol: "admin" }) }));
vi.mock("@/lib/supabase/servidor", () => ({
  crearClienteServidor: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { nombre: "Admin Uno" } }) }) }) }),
  }),
}));
vi.mock("@/lib/admin/bandeja", () => ({ cargarBandeja: async () => VACIA }));
vi.mock("./acciones", () => ({ reabrir: async () => {} }));
vi.mock("@/lib/auth/acciones", () => ({ cerrarSesion: async () => {} }));

const VACIA: Bandeja = {
  pagos: [],
  pagosVencidosDeOtros: [],
  pagosPorCobrarOAsumir: [],
  reembolsos: { esperandoLlave: [], pendientes: [] },
  reembolsosCerrados: [],
  reportes: [],
  desembolsos: [],
  correosSinEnviar: [],
  contadores: {
    pagos: 0,
    pagosVencidosDeOtros: 0,
    pagosPorCobrarOAsumir: 0,
    reembolsos: 0,
    reembolsosEsperandoLlave: 0,
    reembolsosPendientes: 0,
    reembolsosCerrados: 0,
    reportes: 0,
    desembolsos: 0,
    correosSinEnviar: 0,
  },
};

const pintar = async (consulta: Record<string, string>) =>
  renderToStaticMarkup(await PanelAdmin({ params: Promise.resolve({}), searchParams: Promise.resolve(consulta) }));

describe("La bandeja: los avisos de las acciones de reembolsos", () => {
  it.each([
    ["no_encontrado", "No encontramos este reembolso."],
    ["sin_permiso", "Solo un admin activo puede reenviar el enlace."],
    ["sin_sesion", "Solo un admin activo puede reenviar el enlace."],
  ])("HU-026: reenviar vuelve con %s, que la página del reembolso no puede decir, y lo dice arriba como alerta", async (reenvio, texto) => {
    expect(await pintar({ reenvio })).toMatch(new RegExp(`<p role="alert"[^>]*>${texto.replace(/\./g, "\\.")}</p>`));
  });

  it("los demás desenlaces de reenviar se dicen en la página del reembolso: en la bandeja no se anuncian", async () => {
    for (const reenvio of ["reenviado", "cerrado", "ya_entregada", "fallo"]) {
      expect(await pintar({ reenvio }), reenvio).not.toMatch(/<p role="(status|alert)"/);
    }
  });

  it("HU-025: reabrir sigue diciendo lo que pasó", async () => {
    expect(await pintar({ reembolso: "reabierto" })).toMatch(/<p role="status"[^>]*>Reabriste el caso/);
  });
});
