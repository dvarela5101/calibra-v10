import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { filtrarEvento, filtrarMigaDePan, limpiarTexto, limpiarUrl } from "./filtro";

const UUID = "3f2b8a64-1c9d-4e7a-8b25-6d0f4a9c1e37";

describe("limpiarTexto (HU-138)", () => {
  it("quita correos", () => {
    expect(limpiarTexto("No se envió a ana.perez+x@uniandes.edu.co")).toBe("No se envió a [correo]");
  });

  it("quita teléfonos con y sin formato", () => {
    expect(limpiarTexto("llamar al +57 300 123 4567")).toBe("llamar al [teléfono]");
    expect(limpiarTexto("celular 300-123-4567")).toBe("celular [teléfono]");
    expect(limpiarTexto("celular 3001234567")).toBe("celular [número]");
  });

  it("quita llaves de pago, de Supabase y tokens", () => {
    expect(limpiarTexto("llave: @ana.perez")).toBe("llave: [llave]");
    expect(limpiarTexto("falló con sb_secret_AbC123xyz")).toBe("falló con [llave]");
    expect(limpiarTexto("Authorization: Bearer abc.def-123")).toBe("Authorization: Bearer [token]");
    expect(limpiarTexto("jwt eyJhbGciOi.eyJzdWIiOiIx.firma123")).toBe("jwt [token]");
    expect(limpiarTexto(`hash ${"a1".repeat(20)}`)).toBe("hash [token]");
  });

  it("quita ids y la cadena de consulta de las URL dentro de un mensaje", () => {
    expect(limpiarTexto(`fetch a /cuenta/confirmar?token_hash=abc&type=email_change falló`)).toBe("fetch a /cuenta/confirmar falló");
    expect(limpiarTexto(`cita ${UUID} no existe`)).toBe("cita [id] no existe");
  });

  it("deja intacto un mensaje sin datos personales", () => {
    expect(limpiarTexto("Cannot read properties of undefined (reading 'id') el 2026-11-15")).toBe(
      "Cannot read properties of undefined (reading 'id') el 2026-11-15",
    );
  });
});

describe("limpiarUrl (HU-138)", () => {
  it("quita consulta, fragmento y credenciales, y reemplaza los ids de la ruta", () => {
    expect(limpiarUrl(`https://calibra-eight.vercel.app/reserva/${UUID}/pago?token=secreto#access_token=x`)).toBe(
      "https://calibra-eight.vercel.app/reserva/:id/pago",
    );
    expect(limpiarUrl("https://u:p@calibra-eight.vercel.app/ingresar")).toBe("https://calibra-eight.vercel.app/ingresar");
  });

  it("acepta rutas relativas y reemplaza segmentos con datos personales", () => {
    expect(limpiarUrl(`/admin/pagos/${UUID}/comprobante?x=1`)).toBe("/admin/pagos/:id/comprobante");
    expect(limpiarUrl("/buscar/ana%40uniandes.edu.co")).toBe("/buscar/:dato");
    expect(limpiarUrl("/monitor/agenda")).toBe("/monitor/agenda");
  });
});

describe("filtrarMigaDePan (HU-138)", () => {
  it("descarta la consola y limpia las URL de las demás", () => {
    expect(filtrarMigaDePan({ category: "console", message: "correo ana@uniandes.edu.co" })).toBeNull();
    expect(
      filtrarMigaDePan({
        category: "fetch",
        data: { url: `https://x.supabase.co/rest/v1/citas?id=eq.${UUID}`, method: "GET", status_code: 200, body: "secreto" },
      }),
    ).toEqual({ category: "fetch", data: { url: "https://x.supabase.co/rest/v1/citas", method: "GET", status_code: 200 } });
  });
});

describe("filtrarEvento (beforeSend, HU-138)", () => {
  it("quita usuario, cookies, cabeceras, cuerpo y consulta, y limpia el mensaje", () => {
    const evento = {
      type: undefined,
      user: { email: "ana@uniandes.edu.co", ip_address: "1.2.3.4" },
      request: {
        method: "POST",
        url: `https://calibra-eight.vercel.app/reserva/${UUID}?token=abc`,
        query_string: "token=abc",
        cookies: { sb: "secreto" },
        headers: { authorization: "Bearer abc", cookie: "sb=secreto" },
        data: { correo: "ana@uniandes.edu.co" },
      },
      exception: { values: [{ type: "Error", value: "falló para ana@uniandes.edu.co, cel 3001234567" }] },
      transaction: `GET /reserva/${UUID}`,
      contexts: { nextjs: { request_path: `/reserva/${UUID}?x=1`, router_kind: "App Router" } },
      extra: { cuerpo: "secreto" },
      breadcrumbs: [{ category: "console", message: "hola" }, { category: "navigation", data: { from: "/a?x=1", to: "/b" } }],
    } as unknown as ErrorEvent;

    const salida = filtrarEvento(evento);

    expect(salida.user).toBeUndefined();
    expect(salida.request).toEqual({ method: "POST", url: "https://calibra-eight.vercel.app/reserva/:id" });
    expect(salida.exception?.values?.[0].value).toBe("falló para [correo], cel [número]");
    expect(salida.transaction).toBe("GET /reserva/[id]");
    expect(salida.contexts?.nextjs).toEqual({ request_path: "/reserva/:id", router_kind: "App Router" });
    expect(salida.extra).toBeUndefined();
    expect(salida.breadcrumbs).toEqual([{ category: "navigation", data: { from: "/a", to: "/b" } }]);
  });

  it("acepta un evento sin solicitud ni excepciones", () => {
    expect(() => filtrarEvento({ message: "hola ana@uniandes.edu.co" } as unknown as ErrorEvent)).not.toThrow();
  });
});
