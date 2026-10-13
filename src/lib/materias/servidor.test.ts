import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/tipos";
import {
  borrarEvaluacion,
  borrarMateria,
  cargarMateria,
  crearMateria,
  evaluacionGuardada,
  guardarEvaluacion,
  guardarMateria,
  ligadoDeEvaluacion,
  ligadoDeMateria,
  listarMaterias,
  materiaGuardada,
  nombresDeLasEvaluaciones,
  quienTieneElCodigo,
} from "./servidor";

// HU-055 sin base: las funciones de servidor.ts contra un cliente de Supabase inventado que anota cada llamada. Aquí se fija
// qué se le pide a la base (tabla, columnas, orden, filtro) y cómo se entiende lo que responde. Que la base dé o niegue el
// permiso lo cubren supabase/tests/gestionar_materias.test.sql y integracion/materias.test.ts con sesiones de verdad.

type Operacion = [nombre: string, argumentos: unknown[]];
type Respuesta = { data: unknown; error: { code: string; message: string; hint?: string | null; details?: string } | null };

/** Un cliente que responde por tabla (o por función con `rpc`) y guarda lo que se le pidió. */
function crearCliente(respuestas: { tablas?: Record<string, (operaciones: Operacion[]) => Respuesta>; funciones?: Record<string, (argumentos: unknown) => Respuesta> }) {
  const llamadas: { tabla: string; operaciones: Operacion[] }[] = [];
  const funcionesLlamadas: { nombre: string; argumentos: unknown }[] = [];

  const cadena = (tabla: string) => {
    const operaciones: Operacion[] = [];
    llamadas.push({ tabla, operaciones });
    const constructor: unknown = new Proxy(
      {},
      {
        get(_, propiedad) {
          // Lo que se espera con `await`: la respuesta de la tabla, calculada con todo lo encadenado.
          if (propiedad === "then") {
            return (alResolver: (r: Respuesta) => unknown, alRechazar: (e: unknown) => unknown) =>
              Promise.resolve(respuestas.tablas?.[tabla]?.(operaciones) ?? { data: null, error: null }).then(alResolver, alRechazar);
          }
          return (...argumentos: unknown[]) => {
            operaciones.push([String(propiedad), argumentos]);
            return constructor;
          };
        },
      },
    );
    return constructor;
  };

  const cliente = {
    from: (tabla: string) => cadena(tabla),
    rpc: async (nombre: string, argumentos: unknown) => {
      funcionesLlamadas.push({ nombre, argumentos });
      return respuestas.funciones?.[nombre]?.(argumentos) ?? { data: null, error: null };
    },
  } as unknown as SupabaseClient<Database>;

  const de = (tabla: string) => llamadas.filter((l) => l.tabla === tabla).map((l) => l.operaciones);
  return { cliente, llamadas, funcionesLlamadas, de };
}

const ID = "11111111-0000-4000-8000-000000000055";
const ID_EVALUACION = "22222222-0000-4000-8000-000000000055";
const ID_MATERIA = "33333333-0000-4000-8000-000000000055";
const ok = (data: unknown): Respuesta => ({ data, error: null });
const falla = (code: string, extra: Partial<NonNullable<Respuesta["error"]>> = {}): Respuesta => ({
  data: null,
  error: { code, message: `fallo ${code}`, ...extra },
});

