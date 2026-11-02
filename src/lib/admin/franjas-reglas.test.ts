import { describe, expect, it } from "vitest";
import {
  MENSAJES_DE_FRANJA,
  MENSAJE_DE_FALLO_DE_FRANJA,
  RESULTADOS_DE_FRANJA,
  avisoDeFranja,
  esResultadoDeFranja,
  leerFranja,
} from "./franjas-reglas";

// HU-119 (D-85): la lectura del formulario y los avisos de la pantalla de franjas de oferta.

const ID = "30000000-0000-0000-0000-000000011901";

const formulario = (valores: Record<string, string>) => {
  const datos = new FormData();
  for (const [clave, valor] of Object.entries(valores)) datos.set(clave, valor);
  return datos;
};

describe("leerFranja", () => {
  it("lee el id de la franja y marcar (1) o quitar (0)", () => {
    expect(leerFranja(formulario({ id_franja: ID, de_prueba: "1" }))).toEqual({ ok: true, datos: { idFranja: ID, dePrueba: true } });
    expect(leerFranja(formulario({ id_franja: ` ${ID.toUpperCase()} `, de_prueba: "0" }))).toEqual({
      ok: true,
      datos: { idFranja: ID, dePrueba: false },
    });
  });

  it("un id que no es uuid dice que la franja no existe", () => {
    expect(leerFranja(formulario({ id_franja: "no-es-uuid", de_prueba: "1" }))).toEqual({ ok: false, error: MENSAJES_DE_FRANJA.no_existe });
    expect(leerFranja(new FormData())).toEqual({ ok: false, error: MENSAJES_DE_FRANJA.no_existe });
  });

  it.each(["", "2", "true", "si"])("marcar o quitar con %j no se envía", (valor) => {
    expect(leerFranja(formulario({ id_franja: ID, de_prueba: valor }))).toEqual({ ok: false, error: MENSAJES_DE_FRANJA.pedido_invalido });
  });
});

describe("esResultadoDeFranja", () => {
  it("reconoce lo que responde la base y nada más", () => {
    for (const r of RESULTADOS_DE_FRANJA) expect(esResultadoDeFranja(r)).toBe(true);
    expect(esResultadoDeFranja("otra_cosa")).toBe(false);
    expect(esResultadoDeFranja(null)).toBe(false);
  });
});

describe("avisoDeFranja", () => {
  it("dice qué pasó al marcar y al quitar la marca", () => {
    expect(avisoDeFranja({ franja: "marcada" })).toEqual({ exito: true, texto: "Listo: la franja ahora sale como una oferta gratis." });
    expect(avisoDeFranja({ franja: "desmarcada" })).toEqual({ exito: true, texto: "Listo: la franja volvió a su precio normal." });
  });

  it("dice por qué no se pudo, con el texto de la base", () => {
    expect(avisoDeFranja({ franja_error: "sin_permiso" })).toEqual({ exito: false, texto: MENSAJES_DE_FRANJA.sin_permiso });
    expect(avisoDeFranja({ franja_error: "ya_marcada" })).toEqual({ exito: false, texto: MENSAJES_DE_FRANJA.ya_marcada });
    expect(avisoDeFranja({ franja_error: "fallo" })).toEqual({ exito: false, texto: MENSAJE_DE_FALLO_DE_FRANJA });
  });

  it("un enlace escrito a mano no anuncia nada que no existe", () => {
    expect(avisoDeFranja({})).toBeNull();
    expect(avisoDeFranja({ franja: "hackeada" })).toBeNull();
    expect(avisoDeFranja({ franja_error: "marcada" })).toBeNull();
    expect(avisoDeFranja({ franja_error: "<script>" })).toBeNull();
  });

  it("el aviso de la oferta no usa la palabra «prueba» que ve el estudiante", () => {
    expect(avisoDeFranja({ franja: "marcada" })?.texto).not.toMatch(/prueba/i);
  });
});
