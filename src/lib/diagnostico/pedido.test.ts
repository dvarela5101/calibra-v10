import { describe, expect, it } from "vitest";
import { leerPedidoDeEmpezar, leerPedidoDeResponder } from "./pedido";

// HU-009: lo que llega del navegador a las Server Actions. Una Server Action es un POST público: lo arma quien la llame.

const ID = "3f8a9c52-7d1e-4b6a-9e20-5c4d8a1b7f03";

describe("leerPedidoDeEmpezar", () => {
  it.each([[null], [undefined], [5], ["texto"], [true], [[]], [[{ idEvaluacion: ID }]]])("%j no lanza y deja la Evaluación sin definir", (pedido) => {
    expect(leerPedidoDeEmpezar(pedido)).toEqual({ idEvaluacion: undefined, volverATomar: false });
  });

  it("un objeto vacío deja la Evaluación sin definir", () => {
    expect(leerPedidoDeEmpezar({})).toEqual({ idEvaluacion: undefined, volverATomar: false });
  });

  it("deja pasar el id tal cual, aunque no sea un UUID: el módulo del servidor responde «no disponible»", () => {
    expect(leerPedidoDeEmpezar({ idEvaluacion: 5 })).toEqual({ idEvaluacion: 5, volverATomar: false });
    expect(leerPedidoDeEmpezar({ idEvaluacion: ID })).toEqual({ idEvaluacion: ID, volverATomar: false });
  });

  it("volverATomar es verdadero solo si llegó exactamente true", () => {
    expect(leerPedidoDeEmpezar({ idEvaluacion: ID, volverATomar: true }).volverATomar).toBe(true);
    for (const valor of ["true", 1, "si", {}, [], null, undefined, false, 0]) {
      expect(leerPedidoDeEmpezar({ idEvaluacion: ID, volverATomar: valor }).volverATomar, JSON.stringify(valor)).toBe(false);
    }
  });

  it("no pasa claves de más", () => {
    expect(Object.keys(leerPedidoDeEmpezar({ idEvaluacion: ID, volverATomar: true, rol: "admin", idUsuario: "otro" })).sort()).toEqual(["idEvaluacion", "volverATomar"]);
  });
});

describe("leerPedidoDeResponder", () => {
  const pedido = (letra: unknown) => ({ idDiagnostico: ID, paso: 2, letra });

  it.each(["A", "B", "C", "D"])("la letra %s es válida", (letra) => {
    expect(leerPedidoDeResponder(pedido(letra))).toEqual({ idDiagnostico: ID, paso: 2, letra });
  });

  it.each([["a"], ["E"], [""], ["AB"], [" A"], [null], [undefined], [1], [["A"]], [{}]])("la letra %j no es válida: null, y el módulo no se llama", (letra) => {
    expect(leerPedidoDeResponder(pedido(letra))).toBeNull();
  });

  it.each([[null], [undefined], [5], ["A"], [true], [[]], [["A"]]])("un pedido que es %j devuelve null", (entrada) => {
    expect(leerPedidoDeResponder(entrada)).toBeNull();
  });

  it("un objeto sin letra devuelve null", () => {
    expect(leerPedidoDeResponder({})).toBeNull();
    expect(leerPedidoDeResponder({ idDiagnostico: ID, paso: 0 })).toBeNull();
  });

  it("un id o un paso malo no es null: el módulo ya los valida y devuelve el estado actual", () => {
    expect(leerPedidoDeResponder({ idDiagnostico: 5, paso: "x", letra: "A" })).toEqual({ idDiagnostico: 5, paso: "x", letra: "A" });
    expect(leerPedidoDeResponder({ letra: "B" })).toEqual({ idDiagnostico: undefined, paso: undefined, letra: "B" });
  });

  it("no pasa claves de más", () => {
    expect(Object.keys(leerPedidoDeResponder({ ...pedido("A"), rol: "admin", idUsuario: "otro" }) ?? {}).sort()).toEqual(["idDiagnostico", "letra", "paso"]);
  });
});
