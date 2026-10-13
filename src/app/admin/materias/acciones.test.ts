import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BORRAR_FALLO,
  ERRORES,
  EVALUACION_NO_ENCONTRADA,
  GUARDAR_FALLO,
  MATERIA_NO_ENCONTRADA,
  SIN_PERMISO_PARA_BORRAR,
  SIN_PERMISO_PARA_CAMBIAR,
} from "@/lib/materias/reglas";
import { borrar, borrarEvaluacion, crear, guardar, guardarEvaluacion } from "./acciones";

// HU-055 sin navegador ni base: las cinco acciones con la sesión, el cliente y las funciones de servidor.ts inventados.
// Aquí se fija qué hace cada acción con lo que le responde la base (mensajes, valores conservados, revalidación, a dónde
// redirige) y que la guarda va primero. Que la base dé o niegue el permiso, y las carreras, lo cubren
// supabase/tests/gestionar_materias.test.sql y la integración.

const ID = "11111111-0000-4000-8000-000000000055";
const ID_EVALUACION = "22222222-0000-4000-8000-000000000055";
const ID_MATERIA = "33333333-0000-4000-8000-000000000055";

const h = vi.hoisted(() => {
  class Redireccion extends Error {
    constructor(readonly destino: string) {
      super(`redirect:${destino}`);
    }
  }
  return {
    Redireccion,
    cliente: { soy: "el cliente de la sesión" } as object | null,
    exigirRol: vi.fn(async () => ({ idUsuario: "a0a0a0a0-0000-4000-8000-000000000055", rol: "admin" })),
    revalidatePath: vi.fn(),
    crearMateria: vi.fn(),
    guardarMateria: vi.fn(),
    guardarEvaluacion: vi.fn(),
    borrarMateria: vi.fn(),
    borrarEvaluacion: vi.fn(),
    materiaGuardada: vi.fn(),
    evaluacionGuardada: vi.fn(),
    nombresDeLasEvaluaciones: vi.fn(),
    quienTieneElCodigo: vi.fn(),
  };
});

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: h.exigirRol }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => h.cliente }));
vi.mock("@/lib/materias/servidor", () => ({
  crearMateria: h.crearMateria,
  guardarMateria: h.guardarMateria,
  guardarEvaluacion: h.guardarEvaluacion,
  borrarMateria: h.borrarMateria,
  borrarEvaluacion: h.borrarEvaluacion,
  materiaGuardada: h.materiaGuardada,
  evaluacionGuardada: h.evaluacionGuardada,
  nombresDeLasEvaluaciones: h.nombresDeLasEvaluaciones,
  quienTieneElCodigo: h.quienTieneElCodigo,
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new h.Redireccion(destino);
  },
}));
// Se escribe con la sesión del admin: si alguna acción llegara a importar la llave secreta, esta prueba se cae.
vi.mock("@/lib/supabase/admin", () => {
  throw new Error("Las acciones de materias no usan la llave secreta.");
});

