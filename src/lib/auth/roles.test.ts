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
    // Quien no es Estudiante ni tiene panel no recibe la ruta pedida.
    expect(destinoTrasIngresar(null, "/privacidad")).toBe("/");
    expect(destinoTrasIngresar("anonimo", "/privacidad")).toBe("/");
  });

  it("el de monitor y el de admin no cambian con la rama del Estudiante", () => {
    expect(destinoTrasIngresar("monitor", null)).toBe("/monitor");
    expect(destinoTrasIngresar("monitor", "/privacidad")).toBe("/monitor");
    expect(destinoTrasIngresar("monitor", "/monitor/agenda")).toBe("/monitor/agenda");
    expect(destinoTrasIngresar("admin", "/monitor")).toBe("/admin");
    expect(destinoTrasIngresar("admin", "/admin/pagos")).toBe("/admin/pagos");
  });
});

describe("destinoTrasIngresar para un Estudiante (HU-032, criterio 16)", () => {
  it("llega a la ruta interna que pidió, con su consulta y su ancla", () => {
    expect(destinoTrasIngresar("estudiante", "/privacidad")).toBe("/privacidad");
    expect(destinoTrasIngresar("estudiante", "/cuenta/crear")).toBe("/cuenta/crear");
    expect(destinoTrasIngresar("estudiante", "/cita/5a5a5a5a-0000-4000-8000-000000000019")).toBe(
      "/cita/5a5a5a5a-0000-4000-8000-000000000019",
    );
    expect(destinoTrasIngresar("estudiante", "/monitores?materia=X#lista")).toBe("/monitores?materia=X#lista");
  });

  it("sin ruta, va a la portada", () => {
    expect(destinoTrasIngresar("estudiante", null)).toBe("/");
    expect(destinoTrasIngresar("estudiante", "")).toBe("/");
    expect(destinoTrasIngresar("estudiante", "/")).toBe("/");
  });

  it("una ruta pública que solo empieza como un panel se respeta: /monitores no es /monitor", () => {
    expect(destinoTrasIngresar("estudiante", "/monitores")).toBe("/monitores");
    expect(destinoTrasIngresar("estudiante", "/monitores?materia=X")).toBe("/monitores?materia=X");
    expect(destinoTrasIngresar("estudiante", "/administracion")).toBe("/administracion");
    expect(destinoTrasIngresar("estudiante", "/monitor-falso")).toBe("/monitor-falso");
  });

  it("los dos paneles y todo lo que cuelga de ellos van a la portada, sin importar cómo se escriban (si no, bucle)", () => {
    for (const ruta of [
      "/admin",
      "/admin/pagos",
      "/admin?x=1",
      "/admin#ancla",
      "/monitor",
      "/monitor/agenda",
      "/monitor?x=1",
      "/admin/../monitor",
      "/otro/../admin/pagos",
      "/admin/%2e%2e/monitor",
      "/%61dmin",
      "/%61dmin/pagos",
      "/monitor%2Fagenda",
    ]) {
      expect(destinoTrasIngresar("estudiante", ruta), ruta).toBe("/");
    }
  });

  it("una ruta externa o mal formada da la portada: la normalización la vuelve a comprobar", () => {
    for (const ruta of ["https://otro.sitio", "//otro.sitio", "/.//otro.sitio", "/a/..//otro.sitio", "/\\otro.sitio", "javascript:alert(1)", "/%zz", "/con espacio"]) {
      expect(destinoTrasIngresar("estudiante", ruta), ruta).toBe("/");
    }
    // `rutaInternaSegura`, que usa la página de ingresar, sí deja pasar `/.//otro.sitio`: por eso no se usa aquí.
    expect(rutaInternaSegura("/.//otro.sitio")).toBe("/.//otro.sitio");
  });

  it("una ruta de más de 500 caracteres da la portada", () => {
    expect(destinoTrasIngresar("estudiante", `/${"a".repeat(600)}`)).toBe("/");
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
