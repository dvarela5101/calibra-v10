import { describe, expect, it } from "vitest";
import {
  avisosDelCaso,
  CAMBIOS_DEL_CASO,
  CIERRES,
  CONSECUENCIAS_DEL_CIERRE,
  esCierre,
  esResultadoDelCierre,
  estadoDelCaso,
  EXPLICACION_DEL_CASO,
  LARGO_MAXIMO_NOTA,
  leerCierre,
  MENSAJE_DE_FALLO,
  MENSAJES_DEL_CIERRE,
  RESULTADOS_DEL_CIERRE,
  TEXTOS_DEL_CIERRE,
} from "./casos-p24-reglas";

const ID = "6a6a6a6a-0000-4000-8000-000000000078";
const YO = "a0a0a0a0-0000-4000-8000-000000000078";
const OTRO = "a0a0a0a0-0000-4000-8000-000000007801";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

describe("estadoDelCaso (supuesto 1, la regla de privado.estado_caso_p24)", () => {
  it.each(["pendiente_pago", "confirmada", "realizada"] as const)("un pago rechazado de una monitoría %s es un caso: abierto sin cierre, cerrado con él", (monitoria) => {
    expect(estadoDelCaso("rechazado", monitoria, null)).toBe("abierto");
    expect(estadoDelCaso("rechazado", monitoria, "cobrado")).toBe("cerrado");
    expect(estadoDelCaso("rechazado", monitoria, "asumido")).toBe("cerrado");
  });

  it("un pago rechazado de una monitoría cancelada no es un caso: no hay nada que cobrar ni asumir", () => {
    expect(estadoDelCaso("rechazado", "cancelada", null)).toBeNull();
    expect(estadoDelCaso("rechazado", "cancelada", "cobrado")).toBeNull();
  });

  it.each(["en_revision", "aprobado"] as const)("un pago %s no es un caso", (pago) => {
    expect(estadoDelCaso(pago, "realizada", null)).toBeNull();
    expect(estadoDelCaso(pago, "confirmada", null)).toBeNull();
  });
});

describe("resultados y mensajes del cierre", () => {
  it("todo resultado que no es cerrado tiene un mensaje en palabras", () => {
    expect(RESULTADOS_DEL_CIERRE.filter((r) => r !== "cerrado" && !(r in MENSAJES_DEL_CIERRE))).toEqual([]);
    for (const mensaje of [...Object.values(MENSAJES_DEL_CIERRE), MENSAJE_DE_FALLO]) {
      expect(mensaje.trim().length).toBeGreaterThan(10);
      expect(mensaje).not.toMatch(/undefined|null|_/);
    }
  });

  it("reconoce solo lo que responde la base y los dos cierres", () => {
    for (const resultado of RESULTADOS_DEL_CIERRE) expect(esResultadoDelCierre(resultado)).toBe(true);
    for (const cierre of CIERRES) expect(esCierre(cierre)).toBe(true);
    for (const otro of ["", "abierto", "COBRADO", " asumido", null, undefined, 3]) {
      expect(esResultadoDelCierre(otro)).toBe(false);
      expect(esCierre(otro)).toBe(false);
    }
  });

  it("cada cierre se dice en palabras y la nota tiene el largo de la base", () => {
    expect(TEXTOS_DEL_CIERRE).toEqual({ cobrado: "Cobrado: el pagador pagó por fuera", asumido: "Asumido: Calibra no lo cobra" });
    expect(LARGO_MAXIMO_NOTA).toBe(500);
    expect(MENSAJES_DEL_CIERRE.nota_invalida).toBe("La nota puede tener hasta 500 caracteres.");
  });

  it("D-38: lo que se lee antes de confirmar dice que no se deshace, que sale de la sección y que cuenta en el desembolso", () => {
    expect(CONSECUENCIAS_DEL_CIERRE).toBe(
      "Cerrar el caso no se puede deshacer. Sale de «Pagos por cobrar o asumir», el pago sigue rechazado y su monto cuenta en el desembolso del monitor.",
    );
  });

  it("criterio 4: la explicación del caso abierto dice que el desembolso espera", () => {
    expect(EXPLICACION_DEL_CASO).toContain("Mientras siga abierto, el desembolso de esta monitoría no se puede ejecutar.");
  });

  it("ningún texto habla de bruto ni de comisión (CLAUDE.md)", () => {
    for (const texto of [...Object.values(MENSAJES_DEL_CIERRE), ...Object.values(TEXTOS_DEL_CIERRE), MENSAJE_DE_FALLO, CONSECUENCIAS_DEL_CIERRE, EXPLICACION_DEL_CASO]) {
      expect(texto.toLowerCase()).not.toMatch(/comisi|bruto/);
    }
  });
});

