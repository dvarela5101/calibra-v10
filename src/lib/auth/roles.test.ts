import { describe, expect, it } from "vitest";
import { comoRol, destinoPorRol, destinoTrasIngresar, rutaInternaSegura } from "./roles";

describe("comoRol", () => {
  it("acepta solo los roles conocidos", () => {
    expect(comoRol("admin")).toBe("admin");
    expect(comoRol("anonimo")).toBe("anonimo");
    expect(comoRol("superadmin")).toBeNull();
    expect(comoRol(null)).toBeNull();
  });
});

describe("destinoPorRol", () => {
  it("deja pasar al rol correcto", () => {
    expect(destinoPorRol("admin", "admin", "/admin")).toBeNull();
    expect(destinoPorRol("monitor", "monitor", "/monitor")).toBeNull();
  });

  it("manda a cada rol con panel a su propio panel", () => {
    expect(destinoPorRol("admin", "monitor", "/admin")).toBe("/monitor");
    expect(destinoPorRol("monitor", "admin", "/monitor")).toBe("/admin");
  });

  it("manda a iniciar sesión a quien no tiene panel", () => {
    for (const rol of [null, "anonimo", "estudiante"] as const) {
      expect(destinoPorRol("admin", rol, "/admin/pagos")).toBe("/ingresar?siguiente=%2Fadmin%2Fpagos");
    }
  });
});

describe("destinoTrasIngresar", () => {
  it("respeta la ruta pedida si es de su panel", () => {
    expect(destinoTrasIngresar("admin", "/admin/pagos")).toBe("/admin/pagos");
  });

  it("ignora rutas de otro panel o que solo empiezan igual", () => {
    expect(destinoTrasIngresar("monitor", "/admin")).toBe("/monitor");
    expect(destinoTrasIngresar("monitor", "/monitores-falsos")).toBe("/monitor");
  });

  it("sin panel, va al inicio", () => {
    expect(destinoTrasIngresar("estudiante", "/admin")).toBe("/");
    expect(destinoTrasIngresar(null, null)).toBe("/");
  });
});

describe("rutaInternaSegura", () => {
  it("acepta rutas internas", () => {
    expect(rutaInternaSegura("/monitor")).toBe("/monitor");
  });

  it("rechaza destinos externos o vacíos", () => {
    for (const ruta of ["https://otro.sitio", "//otro.sitio", "/\\otro.sitio", "", null, undefined]) {
      expect(rutaInternaSegura(ruta)).toBe("/");
    }
  });
});
