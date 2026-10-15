import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rol } from "@/lib/auth/roles";
import type { MateriaConEvaluaciones } from "@/lib/diagnostico/pantalla";
import { proyectarEnCurso, proyectarNinguno, type EnCurso } from "@/lib/diagnostico/reglas";

// HU-009: la página del selector y del recorrido, sin navegador ni base. La sesión, el diagnóstico en curso y las materias son
// inventados; se lee lo que la página le entrega a `Recorrido` o el HTML del error de carga.

const falsos = vi.hoisted(() => ({
  conexion: vi.fn(),
  sesion: null as { idUsuario: string; rol: Rol | null } | null,
  fallaDeSesion: null as Error | null,
  enCurso: vi.fn(),
  materias: vi.fn(),
}));

vi.mock("@/lib/auth/sesion", () => ({
  obtenerSesion: async () => {
    if (falsos.fallaDeSesion) throw falsos.fallaDeSesion;
    return falsos.sesion;
  },
}));
vi.mock("next/server", () => ({ connection: async () => falsos.conexion() }));
// Los errores con que Next corta el prerenderizado (los de `cookies()`) llevan un `digest`: `unstable_rethrow` los vuelve a lanzar.
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if ((error as { digest?: string } | null)?.digest === "DYNAMIC_SERVER_USAGE") throw error;
  },
}));
vi.mock("@/lib/diagnostico/servidor", () => ({ diagnosticoEnCurso: (...args: unknown[]) => falsos.enCurso(...args) }));
vi.mock("@/lib/diagnostico/selector", () => ({ cargarEvaluacionesActivas: () => falsos.materias() }));

import Diagnostico, { metadata } from "./page";
import { Recorrido } from "./Recorrido";

const PERSONA = { idUsuario: "5e000000-0000-4000-8000-000000000001", rol: "anonimo" as const };
const MATERIAS: MateriaConEvaluaciones[] = [
  { codigo: "FISI-1528", nombre: "Física II", evaluaciones: [{ id: "e0000000-0000-4000-8000-00000000000a", nombre: "Parcial 1", semana: 4, temas: ["Cinemática"] }] },
];

const PENDIENTE: EnCurso = proyectarEnCurso({
  idDiagnostico: "d1000000-0000-4000-8000-000000000001",
  evaluacion: { id: "e0000000-0000-4000-8000-00000000000a", nombre: "Parcial 1" },
  materia: { codigo: "FISI-1528", nombre: "Física II" },
  paso: 2,
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

/** Lo que la página le pasa a `Recorrido`. */
async function propsDelRecorrido() {
  const elemento = await Diagnostico();
  expect(isValidElement(elemento)).toBe(true);
  expect((elemento as { type: unknown }).type).toBe(Recorrido);
  return (elemento as unknown as { props: { inicial: unknown; materias: unknown } }).props;
}

beforeEach(() => {
  falsos.sesion = PERSONA;
  falsos.fallaDeSesion = null;
  falsos.conexion.mockReset();
  falsos.enCurso.mockReset().mockResolvedValue(proyectarNinguno());
  falsos.materias.mockReset().mockResolvedValue(MATERIAS);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("/diagnostico", () => {
  it("el título de la pestaña", () => {
    expect(metadata.title).toBe("Diagnóstico · Calibra");
  });

  it("nunca se prerenderiza: pide la conexión antes de leer nada (criterio 13, Cache-Control privado)", async () => {
    falsos.enCurso.mockImplementation(() => {
      expect(falsos.conexion).toHaveBeenCalledOnce();
      return Promise.resolve(proyectarNinguno());
    });
    await propsDelRecorrido();
    expect(falsos.conexion).toHaveBeenCalledOnce();
    expect(falsos.enCurso).toHaveBeenCalledOnce();
  });

  it("sin diagnóstico en curso muestra el selector con las materias, sin robar el foco", async () => {
    const props = await propsDelRecorrido();
    expect(props.inicial).toEqual({ tipo: "selector", enCurso: null, mensaje: null, enfocar: false });
    expect(props.materias).toEqual(MATERIAS);
    expect(falsos.enCurso).toHaveBeenCalledExactlyOnceWith(PERSONA);
  });

  it("con un diagnóstico en curso pinta la pregunta pendiente y no el selector (criterio 7)", async () => {
    falsos.enCurso.mockResolvedValue(PENDIENTE);
    const props = await propsDelRecorrido();
    expect(props.inicial).toEqual({ tipo: "pregunta", enCurso: PENDIENTE, mensaje: null, enfocar: false });
  });

  it("sin sesión (la primera visita) muestra el selector y no consulta nada en curso", async () => {
    falsos.sesion = null;
    const props = await propsDelRecorrido();
    expect(props.inicial).toMatchObject({ tipo: "selector", enCurso: null });
    expect(props.materias).toEqual(MATERIAS);
    expect(falsos.enCurso).not.toHaveBeenCalled();
  });

  it.each(["monitor", "admin"] as const)("con una cuenta de %s ve el selector y no consulta nada en curso (el aviso sale al pulsar «Empezar»)", async (rol) => {
    falsos.sesion = { idUsuario: PERSONA.idUsuario, rol };
    const props = await propsDelRecorrido();
    expect(props.inicial).toMatchObject({ tipo: "selector", enCurso: null });
    expect(falsos.enCurso).not.toHaveBeenCalled();
  });

  it("sin materias con Evaluación activa también entrega el selector, con la lista vacía", async () => {
    falsos.materias.mockResolvedValue([]);
    const props = await propsDelRecorrido();
    expect(props.materias).toEqual([]);
  });

  describe("si falla la carga: el mensaje del criterio 2, con role=alert", () => {
    const MENSAJE = "No pudimos cargar el diagnóstico. Recarga la página; si sigue igual, inténtalo más tarde.";

    async function html() {
      return renderToStaticMarkup(await Diagnostico());
    }

    it("la lectura del diagnóstico en curso lanza", async () => {
      falsos.enCurso.mockRejectedValue(new Error("falló"));
      const pagina = await html();
      expect(pagina).toContain(MENSAJE);
      expect(pagina).toMatch(/<p role="alert"[^>]*>No pudimos cargar el diagnóstico/);
    });

    it("la carga de las materias lanza", async () => {
      falsos.materias.mockRejectedValue(new Error("falló"));
      expect(await html()).toContain(MENSAJE);
    });

    it("el error con que Next corta el prerenderizado (cookies) no se atrapa como un fallo de carga", async () => {
      falsos.fallaDeSesion = Object.assign(new Error("Dynamic server usage"), { digest: "DYNAMIC_SERVER_USAGE" });
      await expect(Diagnostico()).rejects.toBe(falsos.fallaDeSesion);
      // Un fallo cualquiera de la sesión sí es un fallo de carga.
      falsos.fallaDeSesion = new Error("falló");
      expect(await html()).toContain(MENSAJE);
    });

    it("no filtra el texto del error", async () => {
      falsos.materias.mockRejectedValue(new Error("DETALLE-INTERNO-DE-LA-BASE"));
      expect(await html()).not.toContain("DETALLE-INTERNO");
    });
  });
});
