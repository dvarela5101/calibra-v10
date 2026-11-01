import { describe, expect, it } from "vitest";
import {
  accionDeGratis,
  avisosDeMarca,
  CAMBIOS_DE_LA_MARCA,
  CONSECUENCIAS_DE_GRATIS,
  esResultadoDeMarca,
  leerMarca,
  MENSAJES_DE_MARCA,
  RESULTADOS_DE_MARCA,
  TEXTOS_DEL_BOTON,
  type MarcaRegistrada,
} from "./gratis-reglas";

// HU-116 (D-84): lo puro de la marca de prueba. Qué ofrece la ficha con los mismos bordes que la base (P-40, RN-34, RN-64),
// la lectura del formulario, los avisos tras la acción y que ningún texto lleva cifras de comisión. La base de verdad la cubre
// supabase/tests/monitoria_gratis.test.sql.

const ID = "16161616-0000-4000-8000-000000000116";
const YO = "a0a0a0a0-0000-4000-8000-000000000116";
const OTRO = "a0a0a0a0-0000-4000-8000-000000001160";

const AHORA = new Date("2030-01-07T09:00:00.000Z");
const INICIO = new Date("2030-01-07T15:00:00.000Z");
const RESERVA = new Date("2030-01-07T09:05:00.000Z");

const porPagar = { estado: "pendiente_pago" as const, grupal: false, gratis: false, inicio: INICIO, reservaHasta: RESERVA, pagos: [] };
const gratis = { ...porPagar, estado: "confirmada" as const, gratis: true };

describe("accionDeGratis: qué ofrece la ficha", () => {
  it("una individual por pagar, con la reserva vigente y sin pagos, se marca", () => {
    expect(accionDeGratis(porPagar, AHORA)).toBe("marcar");
  });

  it("en el instante exacto del fin de la reserva todavía se marca; un milisegundo después ya no (P-40, RN-34)", () => {
    expect(accionDeGratis(porPagar, RESERVA)).toBe("marcar");
    expect(accionDeGratis(porPagar, new Date(RESERVA.getTime() + 1))).toBeNull();
  });

  it("con un pago, grupal, o en otro estado no se marca", () => {
    expect(accionDeGratis({ ...porPagar, pagos: [{}] }, AHORA)).toBeNull();
    expect(accionDeGratis({ ...porPagar, grupal: true }, AHORA)).toBeNull();
    for (const estado of ["confirmada", "realizada", "cancelada"] as const) expect(accionDeGratis({ ...porPagar, estado }, AHORA), estado).toBeNull();
  });

  it("una gratis confirmada se desmarca hasta un instante antes del inicio; desde el inicio exacto ya no (RN-64)", () => {
    expect(accionDeGratis(gratis, AHORA)).toBe("desmarcar");
    expect(accionDeGratis(gratis, new Date(INICIO.getTime() - 1))).toBe("desmarcar");
    expect(accionDeGratis(gratis, INICIO)).toBeNull();
  });

  it("una gratis realizada o cancelada no se marca ni se desmarca", () => {
    for (const estado of ["realizada", "cancelada"] as const) expect(accionDeGratis({ ...gratis, estado }, AHORA), estado).toBeNull();
  });
});

describe("leerMarca: el formulario", () => {
  const datos = (campos: Record<string, string>) => {
    const formulario = new FormData();
    for (const [campo, valor] of Object.entries(campos)) formulario.set(campo, valor);
    return formulario;
  };

  it("lee el id normalizado y la acción: 1 marca, 0 desmarca", () => {
    expect(leerMarca(datos({ id_monitoria: ` ${ID.toUpperCase()} `, gratis: "1" }))).toEqual({ ok: true, datos: { idMonitoria: ID, gratis: true } });
    expect(leerMarca(datos({ id_monitoria: ID, gratis: "0" }))).toEqual({ ok: true, datos: { idMonitoria: ID, gratis: false } });
  });

  it("un id que no es uuid o una acción desconocida no llega a la base", () => {
    expect(leerMarca(datos({ id_monitoria: "no", gratis: "1" }))).toEqual({ ok: false, error: MENSAJES_DE_MARCA.no_existe });
    for (const gratis of ["", "true", "2", "sí"]) {
      expect(leerMarca(datos({ id_monitoria: ID, gratis })), gratis).toEqual({ ok: false, error: MENSAJES_DE_MARCA.pedido_invalido });
    }
  });
});

describe("avisosDeMarca: lo que se dice arriba de la ficha", () => {
  const marca = (cambios: Partial<MarcaRegistrada> = {}): MarcaRegistrada => ({
    gratis: true,
    hechaEn: AHORA,
    idAdmin: YO,
    nombreAdmin: "Admin Uno",
    ...cambios,
  });

  it("el éxito solo si la última marca es del admin de la sesión y coincide con el estado", () => {
    expect(avisosDeMarca({ gratis: "marcada" }, { gratis: true, ultimaMarca: marca() }, YO)).toEqual([
      { exito: true, texto: expect.stringContaining("Marcaste la monitoría como de prueba") },
    ]);
    expect(avisosDeMarca({ gratis: "desmarcada" }, { gratis: false, ultimaMarca: marca({ gratis: false }) }, YO)).toEqual([
      { exito: true, texto: expect.stringContaining("Quitaste la marca de prueba") },
    ]);
  });

  it("un enlace viejo, escrito a mano o la marca de otro admin no anuncian nada", () => {
    expect(avisosDeMarca({ gratis: "marcada" }, { gratis: true, ultimaMarca: marca({ idAdmin: OTRO }) }, YO)).toEqual([]);
    expect(avisosDeMarca({ gratis: "marcada" }, { gratis: false, ultimaMarca: marca({ gratis: false }) }, YO)).toEqual([]);
    expect(avisosDeMarca({ gratis: "marcada" }, { gratis: true, ultimaMarca: null }, YO)).toEqual([]);
    expect(avisosDeMarca({ gratis: ["marcada", "marcada"] }, { gratis: true, ultimaMarca: marca() }, YO)).toEqual([]);
  });

  it.each(CAMBIOS_DE_LA_MARCA)("?gratis_error=%s se dice como alerta", (resultado) => {
    expect(avisosDeMarca({ gratis_error: resultado }, { gratis: false, ultimaMarca: null }, YO)).toEqual([{ exito: false, texto: MENSAJES_DE_MARCA[resultado] }]);
  });

  it("un error que no es un cambio de la cita no se pinta", () => {
    expect(avisosDeMarca({ gratis_error: "sin_permiso" }, { gratis: false, ultimaMarca: null }, YO)).toEqual([]);
  });
});

describe("los textos", () => {
  it("cada resultado que no escribe tiene su mensaje y esResultadoDeMarca reconoce solo los de la base", () => {
    for (const resultado of RESULTADOS_DE_MARCA) {
      expect(esResultadoDeMarca(resultado)).toBe(true);
      if (resultado !== "marcada" && resultado !== "desmarcada") expect(MENSAJES_DE_MARCA[resultado]).toBeTruthy();
    }
    expect(esResultadoDeMarca("autorizada")).toBe(false);
    expect(esResultadoDeMarca(null)).toBe(false);
  });

  it("ninguno lleva cifras ni la palabra comisión", () => {
    const todos = [...Object.values(MENSAJES_DE_MARCA), ...Object.values(CONSECUENCIAS_DE_GRATIS), ...Object.values(TEXTOS_DEL_BOTON).flatMap(Object.values)];
    for (const texto of todos) {
      expect(texto).not.toMatch(/comisi|\$|\d{3}/i);
    }
  });
});
