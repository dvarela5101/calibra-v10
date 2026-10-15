import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILA_DE_EJEMPLO } from "../../../../pruebas/diagnostico-sembrado";
import type { Rol } from "@/lib/auth/roles";
import { proyectarResultado } from "@/lib/diagnostico/mostrar";
import { CLAVES_DE_LAS_ACCIONES } from "@/lib/diagnostico/pantalla";
import { TEXTOS } from "@/lib/diagnostico/presentacion";
import {
  proyectarEnCurso,
  proyectarNinguno,
  proyectarNoDisponible,
  proyectarSinPreguntas,
  proyectarTerminado,
  type EnCurso,
} from "@/lib/diagnostico/reglas";

// HU-009: las dos Server Actions con sus dependencias falsas: la sesión, el módulo del servidor del diagnóstico (HU-081), la
// lectura del último resultado y el cliente de Supabase. Lo que la e2e no alcanza porque la interfaz nunca manda esos datos
// (una letra mala, un pedido que no es un objeto, una cuenta del equipo con la interfaz distinta) se fija aquí.

const falsos = vi.hoisted(() => ({
  sesion: null as { idUsuario: string; rol: Rol | null } | null,
  iniciar: vi.fn(),
  responder: vi.fn(),
  leer: vi.fn(),
  cliente: { rpc: vi.fn() } as { rpc: unknown } | null,
  // HU-031: lo que se programa para después de responder, sin correrlo.
  programadas: [] as (() => Promise<unknown>)[],
  mandar: vi.fn(),
}));

vi.mock("@/lib/auth/sesion", () => ({ obtenerSesion: async () => falsos.sesion }));
vi.mock("@/lib/diagnostico/servidor", () => ({
  iniciarDiagnostico: (...args: unknown[]) => falsos.iniciar(...args),
  responderDiagnostico: (...args: unknown[]) => falsos.responder(...args),
}));
vi.mock("@/lib/diagnostico/lectura", () => ({ leerMiDiagnostico: (...args: unknown[]) => falsos.leer(...args) }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => falsos.cliente }));
vi.mock("@/lib/diagnostico/recuperacion", () => ({
  programarEnlace: (tarea: () => Promise<unknown>) => falsos.programadas.push(tarea),
  mandarEnlaceDeResultados: (...args: unknown[]) => falsos.mandar(...args),
}));

import { empezarDiagnostico, responderPregunta } from "./acciones";

const PERSONA = { idUsuario: "5e000000-0000-4000-8000-000000000001", rol: "anonimo" as const };
const ID_EVALUACION = "e0000000-0000-4000-8000-00000000000a";
const ID_DIAGNOSTICO = "d1000000-0000-4000-8000-000000000001";
const ID_OTRO = "d2000000-0000-4000-8000-000000000002";
const ID_ULTIMO = FILA_DE_EJEMPLO.id_diagnostico;

function enCurso(idDiagnostico = ID_DIAGNOSTICO, paso = 0): EnCurso {
  return proyectarEnCurso({
    idDiagnostico,
    evaluacion: { id: ID_EVALUACION, nombre: "Parcial 1" },
    materia: { codigo: "FISI-1528", nombre: "Física II" },
    paso,
    maximo: 8,
    pregunta: {
      enunciado: "Pregunta",
      opciones: [
        { letra: "A", texto: "a" },
        { letra: "B", texto: "b" },
        { letra: "C", texto: "c" },
        { letra: "D", texto: "d" },
      ],
    },
  });
}