describe("leerCierre (supuesto 3)", () => {
  it("lee el pago, el cierre y la nota recortada", () => {
    expect(leerCierre(formulario({ id_pago: ` ${ID.toUpperCase()} `, cierre: "cobrado", nota: "  Pagó por Nequi.\n " }))).toEqual({
      ok: true,
      datos: { idPago: ID, cierre: "cobrado", nota: "Pagó por Nequi." },
    });
    expect(leerCierre(formulario({ id_pago: ID, cierre: " asumido " }))).toEqual({ ok: true, datos: { idPago: ID, cierre: "asumido", nota: null } });
  });

  it("una nota en blanco cuenta como ninguna", () => {
    expect(leerCierre(formulario({ id_pago: ID, cierre: "asumido", nota: " \n\t " }))).toEqual({ ok: true, datos: { idPago: ID, cierre: "asumido", nota: null } });
  });

  it("cuenta caracteres como la base, no unidades de JavaScript: 500 caracteres de dos unidades caben", () => {
    // U+1D11E (clave de sol) ocupa dos unidades de JavaScript y es un solo carácter para char_length.
    const quinientos = "\u{1D11E}".repeat(LARGO_MAXIMO_NOTA);
    expect(quinientos.length).toBe(2 * LARGO_MAXIMO_NOTA);
    expect(leerCierre(formulario({ id_pago: ID, cierre: "cobrado", nota: quinientos })).ok).toBe(true);
    expect(leerCierre(formulario({ id_pago: ID, cierre: "cobrado", nota: `${quinientos}a` }))).toEqual({ ok: false, error: MENSAJES_DEL_CIERRE.nota_invalida });
  });

  it.each([
    ["sin pago", { cierre: "cobrado" }, MENSAJES_DEL_CIERRE.no_encontrado],
    ["con un pago que no es un id", { id_pago: "1 or 1=1", cierre: "cobrado" }, MENSAJES_DEL_CIERRE.no_encontrado],
    ["sin cierre", { id_pago: ID }, MENSAJES_DEL_CIERRE.cierre_invalido],
    ["con otro cierre", { id_pago: ID, cierre: "perdonado" }, MENSAJES_DEL_CIERRE.cierre_invalido],
    ["con el cierre en mayúsculas", { id_pago: ID, cierre: "COBRADO" }, MENSAJES_DEL_CIERRE.cierre_invalido],
    ["con 501 caracteres de nota", { id_pago: ID, cierre: "asumido", nota: "a".repeat(501) }, MENSAJES_DEL_CIERRE.nota_invalida],
  ])("rechaza un formulario %s", (_caso, campos, error) => {
    expect(leerCierre(formulario(campos))).toEqual({ ok: false, error });
  });

  it("un archivo en vez de texto no cuenta como cierre", () => {
    const datos = formulario({ id_pago: ID });
    datos.set("cierre", new Blob(["cobrado"]));
    expect(leerCierre(datos)).toEqual({ ok: false, error: MENSAJES_DEL_CIERRE.cierre_invalido });
  });
});

describe("avisosDelCaso", () => {
  const MIO = { como: "asumido" as const, idAdmin: YO };

  it("dice que se cerró solo si el caso de verdad quedó cerrado por el admin de la sesión", () => {
    expect(avisosDelCaso({ caso: "cerrado" }, MIO, YO)).toEqual([
      { exito: true, texto: "Cerraste el caso como asumido. Ya no aparece en «Pagos por cobrar o asumir»." },
    ]);
    expect(avisosDelCaso({ caso: "cerrado" }, { ...MIO, como: "cobrado" }, YO)[0].texto).toBe(
      "Cerraste el caso como cobrado. Ya no aparece en «Pagos por cobrar o asumir».",
    );
    expect(avisosDelCaso({ caso: "cerrado" }, null, YO)).toEqual([]);
    expect(avisosDelCaso({ caso: "cerrado" }, { ...MIO, idAdmin: OTRO }, YO)).toEqual([]);
    expect(avisosDelCaso({ caso: ["cerrado", "cerrado"] }, MIO, YO)).toEqual([]);
  });

  it("lo que cambió mientras el admin miraba se dice como alerta", () => {
    for (const caso of CAMBIOS_DEL_CASO) {
      expect(avisosDelCaso({ caso }, null, YO)).toEqual([{ exito: false, texto: MENSAJES_DEL_CIERRE[caso] }]);
    }
  });

  it("lo desconocido y los errores del formulario no se dicen", () => {
    for (const caso of ["<script>", "nota_invalida", "sin_permiso", "abierto"]) expect(avisosDelCaso({ caso }, MIO, YO)).toEqual([]);
    expect(avisosDelCaso({}, MIO, YO)).toEqual([]);
  });
});
