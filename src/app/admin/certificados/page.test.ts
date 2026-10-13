import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CertificarMonitores from "./page";

// HU-055 (criterio 19) sin navegador ni base: la página de certificar con la sesión y las lecturas inventadas, y se lee el
// HTML. Aquí se fija el aviso de cuando no hay materias, que ahora lleva a crearlas en /admin/materias. El recorrido con la
// base (certificar, ver los certificados) lo cubre e2e/certificados.spec.ts.

const h = vi.hoisted(() => ({
  tablas: {} as Record<string, unknown[]>,
  errores: {} as Record<string, { message: string }>,
}));

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: async () => ({ idUsuario: "a0a0a0a0-0000-4000-8000-000000000055", rol: "admin" }) }));
vi.mock("@/lib/supabase/servidor", () => ({
  // Cualquier cadena de `select`, `order`… termina en las filas de la tabla, o en su error.
  crearClienteServidor: async () => ({
    from: (tabla: string) => {
      const cadena: unknown = new Proxy(
        {},
        {
          get(_, propiedad) {
            if (propiedad === "then") {
              return (alResolver: (r: unknown) => unknown) =>
                Promise.resolve({ data: h.errores[tabla] ? null : (h.tablas[tabla] ?? []), error: h.errores[tabla] ?? null }).then(alResolver);
            }
            return () => cadena;
          },
        },
      );
      return cadena;
    },
  }),
}));
// La acción vive en el servidor: aquí no se llama.
vi.mock("@/app/admin/certificados/acciones", () => ({ certificar: vi.fn() }));

const MONITOR = { id: "b0b0b0b0-0000-4000-8000-000000000055", nombre: "Laura Pérez" };
const MATERIA = { id: "11111111-0000-4000-8000-000000000055", nombre: "Cálculo Diferencial", codigo: "MATE-1214" };

const pintar = async () => renderToStaticMarkup(await CertificarMonitores());

/** El texto visible: sin etiquetas ni comentarios de React y con los espacios normalizados. */
const texto = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,:])/g, "$1")
    .trim();

beforeEach(() => {
  h.tablas = { monitor: [MONITOR], monitor_privado: [{ id_monitor: MONITOR.id, correo: "laura@uniandes.edu.co" }], materia: [], certificado: [] };
  h.errores = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/admin/certificados: sin materias (HU-055, criterio 19)", () => {
  it("el aviso sigue diciendo que no se puede certificar y ahora enlaza a /admin/materias", async () => {
    const html = await pintar();
    expect(html).toMatch(/<p role="status"[^>]*>Todavía no hay materias cargadas en Calibra, así que no se puede certificar\./);
    expect(html).toMatch(/<a[^>]*href="\/admin\/materias"[^>]*>Materias y evaluaciones<\/a>/);
    expect(texto(html)).toContain("Todavía no hay materias cargadas en Calibra, así que no se puede certificar. Crea una en Materias y evaluaciones.");
  });

  it("el enlace va dentro del aviso, no suelto", async () => {
    const html = await pintar();
    const aviso = /<p role="status"[^>]*>Todavía no hay materias cargadas.*?<\/p>/.exec(html)?.[0] ?? "";
    expect(aviso).toContain('href="/admin/materias"');
  });

  it("no ofrece el formulario de certificar", async () => {
    expect(await pintar()).not.toContain('name="id_monitor"');
  });
});

describe("/admin/certificados: con materias", () => {
  it("ofrece el formulario con la materia y no muestra el aviso ni el enlace", async () => {
    h.tablas.materia = [MATERIA];
    const html = await pintar();
    expect(html).toContain('name="id_materia"');
    expect(html).toContain("Cálculo Diferencial (MATE-1214)");
    expect(html).not.toContain("Todavía no hay materias cargadas");
    expect(html).not.toContain('href="/admin/materias"');
  });
});

describe("/admin/certificados: sin monitores", () => {
  it("dice lo de los monitores, no lo de las materias", async () => {
    h.tablas.monitor = [];
    const html = await pintar();
    expect(texto(html)).toContain("Todavía no hay monitores con cuenta.");
    expect(html).not.toContain("Todavía no hay materias cargadas");
  });
});

describe("/admin/certificados: si una lectura falla", () => {
  it("dice «No pudimos cargar…» como alerta y no muestra el aviso de materias", async () => {
    h.errores.materia = { message: "caída" };
    const html = await pintar();
    expect(html).toMatch(/<p role="alert"[^>]*>No pudimos cargar los monitores y sus certificados\./);
    expect(html).not.toContain("Todavía no hay materias cargadas");
  });
});