beforeEach(() => {
  falsos.sesion = PERSONA;
  falsos.cliente = { rpc: vi.fn() };
  for (const falso of [falsos.iniciar, falsos.responder, falsos.leer]) falso.mockReset();
  falsos.iniciar.mockResolvedValue(enCurso());
  falsos.responder.mockResolvedValue(enCurso(ID_DIAGNOSTICO, 1));
  falsos.leer.mockResolvedValue(proyectarResultado(FILA_DE_EJEMPLO));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("empezarDiagnostico: quién puede empezar", () => {
  it("sin sesión no llama al módulo", async () => {
    falsos.sesion = null;
    expect(await empezarDiagnostico({ idEvaluacion: ID_EVALUACION })).toEqual({ tipo: "error", mensaje: TEXTOS.sinSesion });
    expect(falsos.iniciar).not.toHaveBeenCalled();
  });

  it.each(["monitor", "admin"] as const)("con una cuenta de %s no llama al módulo y avisa como al agendar (M26)", async (rol) => {
    falsos.sesion = { idUsuario: PERSONA.idUsuario, rol };
    const respuesta = await empezarDiagnostico({ idEvaluacion: ID_EVALUACION });
    expect(respuesta).toEqual({ tipo: "error", mensaje: TEXTOS.cuentaDelEquipo });
    expect(falsos.iniciar).not.toHaveBeenCalled();
  });

  it.each(["anonimo", "estudiante", null] as const)("con el rol %s sí llega al módulo", async (rol) => {
    falsos.sesion = { idUsuario: PERSONA.idUsuario, rol };
    await empezarDiagnostico({ idEvaluacion: ID_EVALUACION });
    expect(falsos.iniciar).toHaveBeenCalledOnce();
  });
});

describe("empezarDiagnostico: lo que llega del navegador", () => {
  it.each([[null], [undefined], ["x"], [5], [{}], [[]]])("%j no lanza: el módulo responde que la Evaluación no está disponible (M41)", async (pedido) => {
    falsos.iniciar.mockResolvedValue(proyectarNoDisponible("evaluacion"));
    await expect(empezarDiagnostico(pedido)).resolves.toEqual({ tipo: "no_disponible", mensaje: "Esa evaluación no está disponible" });
    expect(falsos.iniciar).toHaveBeenCalledWith(PERSONA, { idEvaluacion: undefined, volverATomar: false });
  });

  it("pasa la Evaluación y, solo con true exacto, volverATomar", async () => {
    await empezarDiagnostico({ idEvaluacion: ID_EVALUACION, volverATomar: true });
    await empezarDiagnostico({ idEvaluacion: ID_EVALUACION, volverATomar: "true" });
    expect(falsos.iniciar).toHaveBeenNthCalledWith(1, PERSONA, { idEvaluacion: ID_EVALUACION, volverATomar: true });
    expect(falsos.iniciar).toHaveBeenNthCalledWith(2, PERSONA, { idEvaluacion: ID_EVALUACION, volverATomar: false });
  });

  it("la sesión que usa es la de quien llama, no un dato del pedido", async () => {
    await empezarDiagnostico({ idEvaluacion: ID_EVALUACION, idUsuario: "otra-persona", sesion: { rol: "admin" } });
    expect(falsos.iniciar.mock.calls[0][0]).toBe(PERSONA);
    expect(falsos.iniciar.mock.calls[0][1]).toEqual({ idEvaluacion: ID_EVALUACION, volverATomar: false });
  });
});

describe("empezarDiagnostico: lo que responde", () => {
  it("una pregunta pendiente", async () => {
    const pendiente = enCurso();
    falsos.iniciar.mockResolvedValue(pendiente);
    expect(await empezarDiagnostico({ idEvaluacion: ID_EVALUACION })).toEqual({ tipo: "pregunta", enCurso: pendiente });
  });

  it("un módulo que lanza da el mensaje genérico y no filtra el texto del error", async () => {
    falsos.iniciar.mockRejectedValue(new Error("TEXTO-INTERNO-CON-LA-SEMILLA"));
    const respuesta = await empezarDiagnostico({ idEvaluacion: ID_EVALUACION });
    expect(respuesta).toEqual({ tipo: "error", mensaje: TEXTOS.errorAlEmpezar });
    expect(JSON.stringify(respuesta)).not.toContain("SEMILLA");
  });

  it("un cuenta del equipo que el módulo rechaza da el aviso del equipo", async () => {
    falsos.iniciar.mockResolvedValue(proyectarNoDisponible("cuenta_del_equipo"));
    expect(await empezarDiagnostico({ idEvaluacion: ID_EVALUACION })).toEqual({ tipo: "error", mensaje: TEXTOS.cuentaDelEquipo });
  });
});

describe("empezarDiagnostico: sin preguntas nuevas (D-51)", () => {
  beforeEach(() => {
    falsos.iniciar.mockResolvedValue(proyectarSinPreguntas(ID_ULTIMO));
  });

  it("lee el último resultado con el cliente de la sesión de quien llama y lo entrega proyectado", async () => {
    const respuesta = await empezarDiagnostico({ idEvaluacion: ID_EVALUACION });
    expect(falsos.leer).toHaveBeenCalledExactlyOnceWith(falsos.cliente, ID_ULTIMO);
    expect(respuesta).toEqual({ tipo: "sin_preguntas", ultimo: proyectarResultado(FILA_DE_EJEMPLO) });
  });

  it("no entrega idUltimoDiagnostico (M44): el navegador no necesita el id de otro diagnóstico", async () => {
    const respuesta = await empezarDiagnostico({ idEvaluacion: ID_EVALUACION });
    expect(JSON.stringify(respuesta)).not.toContain("idUltimoDiagnostico");
    expect(Object.keys(respuesta).filter((clave) => !CLAVES_DE_LAS_ACCIONES.includes(clave))).toEqual([]);
  });

  it("si la lectura falla, ultimo es null y el mensaje y la pregunta salen igual", async () => {
    falsos.leer.mockRejectedValue(new Error("DETALLE-INTERNO"));
    const respuesta = await empezarDiagnostico({ idEvaluacion: ID_EVALUACION });
    expect(respuesta).toEqual({ tipo: "sin_preguntas", ultimo: null });
  });

  it("si no hay fila (el último lo hizo otra sesión de su Lead, D-53 e), ultimo es null", async () => {
    falsos.leer.mockResolvedValue(null);
    expect(await empezarDiagnostico({ idEvaluacion: ID_EVALUACION })).toEqual({ tipo: "sin_preguntas", ultimo: null });
  });

  it("sin id del último diagnóstico no se lee nada", async () => {
    falsos.iniciar.mockResolvedValue(proyectarSinPreguntas(null));
    expect(await empezarDiagnostico({ idEvaluacion: ID_EVALUACION })).toEqual({ tipo: "sin_preguntas", ultimo: null });
    expect(falsos.leer).not.toHaveBeenCalled();
  });

  it("sin cliente de Supabase, ultimo es null", async () => {
    falsos.cliente = null;
    expect(await empezarDiagnostico({ idEvaluacion: ID_EVALUACION })).toEqual({ tipo: "sin_preguntas", ultimo: null });
    expect(falsos.leer).not.toHaveBeenCalled();
  });
});

describe("responderPregunta: quién puede responder", () => {
  const pedido = { idDiagnostico: ID_DIAGNOSTICO, paso: 0, letra: "B" };

  it("sin sesión no llama al módulo", async () => {
    falsos.sesion = null;
    expect(await responderPregunta(pedido)).toEqual({ tipo: "error", mensaje: TEXTOS.sinSesion });
    expect(falsos.responder).not.toHaveBeenCalled();
  });

  it.each(["monitor", "admin"] as const)("con una cuenta de %s no llama al módulo y el mensaje es el del equipo, no «ya no está» (M26)", async (rol) => {
    falsos.sesion = { idUsuario: PERSONA.idUsuario, rol };
    const respuesta = await responderPregunta(pedido);
    expect(respuesta).toEqual({ tipo: "error", mensaje: TEXTOS.cuentaDelEquipo });
    expect(falsos.responder).not.toHaveBeenCalled();
  });
});

describe("responderPregunta: lo que llega del navegador", () => {
  it.each([["E"], [""], [null], [undefined], ["a"], [1], [["A"]]])("la letra %j no llega al módulo y devuelve «Elige una opción» (M25)", async (letra) => {
    const respuesta = await responderPregunta({ idDiagnostico: ID_DIAGNOSTICO, paso: 0, letra });
    expect(respuesta).toEqual({ tipo: "error", mensaje: "Elige una opción" });
    expect(falsos.responder).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined], ["A"], [5], [[]]])("un pedido que es %j no llega al módulo y no lanza", async (pedido) => {
    await expect(responderPregunta(pedido)).resolves.toEqual({ tipo: "error", mensaje: "Elige una opción" });
    expect(falsos.responder).not.toHaveBeenCalled();
  });

  it("pasa el id, el paso y la letra tal cual: el módulo valida el id y el paso", async () => {
    await responderPregunta({ idDiagnostico: "no-es-uuid", paso: -3, letra: "D", extra: "x" });
    expect(falsos.responder).toHaveBeenCalledExactlyOnceWith(PERSONA, { idDiagnostico: "no-es-uuid", paso: -3, letra: "D" });
  });
});

describe("responderPregunta: lo que responde", () => {
  const pedido = { idDiagnostico: ID_DIAGNOSTICO, paso: 0, letra: "C" };

  it("la siguiente pregunta del mismo diagnóstico", async () => {
    const siguiente = enCurso(ID_DIAGNOSTICO, 1);
    falsos.responder.mockResolvedValue(siguiente);
    expect(await responderPregunta(pedido)).toEqual({ tipo: "pregunta", enCurso: siguiente });
  });

  it("otro diagnóstico en curso es «reemplazado» (M23)", async () => {
    const otro = enCurso(ID_OTRO);
    falsos.responder.mockResolvedValue(otro);
    expect(await responderPregunta(pedido)).toEqual({ tipo: "reemplazado", enCurso: otro });
  });

  it("terminado lleva la ruta del resultado", async () => {
    falsos.responder.mockResolvedValue(proyectarTerminado(ID_DIAGNOSTICO));
    expect(await responderPregunta(pedido)).toEqual({ tipo: "terminado", ruta: `/diagnostico/resultado/${ID_DIAGNOSTICO}` });
  });

  it("terminado programa el enlace de resultados de ese diagnóstico para después de responder (HU-031)", async () => {
    falsos.programadas = [];
    // El proveedor nunca contesta: la acción responde igual, porque el envío no se espera.
    falsos.mandar.mockReset().mockReturnValue(new Promise(() => {}));
    falsos.responder.mockResolvedValue(proyectarTerminado(ID_DIAGNOSTICO));
    await expect(responderPregunta(pedido)).resolves.toMatchObject({ tipo: "terminado" });
    expect(falsos.mandar).not.toHaveBeenCalled();
    expect(falsos.programadas).toHaveLength(1);
    void falsos.programadas[0]();
    expect(falsos.mandar).toHaveBeenCalledExactlyOnceWith(ID_DIAGNOSTICO);
  });

  it("una pregunta siguiente, un reemplazo o un vencido no programan el enlace (HU-031)", async () => {
    falsos.programadas = [];
    for (const respuesta of [enCurso(ID_DIAGNOSTICO, 1), enCurso(ID_OTRO), proyectarNinguno()]) {
      falsos.responder.mockResolvedValue(respuesta);
      await responderPregunta(pedido);
    }
    expect(falsos.programadas).toHaveLength(0);
  });

  it("ninguno es un diagnóstico vencido", async () => {
    falsos.responder.mockResolvedValue(proyectarNinguno());
    expect(await responderPregunta(pedido)).toEqual({ tipo: "vencido" });
  });

  it("un módulo que lanza da el mensaje genérico y no filtra el texto del error", async () => {
    falsos.responder.mockRejectedValue(new Error("SOLUCION-SECRETA-DE-LA-PREGUNTA"));
    const respuesta = await responderPregunta(pedido);
    expect(respuesta).toEqual({ tipo: "error", mensaje: "No pudimos guardar tu respuesta. Inténtalo de nuevo." });
    expect(JSON.stringify(respuesta)).not.toContain("SECRETA");
  });

  it("el error que se registra no es el objeto del error, solo su mensaje", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fallo = new Error("mensaje del módulo");
    falsos.responder.mockRejectedValue(fallo);
    await responderPregunta(pedido);
    expect(registro).toHaveBeenCalledWith(expect.any(String), "mensaje del módulo");
  });
});