describe("listarMaterias", () => {
  it("lee las materias con sus evaluaciones, por nombre, y cuenta las evaluaciones y las activas", async () => {
    const { cliente, de } = crearCliente({
      tablas: {
        materia: () =>
          ok([
            { id: "a", nombre: "Álgebra", codigo: "MATE-1105", evaluacion: [{ id: "e1", activa: true }, { id: "e2", activa: false }, { id: "e3", activa: true }] },
            { id: "b", nombre: "Cálculo", codigo: "MATE-1214", evaluacion: [] },
          ]),
      },
    });
    expect(await listarMaterias(cliente)).toEqual([
      { id: "a", nombre: "Álgebra", codigo: "MATE-1105", evaluaciones: 3, activas: 2 },
      { id: "b", nombre: "Cálculo", codigo: "MATE-1214", evaluaciones: 0, activas: 0 },
    ]);
    const [operaciones] = de("materia");
    expect(operaciones).toEqual([
      ["select", ["id, nombre, codigo, evaluacion(id, activa)"]],
      ["order", ["nombre", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
    ]);
  });

  it("sin materias devuelve una lista vacía", async () => {
    expect(await listarMaterias(crearCliente({ tablas: { materia: () => ok([]) } }).cliente)).toEqual([]);
    expect(await listarMaterias(crearCliente({ tablas: { materia: () => ok(null) } }).cliente)).toEqual([]);
  });

  it("si la base falla, lanza", async () => {
    await expect(listarMaterias(crearCliente({ tablas: { materia: () => falla("XX000") } }).cliente)).rejects.toThrow(/No se pudieron leer las materias/);
  });
});

describe("cargarMateria", () => {
  const evaluaciones = [{ id: "e1", nombre: "Parcial 1", semana: 8, acumulativo: false, activa: true }];

  it("lee la materia y sus evaluaciones por semana, nombre e id", async () => {
    const { cliente, de } = crearCliente({
      tablas: {
        materia: () => ok({ id: ID, nombre: "Cálculo", codigo: "MATE-1214" }),
        evaluacion: () => ok(evaluaciones),
      },
    });
    expect(await cargarMateria(cliente, ID)).toEqual({ id: ID, nombre: "Cálculo", codigo: "MATE-1214", evaluaciones });
    expect(de("materia")[0]).toEqual([
      ["select", ["id, nombre, codigo"]],
      ["eq", ["id", ID]],
      ["maybeSingle", []],
    ]);
    expect(de("evaluacion")[0]).toEqual([
      ["select", ["id, nombre, semana, acumulativo, activa"]],
      ["eq", ["id_materia", ID]],
      ["order", ["semana", { ascending: true }]],
      ["order", ["nombre", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
    ]);
  });

  it("sin la materia devuelve null", async () => {
    const { cliente } = crearCliente({ tablas: { materia: () => ok(null), evaluacion: () => ok([]) } });
    expect(await cargarMateria(cliente, ID)).toBeNull();
  });

  it("una materia sin evaluaciones trae la lista vacía", async () => {
    const { cliente } = crearCliente({ tablas: { materia: () => ok({ id: ID, nombre: "X", codigo: "MATE-1214" }), evaluacion: () => ok(null) } });
    expect(await cargarMateria(cliente, ID)).toMatchObject({ evaluaciones: [] });
  });

  it("si falla la lectura de la materia o la de sus evaluaciones, lanza", async () => {
    await expect(cargarMateria(crearCliente({ tablas: { materia: () => falla("XX000"), evaluacion: () => ok([]) } }).cliente, ID)).rejects.toThrow(
      /No se pudo leer la materia/,
    );
    await expect(
      cargarMateria(crearCliente({ tablas: { materia: () => ok({ id: ID, nombre: "X", codigo: "C" }), evaluacion: () => falla("XX000") } }).cliente, ID),
    ).rejects.toThrow(/No se pudieron leer las evaluaciones/);
  });
});

describe("materiaGuardada, evaluacionGuardada y nombresDeLasEvaluaciones", () => {
  it("materiaGuardada devuelve la fila o null", async () => {
    const fila = { id: ID, nombre: "Cálculo", codigo: "MATE-1214" };
    expect(await materiaGuardada(crearCliente({ tablas: { materia: () => ok(fila) } }).cliente, ID)).toEqual(fila);
    expect(await materiaGuardada(crearCliente({ tablas: { materia: () => ok(null) } }).cliente, ID)).toBeNull();
    await expect(materiaGuardada(crearCliente({ tablas: { materia: () => falla("XX000") } }).cliente, ID)).rejects.toThrow();
  });

  it("evaluacionGuardada trae su materia como idMateria, o null", async () => {
    const { cliente, de } = crearCliente({
      tablas: { evaluacion: () => ok({ id: ID_EVALUACION, nombre: "Parcial 1", semana: 8, id_materia: ID_MATERIA }) },
    });
    expect(await evaluacionGuardada(cliente, ID_EVALUACION)).toEqual({ id: ID_EVALUACION, nombre: "Parcial 1", semana: 8, idMateria: ID_MATERIA });
    expect(de("evaluacion")[0]).toContainEqual(["select", ["id, nombre, semana, id_materia"]]);
    expect(await evaluacionGuardada(crearCliente({ tablas: { evaluacion: () => ok(null) } }).cliente, ID_EVALUACION)).toBeNull();
    await expect(evaluacionGuardada(crearCliente({ tablas: { evaluacion: () => falla("XX000") } }).cliente, ID_EVALUACION)).rejects.toThrow();
  });

  it("nombresDeLasEvaluaciones lee las de la materia", async () => {
    const { cliente, de } = crearCliente({ tablas: { evaluacion: () => ok([{ id: "e1", nombre: "Parcial 1" }]) } });
    expect(await nombresDeLasEvaluaciones(cliente, ID_MATERIA)).toEqual([{ id: "e1", nombre: "Parcial 1" }]);
    expect(de("evaluacion")[0]).toEqual([
      ["select", ["id, nombre"]],
      ["eq", ["id_materia", ID_MATERIA]],
    ]);
    await expect(nombresDeLasEvaluaciones(crearCliente({ tablas: { evaluacion: () => falla("XX000") } }).cliente, ID_MATERIA)).rejects.toThrow();
  });
});

describe("ligadoDeMateria y ligadoDeEvaluacion", () => {
  it("piden la lista a la función de la base con el id", async () => {
    const { cliente, funcionesLlamadas } = crearCliente({
      funciones: {
        ligado_de_materia: () => ok(["evaluaciones", "temas"]),
        ligado_de_evaluacion: () => ok(["diagnosticos"]),
      },
    });
    expect(await ligadoDeMateria(cliente, ID)).toEqual(["evaluaciones", "temas"]);
    expect(await ligadoDeEvaluacion(cliente, ID_EVALUACION)).toEqual(["diagnosticos"]);
    expect(funcionesLlamadas).toEqual([
      { nombre: "ligado_de_materia", argumentos: { p_id: ID } },
      { nombre: "ligado_de_evaluacion", argumentos: { p_id: ID_EVALUACION } },
    ]);
  });

  it("sin nada ligado, la lista vacía", async () => {
    const { cliente } = crearCliente({ funciones: { ligado_de_materia: () => ok([]), ligado_de_evaluacion: () => ok(null) } });
    expect(await ligadoDeMateria(cliente, ID)).toEqual([]);
    expect(await ligadoDeEvaluacion(cliente, ID)).toEqual([]);
  });

  it("si la base falla, lanza: la página no debe ofrecer borrar sin saber lo ligado", async () => {
    const { cliente } = crearCliente({ funciones: { ligado_de_materia: () => falla("42501"), ligado_de_evaluacion: () => falla("XX000") } });
    await expect(ligadoDeMateria(cliente, ID)).rejects.toThrow(/No se pudo leer lo ligado a la materia/);
    await expect(ligadoDeEvaluacion(cliente, ID)).rejects.toThrow(/No se pudo leer lo ligado a la evaluación/);
  });
});

describe("crearMateria", () => {
  it("inserta solo nombre y código y devuelve la fila como la guardó la base", async () => {
    const { cliente, de } = crearCliente({ tablas: { materia: () => ok({ id: ID, nombre: "Cálculo", codigo: "MATE-1214" }) } });
    expect(await crearMateria(cliente, { nombre: "Cálculo", codigo: "MATE-1214" })).toEqual({
      tipo: "guardada",
      fila: { id: ID, nombre: "Cálculo", codigo: "MATE-1214" },
    });
    expect(de("materia")[0]).toEqual([
      ["insert", [{ nombre: "Cálculo", codigo: "MATE-1214" }]],
      ["select", ["id, nombre, codigo"]],
      ["single", []],
    ]);
  });

  it("si la base lo rechaza, devuelve el código y la pista, sin los detalles ni el mensaje", async () => {
    const { cliente } = crearCliente({
      tablas: { materia: () => falla("23514", { hint: "codigo", details: "Failing row contains (…MATE-12…)" }) },
    });
    const resultado = await crearMateria(cliente, { nombre: "Cálculo", codigo: "MATE-12" });
    expect(resultado).toEqual({ tipo: "error", error: { code: "23514", hint: "codigo" } });
    expect(JSON.stringify(resultado)).not.toContain("Failing row");
  });
});

describe("guardarMateria", () => {
  it("actualiza solo nombre y código de esa fila y la devuelve", async () => {
    const { cliente, de } = crearCliente({ tablas: { materia: () => ok([{ id: ID, nombre: "Cálculo I", codigo: "MATE-1215" }]) } });
    expect(await guardarMateria(cliente, ID, { nombre: "Cálculo I", codigo: "MATE-1215" })).toEqual({
      tipo: "guardada",
      fila: { id: ID, nombre: "Cálculo I", codigo: "MATE-1215" },
    });
    expect(de("materia")[0]).toEqual([
      ["update", [{ nombre: "Cálculo I", codigo: "MATE-1215" }]],
      ["eq", ["id", ID]],
      ["select", ["id, nombre, codigo"]],
    ]);
  });

  it("cero filas tocadas: la materia no existe (o ya no)", async () => {
    const { cliente } = crearCliente({ tablas: { materia: () => ok([]) } });
    expect(await guardarMateria(cliente, ID, { nombre: "X", codigo: "MATE-1215" })).toEqual({ tipo: "no_existe" });
  });

  it("un error de la base se devuelve con su código y su pista; el sin pista, con hint nulo", async () => {
    const { cliente } = crearCliente({ tablas: { materia: () => falla("23505") } });
    expect(await guardarMateria(cliente, ID, { nombre: "X", codigo: "MATE-1215" })).toEqual({ tipo: "error", error: { code: "23505", hint: null } });
  });
});

describe("guardarEvaluacion", () => {
  it("actualiza solo nombre y semana: nunca activa, clave ni acumulativo", async () => {
    const { cliente, de } = crearCliente({ tablas: { evaluacion: () => ok([{ id: ID_EVALUACION, nombre: "Parcial 1", semana: 9 }]) } });
    expect(await guardarEvaluacion(cliente, ID_EVALUACION, { nombre: "Parcial 1", semana: 9 })).toEqual({
      tipo: "guardada",
      fila: { id: ID_EVALUACION, nombre: "Parcial 1", semana: 9 },
    });
    expect(de("evaluacion")[0]).toEqual([
      ["update", [{ nombre: "Parcial 1", semana: 9 }]],
      ["eq", ["id", ID_EVALUACION]],
      ["select", ["id, nombre, semana"]],
    ]);
  });

  it("cero filas: no existe; un error de la base, con su código", async () => {
    expect(await guardarEvaluacion(crearCliente({ tablas: { evaluacion: () => ok([]) } }).cliente, ID_EVALUACION, { nombre: "X", semana: 1 })).toEqual({
      tipo: "no_existe",
    });
    expect(
      await guardarEvaluacion(crearCliente({ tablas: { evaluacion: () => falla("42501") } }).cliente, ID_EVALUACION, { nombre: "X", semana: 1 }),
    ).toEqual({ tipo: "error", error: { code: "42501", hint: null } });
  });
});

describe("quienTieneElCodigo", () => {
  it("busca el código sin distinguir mayúsculas y devuelve el nombre de la primera materia", async () => {
    const { cliente, de } = crearCliente({ tablas: { materia: () => ok([{ id: "a", nombre: "Álgebra" }, { id: "b", nombre: "Otra" }]) } });
    expect(await quienTieneElCodigo(cliente, "MATE-1105")).toBe("Álgebra");
    expect(de("materia")[0]).toEqual([
      ["select", ["id, nombre"]],
      ["ilike", ["codigo", "MATE-1105"]],
      ["order", ["nombre", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
    ]);
  });

  it("deja fuera a la materia que se está editando", async () => {
    const { cliente } = crearCliente({ tablas: { materia: () => ok([{ id: "propia", nombre: "Propia" }, { id: "b", nombre: "Otra" }]) } });
    expect(await quienTieneElCodigo(cliente, "MATE-1105", "propia")).toBe("Otra");
  });

  it("si nadie más lo tiene, o no se encuentra, devuelve null", async () => {
    expect(await quienTieneElCodigo(crearCliente({ tablas: { materia: () => ok([]) } }).cliente, "MATE-1105")).toBeNull();
    expect(await quienTieneElCodigo(crearCliente({ tablas: { materia: () => ok(null) } }).cliente, "MATE-1105")).toBeNull();
    expect(await quienTieneElCodigo(crearCliente({ tablas: { materia: () => ok([{ id: "propia", nombre: "Propia" }]) } }).cliente, "MATE-1105", "propia")).toBeNull();
  });

  it("escapa los comodines de ilike: el código se compara tal cual", async () => {
    const { cliente, de } = crearCliente({ tablas: { materia: () => ok([]) } });
    await quienTieneElCodigo(cliente, "E2E_%\\X");
    expect(de("materia")[0]).toContainEqual(["ilike", ["codigo", "E2E\\_\\%\\\\X"]]);
  });

  it("si la base falla, lanza", async () => {
    await expect(quienTieneElCodigo(crearCliente({ tablas: { materia: () => falla("XX000") } }).cliente, "MATE-1105")).rejects.toThrow();
  });
});

describe("borrarMateria", () => {
  const conMateria = (borrar: () => Respuesta) =>
    crearCliente({ tablas: { materia: () => ok({ id: ID, nombre: "Cálculo", codigo: "MATE-1214" }) }, funciones: { borrar_materia: borrar } });

  it("lee el nombre, borra con la función de la base y lo devuelve para el aviso", async () => {
    const { cliente, funcionesLlamadas } = conMateria(() => ok("borrada"));
    expect(await borrarMateria(cliente, ID)).toEqual({ tipo: "borrada", nombre: "Cálculo" });
    expect(funcionesLlamadas).toEqual([{ nombre: "borrar_materia", argumentos: { p_id: ID } }]);
  });

  it("si la materia ya no existe, lo dice sin llamar a la función", async () => {
    const { cliente, funcionesLlamadas } = crearCliente({ tablas: { materia: () => ok(null) } });
    expect(await borrarMateria(cliente, ID)).toEqual({ tipo: "no_existe" });
    expect(funcionesLlamadas).toEqual([]);
  });

  it("no_existe de la función (se borró entre la lectura y la función) también se dice", async () => {
    expect(await borrarMateria(conMateria(() => ok("no_existe")).cliente, ID)).toEqual({ tipo: "no_existe" });
  });

  it("ligada trae lo ligado; no_autorizado se dice", async () => {
    expect(await borrarMateria(conMateria(() => ok("ligada:certificados,monitorias")).cliente, ID)).toEqual({
      tipo: "ligada",
      ligado: ["certificados", "monitorias"],
    });
    expect(await borrarMateria(conMateria(() => ok("no_autorizado")).cliente, ID)).toEqual({ tipo: "no_autorizado" });
  });

  it("un permiso denegado (42501) es no_autorizado; otro error lanza; una respuesta rara lanza", async () => {
    expect(await borrarMateria(conMateria(() => falla("42501")).cliente, ID)).toEqual({ tipo: "no_autorizado" });
    await expect(borrarMateria(conMateria(() => falla("XX000")).cliente, ID)).rejects.toThrow(/No se pudo borrar la materia/);
    await expect(borrarMateria(conMateria(() => ok("ligada:")).cliente, ID)).rejects.toThrow(/Respuesta inesperada/);
    await expect(borrarMateria(conMateria(() => ok(null)).cliente, ID)).rejects.toThrow(/Respuesta inesperada/);
  });
});

describe("borrarEvaluacion", () => {
  const conEvaluacion = (borrar: () => Respuesta) =>
    crearCliente({
      tablas: { evaluacion: () => ok({ id: ID_EVALUACION, nombre: "Parcial 1", semana: 8, id_materia: ID_MATERIA }) },
      funciones: { borrar_evaluacion: borrar },
    });

  it("lee la evaluación, borra con la función y devuelve su nombre y su materia", async () => {
    const { cliente, funcionesLlamadas } = conEvaluacion(() => ok("borrada"));
    expect(await borrarEvaluacion(cliente, ID_EVALUACION)).toEqual({ tipo: "borrada", nombre: "Parcial 1", idMateria: ID_MATERIA });
    expect(funcionesLlamadas).toEqual([{ nombre: "borrar_evaluacion", argumentos: { p_id: ID_EVALUACION } }]);
  });

  it("si la evaluación ya no existe, no llama a la función", async () => {
    const { cliente, funcionesLlamadas } = crearCliente({ tablas: { evaluacion: () => ok(null) } });
    expect(await borrarEvaluacion(cliente, ID_EVALUACION)).toEqual({ tipo: "no_existe" });
    expect(funcionesLlamadas).toEqual([]);
  });

  it("entiende ligada, no_existe, no_autorizado, el permiso denegado y las fallas", async () => {
    expect(await borrarEvaluacion(conEvaluacion(() => ok("ligada:temas,diagnosticos")).cliente, ID_EVALUACION)).toEqual({
      tipo: "ligada",
      ligado: ["temas", "diagnosticos"],
    });
    expect(await borrarEvaluacion(conEvaluacion(() => ok("no_existe")).cliente, ID_EVALUACION)).toEqual({ tipo: "no_existe" });
    expect(await borrarEvaluacion(conEvaluacion(() => ok("no_autorizado")).cliente, ID_EVALUACION)).toEqual({ tipo: "no_autorizado" });
    expect(await borrarEvaluacion(conEvaluacion(() => falla("42501")).cliente, ID_EVALUACION)).toEqual({ tipo: "no_autorizado" });
    await expect(borrarEvaluacion(conEvaluacion(() => falla("XX000")).cliente, ID_EVALUACION)).rejects.toThrow(/No se pudo borrar la evaluación/);
    await expect(borrarEvaluacion(conEvaluacion(() => ok("otra cosa")).cliente, ID_EVALUACION)).rejects.toThrow(/Respuesta inesperada/);
  });
});

describe("la llave secreta", () => {
  it("ningún archivo de HU-055 importa el cliente con la llave secreta: se escribe con la sesión del admin", () => {
    const archivos = [
      "../../lib/materias/servidor.ts",
      "../../lib/materias/reglas.ts",
      "../../app/admin/materias/acciones.ts",
      "../../app/admin/materias/page.tsx",
      "../../app/admin/materias/[id]/page.tsx",
    ];
    for (const archivo of archivos) {
      const codigo = readFileSync(new URL(archivo, import.meta.url), "utf8");
      expect(codigo, archivo).not.toMatch(/supabase\/admin/);
      expect(codigo, archivo).not.toMatch(/crearClienteAdmin|SECRET_KEY|service_role/i);
    }
  });

  it("y cada función de servidor.ts recibe el cliente: ninguna crea uno propio", () => {
    const codigo = readFileSync(new URL("./servidor.ts", import.meta.url), "utf8");
    expect(codigo).not.toMatch(/crearCliente/);
  });
});
