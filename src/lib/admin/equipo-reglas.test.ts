import { describe, expect, it } from "vitest";
import {
  esDireccion,
  esResultadoDeMover,
  MENSAJES_DE_MOVER,
  MENSAJES_PARA_NO_DESACTIVAR,
  motivoParaNoDesactivar,
  RESULTADOS_DE_MOVER,
  siguienteActivo,
  textoDeCasos,
  type MiembroDelEquipo,
} from "./equipo-reglas";

const miembro = (id: string, ordenRevision: number, activo = true, casosAbiertos = 0): MiembroDelEquipo => ({
  id,
  nombre: `Admin ${id}`,
  correo: `${id}@calibra.test`,
  ordenRevision,
  activo,
  casosAbiertos,
});

// a (1), b (2, desactivado), c (3), d (4)
const EQUIPO = [miembro("c", 3), miembro("a", 1), miembro("d", 4), miembro("b", 2, false)];

describe("siguienteActivo (RN-07)", () => {
  it("es el activo que sigue en el orden, saltándose a los desactivados", () => {
    expect(siguienteActivo(EQUIPO, "a")?.id).toBe("c");
    expect(siguienteActivo(EQUIPO, "c")?.id).toBe("d");
    expect(siguienteActivo(EQUIPO, "b")?.id).toBe("c");
  });

  it("al pasar el último vuelve al primero activo, y nunca es el mismo", () => {
    expect(siguienteActivo(EQUIPO, "d")?.id).toBe("a");
    expect(siguienteActivo([miembro("a", 1), miembro("b", 2, false)], "a")).toBeNull();
  });

  it("sin un admin conocido, el primero activo", () => {
    expect(siguienteActivo(EQUIPO, "otro")?.id).toBe("a");
    expect(siguienteActivo([], "otro")).toBeNull();
  });
});

describe("motivoParaNoDesactivar", () => {
  it("se puede desactivar a otro admin activo si queda alguno activo", () => {
    expect(motivoParaNoDesactivar(EQUIPO, "a", "c")).toBeNull();
  });

  it("nadie se desactiva a sí mismo", () => {
    expect(motivoParaNoDesactivar(EQUIPO, "a", "a")).toBe("propio");
  });

  it("no a quien no está en el equipo ni a quien ya está desactivado", () => {
    expect(motivoParaNoDesactivar(EQUIPO, "a", "x")).toBe("no_encontrado");
    expect(motivoParaNoDesactivar(EQUIPO, "a", "b")).toBe("ya_inactivo");
  });

  it("el equipo no se queda sin admins activos", () => {
    // Quien pide es a; el objetivo, c, es el único otro activo... pero a también lo es: sí se puede.
    expect(motivoParaNoDesactivar([miembro("a", 1), miembro("c", 2)], "a", "c")).toBeNull();
    // Si el único activo es el objetivo (quien pide quedó desactivado a mitad de camino), no.
    expect(motivoParaNoDesactivar([miembro("a", 1, false), miembro("c", 2)], "a", "c")).toBe("ultimo_activo");
  });

  it("cada motivo tiene su mensaje", () => {
    for (const motivo of ["propio", "no_encontrado", "ya_inactivo", "ultimo_activo"] as const) {
      expect(MENSAJES_PARA_NO_DESACTIVAR[motivo]).toMatch(/\S/);
    }
  });
});

describe("mover", () => {
  it("reconoce las respuestas de la base y las direcciones, y cada respuesta que no mueve tiene su mensaje", () => {
    for (const r of RESULTADOS_DE_MOVER) expect(esResultadoDeMover(r)).toBe(true);
    expect(esResultadoDeMover("otro")).toBe(false);
    for (const r of RESULTADOS_DE_MOVER.filter((r) => r !== "movido")) expect(MENSAJES_DE_MOVER[r]).toMatch(/\S/);
    expect(esDireccion("arriba")).toBe(true);
    expect(esDireccion("abajo")).toBe(true);
    expect(esDireccion("izquierda")).toBe(false);
    expect(esDireccion(null)).toBe(false);
  });
});

describe("textoDeCasos", () => {
  it("cuenta en singular y plural", () => {
    expect(textoDeCasos(0)).toBe("Sin casos abiertos");
    expect(textoDeCasos(1)).toBe("1 caso abierto");
    expect(textoDeCasos(3)).toBe("3 casos abiertos");
  });
});
