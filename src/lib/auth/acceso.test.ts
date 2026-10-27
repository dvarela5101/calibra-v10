import { describe, expect, it } from "vitest";
import { enlacesDeAcceso } from "./acceso";

// D-75 a: el acceso de la cabecera.

const resumen = (rol: Parameters<typeof enlacesDeAcceso>[0]) => enlacesDeAcceso(rol).map((e) => [e.texto, e.href]);

describe("enlacesDeAcceso", () => {
  it("sin sesión o con la sesión anónima: «Iniciar sesión» y «Registrarse», este como botón", () => {
    for (const rol of [null, "anonimo"] as const) {
      expect(resumen(rol), String(rol)).toEqual([
        ["Iniciar sesión", "/ingresar"],
        ["Registrarse", "/registrarse"],
      ]);
      expect(enlacesDeAcceso(rol).map((e) => e.principal)).toEqual([false, true]);
    }
  });

  it("con cuenta, un solo enlace a lo suyo", () => {
    expect(resumen("admin")).toEqual([["Mi panel", "/admin"]]);
    expect(resumen("monitor")).toEqual([["Mi panel", "/monitor"]]);
    expect(resumen("estudiante")).toEqual([["Mis citas", "/cita"]]);
  });
});
