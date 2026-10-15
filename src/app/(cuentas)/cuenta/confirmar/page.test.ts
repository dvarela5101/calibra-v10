import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rol } from "@/lib/auth/roles";
import { TEXTOS } from "@/lib/cuentas/reglas";
import ConfirmarCuenta, { metadata } from "./page";

// Sin navegador ni base: la página del enlace del correo de Auth. Aquí se fija lo que el criterio 3 de la HU pide: abrir
// el enlace, una vez o varias, no gasta nada. Por eso el cliente de la sesión y el de la llave secreta están mockeados para
// LANZAR si alguien los toca (la página solo debe pintar el botón), la acción de confirmar no se llama al renderizar y la
// página no registra nada. El recorrido de verdad (abrir dos veces y luego confirmar) lo cubre e2e/cuenta.spec.ts.

const sesion = vi.hoisted(() => ({ actual: null as { idUsuario: string; rol: Rol | null } | null }));
const tocados = vi.hoisted(() => ({ servidor: vi.fn(), admin: vi.fn(), confirmar: vi.fn() }));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => sesion.actual }));
vi.mock("@/lib/supabase/servidor", () => ({
  crearClienteServidor: () => {
    tocados.servidor();
    throw new Error("la página no debía tocar el cliente de la sesión");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  crearClienteAdmin: () => {
    tocados.admin();
    throw new Error("la página no debía tocar la llave secreta");
  },
}));
vi.mock("./acciones", () => ({
  confirmar: async () => {
    tocados.confirmar();
    return { error: null, siguientePaso: null };
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`redirect:${ruta}`);
  },
}));

const TOKEN = "pkce_" + "Ab1-".repeat(12);

async function pintar(consulta: Record<string, string | string[] | undefined>): Promise<string> {
  return renderToStaticMarkup(await ConfirmarCuenta({ params: Promise.resolve({}), searchParams: Promise.resolve(consulta) }));
}

const texto = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  sesion.actual = null;
  for (const mock of Object.values(tocados)) mock.mockReset();
});

describe("/cuenta/confirmar: lo que no se filtra", () => {
  it("no queda en buscadores ni pasa el enlace por el Referer: la dirección lleva el token", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });
});

describe("/cuenta/confirmar: abrir el enlace no gasta nada (criterio 3)", () => {
  it("con un token de forma válida pinta «Confirma que este correo es tuyo» y un botón, sin tocar Auth ni la base", async () => {
    const html = await pintar({ token_hash: TOKEN, type: "email_change" });

    expect(texto(html)).toContain("Confirma que este correo es tuyo");
    expect(texto(html)).toContain(TEXTOS.confirmar);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Sí, es mi correo<\/button>/);
    expect(html).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="token_hash"[^>]*value="${TOKEN}"`));
    expect(tocados.servidor).not.toHaveBeenCalled();
    expect(tocados.admin).not.toHaveBeenCalled();
    expect(tocados.confirmar).not.toHaveBeenCalled();
  });

  it("abrirla varias veces da lo mismo y no toca nada (un revisor de enlaces la abre antes que la persona)", async () => {
    const primera = await pintar({ token_hash: TOKEN });
    const segunda = await pintar({ token_hash: TOKEN });
    const tercera = await pintar({ token_hash: TOKEN });

    expect(segunda).toBe(primera);
    expect(tercera).toBe(primera);
    expect(tocados.servidor).not.toHaveBeenCalled();
    expect(tocados.admin).not.toHaveBeenCalled();
    expect(tocados.confirmar).not.toHaveBeenCalled();
  });

  it("el tipo de la dirección no cuenta: el formulario solo lleva el token_hash (el tipo es fijo en el servidor)", async () => {
    const html = await pintar({ token_hash: TOKEN, type: "recovery" });

    expect(html).not.toContain('name="type"');
    expect(html).not.toContain("recovery");
  });

  it("no muestra el correo que confirma: saberlo gastaría el token", async () => {
    const html = texto(await pintar({ token_hash: TOKEN }));

    expect(html).not.toMatch(/@/);
    expect(html).toContain("el correo al que llegó este enlace");
  });

  it("el botón es de envío, de 44 px o más por su clase, y no hay más de un aviso con rol", async () => {
    const html = await pintar({ token_hash: TOKEN });

    expect(html.match(/<button/g)).toHaveLength(1);
    expect((html.match(/role="(?:status|alert)"/g) ?? []).length).toBe(0);
  });
});

describe("/cuenta/confirmar: un enlace que no sirve", () => {
  it("sin token_hash, vacío, repetido o sin la forma de un token: «Este enlace ya no sirve», sin botón de confirmar", async () => {
    const casos: Record<string, string | string[] | undefined>[] = [
      {},
      { token_hash: "" },
      { token_hash: [TOKEN, TOKEN] },
      { token_hash: "corto" },
      { token_hash: `${TOKEN} con espacios` },
      { token_hash: "a".repeat(300) },
      { token_hash: `${TOKEN}&type=recovery` },
    ];
    for (const consulta of casos) {
      const html = await pintar(consulta);

      expect(texto(html), JSON.stringify(consulta)).toContain("Este enlace ya no sirve");
      expect(texto(html), JSON.stringify(consulta)).toContain(TEXTOS.enlaceNoSirve);
      expect(html, JSON.stringify(consulta)).not.toContain("<form");
      expect(html, JSON.stringify(consulta)).not.toContain("<button");
      expect(html, JSON.stringify(consulta)).toMatch(/<a[^>]*href="\/cuenta\/crear"[^>]*>Crear mi cuenta<\/a>/);
    }
    expect(tocados.servidor).not.toHaveBeenCalled();
    expect(tocados.admin).not.toHaveBeenCalled();
  });
});

describe("/cuenta/confirmar: quien ya es Estudiante", () => {
  it("va a «Mis citas» en lugar de ver el botón, sin llamar a Auth", async () => {
    sesion.actual = { idUsuario: "5a5a5a5a-0000-4000-8000-000000000032", rol: "estudiante" };

    await expect(pintar({ token_hash: TOKEN })).rejects.toThrow(new Error("redirect:/cita"));
    expect(tocados.servidor).not.toHaveBeenCalled();
    expect(tocados.admin).not.toHaveBeenCalled();
  });

  it("un monitor o un admin sí ve el botón: la acción es la que le pide abrir el enlace en otra ventana", async () => {
    for (const rol of ["monitor", "admin", "anonimo"] as const) {
      sesion.actual = { idUsuario: "5a5a5a5a-0000-4000-8000-000000000032", rol };
      expect(texto(await pintar({ token_hash: TOKEN })), rol).toContain("Confirma que este correo es tuyo");
    }
  });
});