const formulario = (campos: Record<string, string | Blob>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

const inicial = { errores: {}, error: null, exito: null, valores: {} };
const inicialDeBorrado = { error: null };

/** A dónde redirigió una acción de borrar (siempre redirige si borra). */
async function destinoDe(accion: () => Promise<unknown>): Promise<string> {
  try {
    await accion();
  } catch (error) {
    if (error instanceof h.Redireccion) return error.destino;
    throw error;
  }
  throw new Error("La acción no redirigió.");
}

beforeEach(() => {
  h.cliente = { soy: "el cliente de la sesión" };
  for (const simulado of [
    h.exigirRol,
    h.revalidatePath,
    h.crearMateria,
    h.guardarMateria,
    h.guardarEvaluacion,
    h.borrarMateria,
    h.borrarEvaluacion,
    h.materiaGuardada,
    h.evaluacionGuardada,
    h.nombresDeLasEvaluaciones,
    h.quienTieneElCodigo,
  ]) {
    simulado.mockClear();
  }
  h.nombresDeLasEvaluaciones.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exigirRol: la guarda va primero en las cinco acciones", () => {
  const acciones: [string, () => Promise<unknown>][] = [
    ["crear", () => crear(inicial, formulario({ nombre: "Cálculo", codigo: "MATE-1214" }))],
    ["guardar", () => guardar(inicial, formulario({ id: ID, nombre: "Cálculo", codigo: "MATE-1214" }))],
    ["guardarEvaluacion", () => guardarEvaluacion(inicial, formulario({ id: ID_EVALUACION, nombre: "Parcial", semana: "3" }))],
    ["borrar", () => borrar(inicialDeBorrado, formulario({ id: ID }))],
    ["borrarEvaluacion", () => borrarEvaluacion(inicialDeBorrado, formulario({ id: ID_EVALUACION }))],
  ];

  it.each(acciones)("%s pide el rol admin antes de tocar la base: una sesión de otro rol no hace nada", async (_nombre, accion) => {
    h.exigirRol.mockRejectedValueOnce(new Error("redirect:/ingresar"));
    await expect(accion()).rejects.toThrow("redirect:/ingresar");
    expect(h.exigirRol).toHaveBeenCalledExactlyOnceWith("admin", "/admin/materias");
    for (const simulado of [
      h.crearMateria,
      h.guardarMateria,
      h.guardarEvaluacion,
      h.borrarMateria,
      h.borrarEvaluacion,
      h.materiaGuardada,
      h.evaluacionGuardada,
      h.quienTieneElCodigo,
    ]) {
      expect(simulado).not.toHaveBeenCalled();
    }
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("crear", () => {
  const datos = () => formulario({ nombre: "  Cálculo Diferencial ", codigo: " mate-1214 " });

  it("guarda con la sesión del admin, con el código en mayúsculas y el nombre recortado, y refresca la lista", async () => {
    h.crearMateria.mockResolvedValue({ tipo: "guardada", fila: { id: ID, nombre: "Cálculo Diferencial", codigo: "MATE-1214" } });
    const estado = await crear(inicial, datos());
    expect(h.crearMateria).toHaveBeenCalledExactlyOnceWith(h.cliente, { nombre: "Cálculo Diferencial", codigo: "MATE-1214" });
    expect(h.revalidatePath).toHaveBeenCalledExactlyOnceWith("/admin/materias");
    expect(estado).toEqual({ errores: {}, error: null, exito: "Creamos la materia Cálculo Diferencial (MATE-1214).", valores: {} });
  });

  it("dice lo que la base guardó, que es lo que el trigger normalizó", async () => {
    h.crearMateria.mockResolvedValue({ tipo: "guardada", fila: { id: ID, nombre: "Cálculo", codigo: "MATE-1214" } });
    expect((await crear(inicial, datos())).exito).toBe("Creamos la materia Cálculo (MATE-1214).");
  });

  it.each([
    ["nombre vacío", { nombre: "  ", codigo: "MATE-1214" }, { nombre: ERRORES.nombreDeMateria }],
    ["nombre de 121 caracteres", { nombre: "a".repeat(121), codigo: "MATE-1214" }, { nombre: ERRORES.nombreLargo }],
    ["código sin forma", { nombre: "Cálculo", codigo: "MATE-12" }, { codigo: ERRORES.codigo }],
    ["los dos mal", { nombre: "", codigo: "x" }, { nombre: ERRORES.nombreDeMateria, codigo: ERRORES.codigo }],
  ])("%s: error junto al campo, campos conservados y no toca la base", async (_caso, campos, errores) => {
    const estado = await crear(inicial, formulario(campos));
    expect(estado).toEqual({ errores, error: null, exito: null, valores: campos });
    expect(h.crearMateria).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("código repetido (23505): busca quién lo tiene, lo nombra y conserva lo escrito", async () => {
    h.crearMateria.mockResolvedValue({ tipo: "error", error: { code: "23505", hint: null } });
    h.quienTieneElCodigo.mockResolvedValue("Álgebra");
    const estado = await crear(inicial, datos());
    // Lo busca normalizado: el índice compara sin mayúsculas ni espacios de los bordes.
    expect(h.quienTieneElCodigo).toHaveBeenCalledExactlyOnceWith(h.cliente, "MATE-1214", undefined);
    expect(estado).toEqual({
      errores: { codigo: "Ya existe una materia con ese código: Álgebra." },
      error: null,
      exito: null,
      valores: { nombre: "  Cálculo Diferencial ", codigo: " mate-1214 " },
    });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("código repetido cuando no se puede leer quién lo tiene: el mensaje sale sin nombre", async () => {
    h.crearMateria.mockResolvedValue({ tipo: "error", error: { code: "23505", hint: null } });
    h.quienTieneElCodigo.mockResolvedValue(null);
    expect((await crear(inicial, datos())).errores.codigo).toBe("Ya existe una materia con ese código.");
  });

  it("si buscar quién tiene el código falla, es el error general y se conservan los campos", async () => {
    h.crearMateria.mockResolvedValue({ tipo: "error", error: { code: "23505", hint: null } });
    h.quienTieneElCodigo.mockRejectedValue(new Error("caída"));
    expect(await crear(inicial, datos())).toEqual({
      errores: {},
      error: GUARDAR_FALLO,
      exito: null,
      valores: { nombre: "  Cálculo Diferencial ", codigo: " mate-1214 " },
    });
  });

  it("23514 con la pista del trigger va junto al campo", async () => {
    h.crearMateria.mockResolvedValue({ tipo: "error", error: { code: "23514", hint: "codigo" } });
    expect((await crear(inicial, datos())).errores).toEqual({ codigo: ERRORES.codigo });
    h.crearMateria.mockResolvedValue({ tipo: "error", error: { code: "23514", hint: "nombre" } });
    expect((await crear(inicial, datos())).errores).toEqual({ nombre: ERRORES.nombreDeLaBase });
  });

  it("una cuenta sin permiso (42501) lo dice", async () => {
    h.crearMateria.mockResolvedValue({ tipo: "error", error: { code: "42501", hint: "Grant the required privileges…" } });
    expect(await crear(inicial, datos())).toMatchObject({ errores: {}, error: SIN_PERMISO_PARA_CAMBIAR, exito: null });
  });

  it("cualquier otro error de la base: el general con role alert, los campos conservados y solo el código en el registro", async () => {
    h.crearMateria.mockResolvedValue({ tipo: "error", error: { code: "XX000", hint: null } });
    const estado = await crear(inicial, datos());
    expect(estado).toEqual({ errores: {}, error: GUARDAR_FALLO, exito: null, valores: { nombre: "  Cálculo Diferencial ", codigo: " mate-1214 " } });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("[materias] no se pudo guardar la materia:", "código XX000");
  });

  it("si la base lanza, o falta la conexión, es el error general y queda en el registro", async () => {
    h.crearMateria.mockRejectedValue(new Error("caída"));
    expect(await crear(inicial, datos())).toMatchObject({ error: GUARDAR_FALLO, valores: { nombre: "  Cálculo Diferencial ", codigo: " mate-1214 " } });
    h.cliente = null;
    expect(await crear(inicial, datos())).toMatchObject({ error: GUARDAR_FALLO });
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("guardar (una materia)", () => {
  const datos = (campos: Record<string, string> = {}) => formulario({ id: ID, nombre: "Cálculo I", codigo: "mate-1215", ...campos });
  const guardada = { id: ID, nombre: "Cálculo", codigo: "MATE-1214" };

  it("lee lo guardado, escribe nombre y código normalizados con la sesión, refresca la lista y la página, y dice «Cambios guardados.»", async () => {
    h.materiaGuardada.mockResolvedValue(guardada);
    h.guardarMateria.mockResolvedValue({ tipo: "guardada", fila: { id: ID, nombre: "Cálculo I", codigo: "MATE-1215" } });
    const estado = await guardar(inicial, datos());
    expect(h.materiaGuardada).toHaveBeenCalledExactlyOnceWith(h.cliente, ID);
    expect(h.guardarMateria).toHaveBeenCalledExactlyOnceWith(h.cliente, ID, { nombre: "Cálculo I", codigo: "MATE-1215" });
    expect(h.revalidatePath).toHaveBeenCalledTimes(2);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/materias");
    // La ruta con segmento dinámico exige el tipo.
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/materias/[id]", "page");
    expect(estado).toEqual({ errores: {}, error: null, exito: "Cambios guardados.", valores: { nombre: "Cálculo I", codigo: "MATE-1215" } });
  });

  it("un id que no es un uuid da «No encontramos esa materia.» sin llamar a la base", async () => {
    expect(await guardar(inicial, datos({ id: "no-es-un-id" }))).toMatchObject({ error: MATERIA_NO_ENCONTRADA, exito: null });
    expect(await guardar(inicial, formulario({ nombre: "X", codigo: "MATE-1215" }))).toMatchObject({ error: MATERIA_NO_ENCONTRADA });
    expect(h.materiaGuardada).not.toHaveBeenCalled();
    expect(h.guardarMateria).not.toHaveBeenCalled();
  });

  it("si la materia ya no existe, antes o durante la escritura, dice «No encontramos esa materia.»", async () => {
    h.materiaGuardada.mockResolvedValueOnce(null);
    expect(await guardar(inicial, datos())).toMatchObject({ error: MATERIA_NO_ENCONTRADA });
    expect(h.guardarMateria).not.toHaveBeenCalled();

    h.materiaGuardada.mockResolvedValue(guardada);
    h.guardarMateria.mockResolvedValue({ tipo: "no_existe" });
    expect(await guardar(inicial, datos())).toMatchObject({ error: MATERIA_NO_ENCONTRADA, valores: { nombre: "Cálculo I", codigo: "mate-1215" } });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("valida contra lo guardado: un código sin forma que no cambia (PRB-1) deja corregir el nombre", async () => {
    h.materiaGuardada.mockResolvedValue({ id: ID, nombre: "Prueba", codigo: "PRB-1" });
    h.guardarMateria.mockResolvedValue({ tipo: "guardada", fila: { id: ID, nombre: "Otro nombre", codigo: "PRB-1" } });
    const estado = await guardar(inicial, datos({ nombre: "Otro nombre", codigo: "PRB-1" }));
    expect(h.guardarMateria).toHaveBeenCalledExactlyOnceWith(h.cliente, ID, { nombre: "Otro nombre", codigo: "PRB-1" });
    expect(estado.exito).toBe("Cambios guardados.");
  });

  it("y si el código cambia, se exige la forma: error junto al campo y no se escribe", async () => {
    h.materiaGuardada.mockResolvedValue({ id: ID, nombre: "Prueba", codigo: "PRB-1" });
    const estado = await guardar(inicial, datos({ codigo: "PRB-9" }));
    expect(estado).toEqual({ errores: { codigo: ERRORES.codigo }, error: null, exito: null, valores: { nombre: "Cálculo I", codigo: "PRB-9" } });
    expect(h.guardarMateria).not.toHaveBeenCalled();
  });

  it("un nombre vacío da el error junto al campo y los campos conservan lo escrito", async () => {
    h.materiaGuardada.mockResolvedValue(guardada);
    expect(await guardar(inicial, datos({ nombre: "   " }))).toEqual({
      errores: { nombre: ERRORES.nombreDeMateria },
      error: null,
      exito: null,
      valores: { nombre: "   ", codigo: "mate-1215" },
    });
  });

  it("código repetido (23505): nombra a quien lo tiene, sin contar a esta materia", async () => {
    h.materiaGuardada.mockResolvedValue(guardada);
    h.guardarMateria.mockResolvedValue({ tipo: "error", error: { code: "23505", hint: null } });
    h.quienTieneElCodigo.mockResolvedValue("Álgebra");
    const estado = await guardar(inicial, datos());
    expect(h.quienTieneElCodigo).toHaveBeenCalledExactlyOnceWith(h.cliente, "MATE-1215", ID);
    expect(estado.errores).toEqual({ codigo: "Ya existe una materia con ese código: Álgebra." });
    expect(estado.valores).toEqual({ nombre: "Cálculo I", codigo: "mate-1215" });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("otro error de la base o una lectura que falla: el error general, los campos conservados", async () => {
    h.materiaGuardada.mockResolvedValue(guardada);
    h.guardarMateria.mockResolvedValue({ tipo: "error", error: { code: "XX000", hint: null } });
    expect(await guardar(inicial, datos())).toMatchObject({ error: GUARDAR_FALLO, valores: { codigo: "mate-1215" } });
    h.materiaGuardada.mockRejectedValue(new Error("caída"));
    expect(await guardar(inicial, datos())).toMatchObject({ error: GUARDAR_FALLO, valores: { codigo: "mate-1215" } });
  });

  it("una cuenta sin permiso (42501) lo dice", async () => {
    h.materiaGuardada.mockResolvedValue(guardada);
    h.guardarMateria.mockResolvedValue({ tipo: "error", error: { code: "42501", hint: null } });
    expect(await guardar(inicial, datos())).toMatchObject({ error: SIN_PERMISO_PARA_CAMBIAR });
  });
});

describe("guardarEvaluacion", () => {
  const datos = (campos: Record<string, string> = {}) => formulario({ id: ID_EVALUACION, nombre: "Parcial 1", semana: "8", ...campos });
  const guardada = { id: ID_EVALUACION, nombre: "Parcial uno", semana: 6, idMateria: ID_MATERIA };
  const hermanas = [
    { id: ID_EVALUACION, nombre: "Parcial uno" },
    { id: "otra", nombre: "Parcial 2" },
  ];

  beforeEach(() => {
    h.evaluacionGuardada.mockResolvedValue(guardada);
    h.nombresDeLasEvaluaciones.mockResolvedValue(hermanas);
  });

  it("escribe solo nombre y semana (la semana como número), refresca y dice «Cambios guardados.»", async () => {
    h.guardarEvaluacion.mockResolvedValue({ tipo: "guardada", fila: { id: ID_EVALUACION, nombre: "Parcial 1", semana: 8 } });
    const estado = await guardarEvaluacion(inicial, datos({ nombre: "  Parcial 1 ", semana: " 8 " }));
    expect(h.nombresDeLasEvaluaciones).toHaveBeenCalledExactlyOnceWith(h.cliente, ID_MATERIA);
    expect(h.guardarEvaluacion).toHaveBeenCalledExactlyOnceWith(h.cliente, ID_EVALUACION, { nombre: "Parcial 1", semana: 8 });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/materias");
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/materias/[id]", "page");
    expect(estado).toEqual({ errores: {}, error: null, exito: "Cambios guardados.", valores: { nombre: "Parcial 1", semana: "8" } });
  });

  it("un id que no es uuid, o una evaluación que ya no existe, da «No encontramos esa evaluación.»", async () => {
    expect(await guardarEvaluacion(inicial, datos({ id: "x" }))).toMatchObject({ error: EVALUACION_NO_ENCONTRADA });
    expect(h.evaluacionGuardada).not.toHaveBeenCalled();
    h.evaluacionGuardada.mockResolvedValueOnce(null);
    expect(await guardarEvaluacion(inicial, datos())).toMatchObject({ error: EVALUACION_NO_ENCONTRADA });
    h.guardarEvaluacion.mockResolvedValue({ tipo: "no_existe" });
    expect(await guardarEvaluacion(inicial, datos())).toMatchObject({ error: EVALUACION_NO_ENCONTRADA });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["0", "1.5", "1e2", "", "٣", "2147483648"])("la semana %j da el error junto al campo y no escribe", async (semana) => {
    const estado = await guardarEvaluacion(inicial, datos({ semana }));
    expect(estado).toEqual({ errores: { semana: ERRORES.semana }, error: null, exito: null, valores: { nombre: "Parcial 1", semana } });
    expect(h.guardarEvaluacion).not.toHaveBeenCalled();
  });

  it("el nombre no puede repetir el de otra evaluación de la misma materia, sin importar mayúsculas ni espacios", async () => {
    for (const nombre of ["Parcial 2", " parcial 2 "]) {
      const estado = await guardarEvaluacion(inicial, datos({ nombre }));
      expect(estado.errores).toEqual({ nombre: ERRORES.nombreDeEvaluacionRepetido });
      expect(estado.valores.nombre).toBe(nombre);
    }
    expect(h.guardarEvaluacion).not.toHaveBeenCalled();
  });

  it("guardar sin cambiar el nombre no cuenta a la propia evaluación como duplicado", async () => {
    h.guardarEvaluacion.mockResolvedValue({ tipo: "guardada", fila: { id: ID_EVALUACION, nombre: "Parcial uno", semana: 9 } });
    const estado = await guardarEvaluacion(inicial, datos({ nombre: "Parcial uno", semana: "9" }));
    expect(estado.exito).toBe("Cambios guardados.");
    expect(h.guardarEvaluacion).toHaveBeenCalledExactlyOnceWith(h.cliente, ID_EVALUACION, { nombre: "Parcial uno", semana: 9 });
  });

  describe("una evaluación cuyo nombre ya comparte otra hermana (el banco no exige nombres únicos)", () => {
    const homonima = { id: ID_EVALUACION, nombre: "Parcial", semana: 5, idMateria: ID_MATERIA };
    const homonimas = [
      { id: ID_EVALUACION, nombre: "Parcial" },
      { id: "otra", nombre: "Parcial" },
      { id: "tercera", nombre: "Parcial 3" },
    ];

    beforeEach(() => {
      h.evaluacionGuardada.mockResolvedValue(homonima);
      h.nombresDeLasEvaluaciones.mockResolvedValue(homonimas);
      h.guardarEvaluacion.mockResolvedValue({ tipo: "guardada", fila: { id: ID_EVALUACION, nombre: "Parcial", semana: 10 } });
    });

    it("guardar solo la semana, sin tocar el nombre, se guarda", async () => {
      const estado = await guardarEvaluacion(inicial, datos({ nombre: "Parcial", semana: "10" }));
      expect(estado).toEqual({ errores: {}, error: null, exito: "Cambios guardados.", valores: { nombre: "Parcial", semana: "10" } });
      expect(h.guardarEvaluacion).toHaveBeenCalledExactlyOnceWith(h.cliente, ID_EVALUACION, { nombre: "Parcial", semana: 10 });
    });

    it("lo mismo si el nombre llega con espacios en los bordes: sigue siendo el mismo nombre", async () => {
      const estado = await guardarEvaluacion(inicial, datos({ nombre: "  Parcial ", semana: "10" }));
      expect(estado.errores).toEqual({});
      expect(estado.exito).toBe("Cambios guardados.");
      expect(h.guardarEvaluacion).toHaveBeenCalledExactlyOnceWith(h.cliente, ID_EVALUACION, { nombre: "Parcial", semana: 10 });
    });

    it("un nombre que sí cambia al de otra hermana se rechaza, también cuando el actual era un homónimo", async () => {
      const estado = await guardarEvaluacion(inicial, datos({ nombre: "Parcial 3", semana: "10" }));
      expect(estado.errores).toEqual({ nombre: ERRORES.nombreDeEvaluacionRepetido });
      expect(h.guardarEvaluacion).not.toHaveBeenCalled();
    });

    it("cambiar solo las mayúsculas hacia el nombre de una hermana también cuenta como repetido", async () => {
      const estado = await guardarEvaluacion(inicial, datos({ nombre: "parcial", semana: "10" }));
      expect(estado.errores).toEqual({ nombre: ERRORES.nombreDeEvaluacionRepetido });
      expect(h.guardarEvaluacion).not.toHaveBeenCalled();
    });

    it("una semana mala se sigue diciendo aunque el nombre no cambie", async () => {
      const estado = await guardarEvaluacion(inicial, datos({ nombre: "Parcial", semana: "0" }));
      expect(estado.errores).toEqual({ semana: ERRORES.semana });
      expect(h.guardarEvaluacion).not.toHaveBeenCalled();
    });
  });

  it("cambiar solo las mayúsculas del propio nombre no cuenta a la propia evaluación como duplicado", async () => {
    h.guardarEvaluacion.mockResolvedValue({ tipo: "guardada", fila: { id: ID_EVALUACION, nombre: "PARCIAL UNO", semana: 6 } });
    const estado = await guardarEvaluacion(inicial, datos({ nombre: "PARCIAL UNO", semana: "6" }));
    expect(h.nombresDeLasEvaluaciones).toHaveBeenCalledExactlyOnceWith(h.cliente, ID_MATERIA);
    expect(estado.exito).toBe("Cambios guardados.");
    expect(h.guardarEvaluacion).toHaveBeenCalledExactlyOnceWith(h.cliente, ID_EVALUACION, { nombre: "PARCIAL UNO", semana: 6 });
  });

  it("un nombre repetido y una semana mala se dicen a la vez", async () => {
    const estado = await guardarEvaluacion(inicial, datos({ nombre: "Parcial 2", semana: "0" }));
    expect(estado.errores).toEqual({ nombre: ERRORES.nombreDeEvaluacionRepetido, semana: ERRORES.semana });
  });

  it("un nombre vacío da su error y no se compara con las hermanas", async () => {
    const estado = await guardarEvaluacion(inicial, datos({ nombre: " " }));
    expect(estado.errores).toEqual({ nombre: ERRORES.nombreDeEvaluacion });
    expect(h.nombresDeLasEvaluaciones).not.toHaveBeenCalled();
  });

  it("el semana que no cabe en un integer (22003) y el permiso denegado (42501) se dicen", async () => {
    h.guardarEvaluacion.mockResolvedValue({ tipo: "error", error: { code: "22003", hint: null } });
    expect((await guardarEvaluacion(inicial, datos())).errores).toEqual({ semana: ERRORES.semana });
    h.guardarEvaluacion.mockResolvedValue({ tipo: "error", error: { code: "42501", hint: null } });
    expect(await guardarEvaluacion(inicial, datos())).toMatchObject({ error: SIN_PERMISO_PARA_CAMBIAR });
  });

  it("otro error o una lectura que falla: el general, con los campos conservados", async () => {
    h.guardarEvaluacion.mockResolvedValue({ tipo: "error", error: { code: "XX000", hint: null } });
    expect(await guardarEvaluacion(inicial, datos())).toEqual({
      errores: {},
      error: GUARDAR_FALLO,
      exito: null,
      valores: { nombre: "Parcial 1", semana: "8" },
    });
    expect(console.error).toHaveBeenCalledWith("[materias] no se pudo guardar la evaluación:", "código XX000");
    h.nombresDeLasEvaluaciones.mockRejectedValue(new Error("caída"));
    expect(await guardarEvaluacion(inicial, datos())).toMatchObject({ error: GUARDAR_FALLO, valores: { nombre: "Parcial 1", semana: "8" } });
  });
});

describe("borrar (una materia)", () => {
  const datos = () => formulario({ id: ID });

  it("borra con la sesión, refresca y vuelve a la lista con el nombre en la URL", async () => {
    h.borrarMateria.mockResolvedValue({ tipo: "borrada", nombre: "Cálculo Diferencial" });
    const destino = await destinoDe(() => borrar(inicialDeBorrado, datos()));
    expect(h.borrarMateria).toHaveBeenCalledExactlyOnceWith(h.cliente, ID);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/materias");
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/materias/[id]", "page");
    const url = new URL(destino, "http://calibra.test");
    expect(url.pathname).toBe("/admin/materias");
    expect(url.searchParams.get("borrada")).toBe("Cálculo Diferencial");
  });

  it("el nombre viaja codificado: un & o un # no parten la URL", async () => {
    h.borrarMateria.mockResolvedValue({ tipo: "borrada", nombre: "Física & Química #1" });
    const destino = await destinoDe(() => borrar(inicialDeBorrado, datos()));
    expect(new URL(destino, "http://calibra.test").searchParams.get("borrada")).toBe("Física & Química #1");
  });

  it("el redirect va fuera del try: sale tal cual y no se confunde con una falla", async () => {
    h.borrarMateria.mockResolvedValue({ tipo: "borrada", nombre: "Cálculo" });
    await expect(borrar(inicialDeBorrado, datos())).rejects.toBeInstanceOf(h.Redireccion);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("con algo ligado no borra y dice qué: «Ya no se puede borrar: tiene … Recarga la página.»", async () => {
    h.borrarMateria.mockResolvedValue({ tipo: "ligada", ligado: ["certificados", "monitorias"] });
    expect(await borrar(inicialDeBorrado, datos())).toEqual({ error: "Ya no se puede borrar: tiene certificados y monitorías. Recarga la página." });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("un id que ya no existe da «No encontramos esa materia. Recarga la página.»", async () => {
    h.borrarMateria.mockResolvedValue({ tipo: "no_existe" });
    expect(await borrar(inicialDeBorrado, datos())).toEqual({ error: MATERIA_NO_ENCONTRADA });
  });

  it("un id que no es uuid se dice igual, sin llamar a la base", async () => {
    expect(await borrar(inicialDeBorrado, formulario({ id: "no-es-un-id" }))).toEqual({ error: MATERIA_NO_ENCONTRADA });
    expect(await borrar(inicialDeBorrado, formulario({}))).toEqual({ error: MATERIA_NO_ENCONTRADA });
    expect(h.borrarMateria).not.toHaveBeenCalled();
  });

  it("una cuenta sin permiso para borrar lo oye", async () => {
    h.borrarMateria.mockResolvedValue({ tipo: "no_autorizado" });
    expect(await borrar(inicialDeBorrado, datos())).toEqual({ error: SIN_PERMISO_PARA_BORRAR });
  });

  it("si la base falla, o falta la conexión: «No pudimos borrar. Intenta de nuevo.» y queda en el registro", async () => {
    h.borrarMateria.mockRejectedValue(new Error("caída"));
    expect(await borrar(inicialDeBorrado, datos())).toEqual({ error: BORRAR_FALLO });
    h.cliente = null;
    expect(await borrar(inicialDeBorrado, datos())).toEqual({ error: BORRAR_FALLO });
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("borrarEvaluacion", () => {
  const datos = () => formulario({ id: ID_EVALUACION });

  it("borra con la sesión y vuelve a la página de su materia con el nombre en la URL", async () => {
    h.borrarEvaluacion.mockResolvedValue({ tipo: "borrada", nombre: "Parcial 1", idMateria: ID_MATERIA });
    const destino = await destinoDe(() => borrarEvaluacion(inicialDeBorrado, datos()));
    expect(h.borrarEvaluacion).toHaveBeenCalledExactlyOnceWith(h.cliente, ID_EVALUACION);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/materias");
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/materias/[id]", "page");
    const url = new URL(destino, "http://calibra.test");
    expect(url.pathname).toBe(`/admin/materias/${ID_MATERIA}`);
    expect(url.searchParams.get("evaluacion_borrada")).toBe("Parcial 1");
  });

  it("el redirect va fuera del try", async () => {
    h.borrarEvaluacion.mockResolvedValue({ tipo: "borrada", nombre: "Parcial 1", idMateria: ID_MATERIA });
    await expect(borrarEvaluacion(inicialDeBorrado, datos())).rejects.toBeInstanceOf(h.Redireccion);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("con temas o diagnósticos no borra y dice qué", async () => {
    h.borrarEvaluacion.mockResolvedValue({ tipo: "ligada", ligado: ["temas", "diagnosticos"] });
    expect(await borrarEvaluacion(inicialDeBorrado, datos())).toEqual({
      error: "Ya no se puede borrar: tiene temas y diagnósticos. Recarga la página.",
    });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("un id que ya no existe, o que no es uuid, da «No encontramos esa evaluación. Recarga la página.»", async () => {
    h.borrarEvaluacion.mockResolvedValue({ tipo: "no_existe" });
    expect(await borrarEvaluacion(inicialDeBorrado, datos())).toEqual({ error: EVALUACION_NO_ENCONTRADA });
    h.borrarEvaluacion.mockClear();
    expect(await borrarEvaluacion(inicialDeBorrado, formulario({ id: "x" }))).toEqual({ error: EVALUACION_NO_ENCONTRADA });
    expect(h.borrarEvaluacion).not.toHaveBeenCalled();
  });

  it("sin permiso, o con la base caída, dice lo suyo", async () => {
    h.borrarEvaluacion.mockResolvedValue({ tipo: "no_autorizado" });
    expect(await borrarEvaluacion(inicialDeBorrado, datos())).toEqual({ error: SIN_PERMISO_PARA_BORRAR });
    h.borrarEvaluacion.mockRejectedValue(new Error("caída"));
    expect(await borrarEvaluacion(inicialDeBorrado, datos())).toEqual({ error: BORRAR_FALLO });
  });
});
