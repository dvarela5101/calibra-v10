import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AYUDA_AL_ACEPTAR,
  AYUDA_AL_RECHAZAR,
  avisosDeLaPagina,
  CAMBIOS_DEL_REPORTE,
  consecuenciasDeAceptar,
  consecuenciasDeRechazar,
  esDecision,
  esResultadoDeResolucion,
  LARGO_MAXIMO_OBSERVACIONES,
  leerResolucion,
  MENSAJE_DE_FALLO,
  MENSAJES_DE_RESOLUCION,
  observacionesValidas,
  puedeResolver,
  RESULTADOS_DE_RESOLUCION,
  TEXTOS_DEL_ESTADO,
  TEXTOS_DEL_ESTADO_DE_PAGO,
  TEXTOS_DEL_REEMBOLSO,
  type PagoDelReporte,
} from "./reportes-reglas";

const ID = "30000000-0000-4000-8000-000000000030";
const YO = "a0a0a0a0-0000-4000-8000-000000000030";
const OTRO = "a0a0a0a0-0000-4000-8000-000000003001";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

/** El texto como se lee: los espacios duros de las horas ("a. m.") cuentan como espacios. */
const llano = (texto: string) => texto.replace(/\s/g, " ");

/**
 * Los resultados que lista el comentario de la función en su migración, en su orden. Las líneas son
 * `--   resultado   explicación` (la primera trae dos: `aceptado | rechazado`), con las explicaciones largas en líneas de
 * continuación más indentadas.
 */
function resultadosDelComentario(sql: string, encabezado: string): string[] {
  const lineas = sql.split(/\r?\n/);
  const desde = lineas.findIndex((linea) => linea.includes(encabezado));
  if (desde < 0) throw new Error(`No está en la migración: ${encabezado}`);
  const resultados: string[] = [];
  for (const linea of lineas.slice(desde + 1)) {
    const resultado = /^-- {3}([a-z_]+(?: \| [a-z_]+)*)\s/.exec(linea);
    if (resultado) resultados.push(...resultado[1].split(" | "));
    else if (!/^-- {6,}\S/.test(linea)) break;
  }
  return resultados;
}

describe("resultados de la resolución (HU-030)", () => {
  it.each(Object.entries(MENSAJES_DE_RESOLUCION))("%s tiene un mensaje para el admin", (_clave, mensaje) => {
    expect(mensaje.trim().length).toBeGreaterThan(10);
    expect(mensaje).not.toMatch(/undefined|null|_/);
  });

  it("todo resultado que no es aceptado ni rechazado tiene mensaje, y son once", () => {
    expect(RESULTADOS_DE_RESOLUCION).toHaveLength(11);
    expect(RESULTADOS_DE_RESOLUCION.filter((r) => r !== "aceptado" && r !== "rechazado" && !(r in MENSAJES_DE_RESOLUCION))).toEqual([]);
    expect(Object.keys(MENSAJES_DE_RESOLUCION)).toHaveLength(9);
  });

  it("reconoce solo lo que responde la base", () => {
    for (const resultado of RESULTADOS_DE_RESOLUCION) expect(esResultadoDeResolucion(resultado)).toBe(true);
    for (const otro of ["resuelto", "aprobado", "", null, undefined, 3]) expect(esResultadoDeResolucion(otro)).toBe(false);
  });

  it("los resultados van en el orden en que los mira public.resolver_reporte_inasistencia (su migración)", () => {
    const sql = readFileSync(join(__dirname, "../../../supabase/migrations/20261005134333_resolver_reportes.sql"), "utf8");
    expect(resultadosDelComentario(sql, "Resultado, en el orden en que se mira")).toEqual([...RESULTADOS_DE_RESOLUCION]);
  });

  it("lo que cambió mientras el admin miraba son resultados de la base, en su orden", () => {
    const posiciones = CAMBIOS_DEL_REPORTE.map((c) => RESULTADOS_DE_RESOLUCION.indexOf(c));
    expect(posiciones.every((p) => p > 1)).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    expect([...CAMBIOS_DEL_REPORTE].sort()).toEqual(["no_aceptable", "no_asignado", "no_individual", "ya_decidido"]);
  });

  it("los textos son los del SPEC", () => {
    expect(MENSAJES_DE_RESOLUCION.ya_decidido).toBe("Este reporte ya se resolvió, y una decisión no se puede cambiar.");
    expect(MENSAJES_DE_RESOLUCION.no_asignado).toBe("Este reporte está asignado a otro admin: solo esa persona lo resuelve.");
    expect(MENSAJES_DE_RESOLUCION.no_aceptable).toBe(
      "La monitoría ya no está confirmada ni realizada, así que no se puede aceptar el reporte. Puedes rechazarlo.",
    );
    expect(MENSAJE_DE_FALLO).toBe("No pudimos guardar la decisión. Intenta de nuevo; si sigue igual, avisa al equipo.");
  });

  it("reconoce las dos decisiones y ninguna otra", () => {
    expect(esDecision("aceptar")).toBe(true);
    expect(esDecision("rechazar")).toBe(true);
    for (const otra of ["ACEPTAR", "aprobar", "", null, undefined]) expect(esDecision(otra)).toBe(false);
  });
});

describe("leerResolucion", () => {
  it("lee el reporte, la decisión y las observaciones recortadas", () => {
    expect(leerResolucion(formulario({ id_reporte: ` ${ID.toUpperCase()} `, decision: "aceptar", observaciones: "  No llegó.\n " }))).toEqual({
      ok: true,
      datos: { idReporte: ID, decision: "aceptar", observaciones: "No llegó." },
    });
  });

  it("sin observaciones, o con solo espacios y saltos de línea, cuentan como ninguna", () => {
    for (const observaciones of [undefined, "", "   ", "\n\t "]) {
      const campos: Record<string, string> = { id_reporte: ID, decision: "rechazar" };
      if (observaciones !== undefined) campos.observaciones = observaciones;
      expect(leerResolucion(formulario(campos))).toEqual({ ok: true, datos: { idReporte: ID, decision: "rechazar", observaciones: null } });
    }
  });

  it("un reporte que no es un uuid se dice como no encontrado", () => {
    for (const idReporte of ["", "otro", "30000000-0000-4000-8000-00000000003"]) {
      expect(leerResolucion(formulario({ id_reporte: idReporte, decision: "aceptar" }))).toEqual({
        ok: false,
        error: MENSAJES_DE_RESOLUCION.no_encontrado,
      });
    }
    expect(leerResolucion(new FormData())).toEqual({ ok: false, error: MENSAJES_DE_RESOLUCION.no_encontrado });
  });

  it("una decisión que no es aceptar ni rechazar se dice en claro", () => {
    for (const decision of ["", "aprobar", "ACEPTAR", "deshacer"]) {
      expect(leerResolucion(formulario({ id_reporte: ID, decision }))).toEqual({ ok: false, error: MENSAJES_DE_RESOLUCION.decision_invalida });
    }
  });

  it("el navegador manda cada salto de línea de un textarea como CRLF: cuenta uno, como lo cuenta el maxlength del campo", () => {
    // 489 letras y 11 saltos: el campo las deja escribir (500) y al enviarlas llegan 511 caracteres con CRLF.
    const lineas = Array.from({ length: 12 }, (_, i) => "a".repeat(i < 9 ? 41 : 40));
    const delCampo = lineas.join("\n");
    const alEnviar = lineas.join("\r\n");
    expect(delCampo).toHaveLength(LARGO_MAXIMO_OBSERVACIONES);
    expect(alEnviar).toHaveLength(LARGO_MAXIMO_OBSERVACIONES + 11);

    const lectura = leerResolucion(formulario({ id_reporte: ID, decision: "aceptar", observaciones: alEnviar }));
    expect(lectura).toEqual({ ok: true, datos: { idReporte: ID, decision: "aceptar", observaciones: delCampo } });
    expect(observacionesValidas(delCampo)).toBe(true);
    // Un carácter más ya no cabe, con los saltos contados de la misma manera.
    const demasiado = leerResolucion(formulario({ id_reporte: ID, decision: "aceptar", observaciones: `${alEnviar}a` }));
    expect(demasiado.ok && observacionesValidas(demasiado.datos.observaciones)).toBe(false);
  });

  it("un CR suelto también es un salto de línea, y un par CRLF no cuenta dos", () => {
    const lectura = (observaciones: string) =>
      leerResolucion(formulario({ id_reporte: ID, decision: "rechazar", observaciones })) as { ok: true; datos: { observaciones: string | null } };
    expect(lectura("uno\rdos\r\ntres\ncuatro").datos.observaciones).toBe("uno\ndos\ntres\ncuatro");
    expect(lectura("uno\r\n\r\ndos").datos.observaciones).toBe("uno\n\ndos");
    // Solo saltos y espacios siguen contando como ninguna observación.
    expect(lectura("\r\n \r\n").datos.observaciones).toBeNull();
  });

  it("el largo de las observaciones no se mira aquí: viene después de saber quién puede resolver (nota de D-39)", () => {
    const largas = "a".repeat(LARGO_MAXIMO_OBSERVACIONES + 1);
    expect(leerResolucion(formulario({ id_reporte: ID, decision: "aceptar", observaciones: largas }))).toEqual({
      ok: true,
      datos: { idReporte: ID, decision: "aceptar", observaciones: largas },
    });
  });
});

describe("observacionesValidas", () => {
  it("el límite es el check de la base: 500 caracteres", () => {
    expect(LARGO_MAXIMO_OBSERVACIONES).toBe(500);
    expect(observacionesValidas(null)).toBe(true);
    expect(observacionesValidas("a".repeat(500))).toBe(true);
    expect(observacionesValidas("a".repeat(501))).toBe(false);
  });

  it("cuenta caracteres, como char_length: un carácter fuera del plano básico cuenta uno", () => {
    const clave = "\u{1D11E}";
    expect(clave.length).toBe(2);
    expect(observacionesValidas(clave.repeat(500))).toBe(true);
    expect(observacionesValidas(clave.repeat(501))).toBe(false);
    expect(observacionesValidas("é".repeat(500))).toBe(true);
  });
});

describe("puedeResolver: solo el asignado, y solo un reporte en revisión (RN-63)", () => {
  it("el asignado resuelve uno en revisión", () => {
    expect(puedeResolver({ estado: "en_revision", idAdmin: YO }, YO)).toBe(true);
  });

  it("otro admin no, aunque el reporte esté en revisión: los reportes no tienen escalamiento", () => {
    expect(puedeResolver({ estado: "en_revision", idAdmin: OTRO }, YO)).toBe(false);
  });

  it("uno ya decidido no se resuelve otra vez, ni por el asignado", () => {
    expect(puedeResolver({ estado: "aceptado", idAdmin: YO }, YO)).toBe(false);
    expect(puedeResolver({ estado: "rechazado", idAdmin: YO }, YO)).toBe(false);
  });
});

describe("textos de estado", () => {
  it("el reporte, el pago y el reembolso se dicen en palabras", () => {
    expect(TEXTOS_DEL_ESTADO).toEqual({ en_revision: "En revisión", aceptado: "Aceptado", rechazado: "Rechazado" });
    expect(TEXTOS_DEL_ESTADO_DE_PAGO).toEqual({ aprobado: "Aprobado", en_revision: "En revisión", rechazado: "Rechazado" });
    expect(TEXTOS_DEL_REEMBOLSO).toEqual({
      esperando_llave: "Reembolso: esperando la llave",
      pendiente: "Reembolso: listo para transferir",
      reembolsado: "Reembolso: reembolsado",
    });
  });
});

const pago = (cambios: Partial<PagoDelReporte> = {}): PagoDelReporte => ({
  nombrePagador: "Camila Rojas",
  monto: 25_000,
  estado: "aprobado",
  caso: null,
  cierre: null,
  ...cambios,
});

const ACEPTAR = (pagos: PagoDelReporte[], desembolso: "pendiente" | "desembolsado" | "anulado" | null = null) =>
  llano(consecuenciasDeAceptar({ fechaSesion: "2030-01-07", desembolso, pagos }));

describe("consecuenciasDeAceptar: se arman desde el estado real (D-37)", () => {
  it("con un pago aprobado: la monitoría se cancela, un reembolso, el aviso al monitor y que no se deshace, en ese orden", () => {
    const t = ACEPTAR([pago()], "pendiente");
    expect(t).toBe(
      "La monitoría del 7 de enero de 2030 pasa a cancelada porque el monitor no asistió, y no se le desembolsa. " +
        "Creamos un reembolso de $ 25.000 y le pedimos la llave a quien pagó, por correo. " +
        "Le avisamos al monitor por correo, sin los datos de contacto de quien reportó. " +
        "Esta decisión no se puede deshacer.",
    );
  });

  it("con varios pagos aprobados: cuántos reembolsos y la suma en total", () => {
    const t = ACEPTAR([pago({ monto: 25_000 }), pago({ nombrePagador: "Luis", monto: 15_000 })]);
    expect(t).toContain("Creamos 2 reembolsos por $ 40.000 en total y le pedimos la llave a cada pagador, por correo.");
    expect(t).not.toContain("No hay pagos aprobados");
  });

  it("el total y la cuenta de reembolsos son solo de los pagos aprobados: uno en revisión o rechazado no suma", () => {
    const mezcla = [
      pago({ nombrePagador: "Ana", monto: 25_000 }),
      pago({ nombrePagador: "Luis", monto: 15_000 }),
      pago({ nombrePagador: "Marta", monto: 7_000, estado: "en_revision" }),
      pago({ nombrePagador: "Pedro", monto: 90_000, estado: "rechazado" }),
    ];
    const t = ACEPTAR(mezcla);
    expect(t).toContain("Creamos 2 reembolsos por $ 40.000 en total y le pedimos la llave a cada pagador, por correo.");
    expect(t).not.toMatch(/\$ (47|130|137)\.000/);
    expect(t).toContain("1 pago sigue en revisión");
  });

  it("con un solo aprobado entre otros pagos, el reembolso es el de ese pago, aunque no sea el primero de la lista", () => {
    const t = ACEPTAR([
      pago({ nombrePagador: "Pedro", monto: 90_000, estado: "rechazado" }),
      pago({ nombrePagador: "Marta", monto: 7_000, estado: "en_revision" }),
      pago({ nombrePagador: "Ana", monto: 25_000 }),
    ]);
    expect(t).toContain("Creamos un reembolso de $ 25.000 y le pedimos la llave a quien pagó, por correo.");
    expect(t).not.toContain("reembolsos por");
    expect(t).not.toMatch(/\$ (7|90)\.000/);
  });

  it("con el desembolso ya transferido: lo dice y que no se anula", () => {
    const t = ACEPTAR([pago()], "desembolsado");
    expect(t).toContain(
      "La monitoría del 7 de enero de 2030 pasa a cancelada porque el monitor no asistió. Su desembolso ya se había transferido al monitor y no se anula.",
    );
    expect(t).not.toContain("no se le desembolsa");
  });

  it("con pagos en revisión: recibirán su reembolso cuando se aprueben, y si se rechazan no hay", () => {
    const uno = ACEPTAR([pago(), pago({ estado: "en_revision" })]);
    expect(uno).toContain("1 pago sigue en revisión: recibe su reembolso cuando se apruebe, y si se rechaza no hay reembolso.");
    const dos = ACEPTAR([pago({ estado: "en_revision" }), pago({ estado: "en_revision" })]);
    expect(dos).toContain("2 pagos siguen en revisión: cada uno recibe su reembolso cuando se apruebe, y si se rechaza no hay reembolso.");
    // Con solo pagos en revisión no se dice que no haya nada que reembolsar: lo habrá si se aprueban.
    expect(dos).not.toContain("No hay pagos aprobados que reembolsar.");
  });

  it("con un caso P-24 abierto: el pago rechazado deja de estar por cobrar o asumir", () => {
    const t = ACEPTAR([pago(), pago({ nombrePagador: "Luis Pérez", estado: "rechazado", caso: "abierto" })]);
    expect(t).toContain("El pago rechazado de Luis Pérez deja de estar por cobrar o asumir: la monitoría se cancela y no se le cobra.");
  });

  it("un pago rechazado cuyo caso se cerró como cobrado no se devuelve desde aquí (pregunta 8); uno asumido no dice nada", () => {
    const cobrado = ACEPTAR([pago({ nombrePagador: "Luis Pérez", estado: "rechazado", caso: "cerrado", cierre: "cobrado" })]);
    expect(cobrado).toContain("El pago rechazado de Luis Pérez se cerró como cobrado por fuera y no se reembolsa desde aquí");
    const asumido = ACEPTAR([pago({ nombrePagador: "Luis Pérez", estado: "rechazado", caso: "cerrado", cierre: "asumido" })]);
    expect(asumido).not.toContain("Luis Pérez");
    // Un pago rechazado sin caso (la cita ya estaba cancelada) tampoco dice nada.
    expect(ACEPTAR([pago({ nombrePagador: "Luis Pérez", estado: "rechazado" })])).not.toContain("Luis Pérez");
  });

  it("sin pagos aprobados ni en revisión: dice que no hay nada que reembolsar", () => {
    for (const pagos of [[], [pago({ estado: "rechazado" })]]) {
      const t = ACEPTAR(pagos);
      expect(t).toContain("No hay pagos aprobados que reembolsar.");
      expect(t).not.toContain("Creamos");
    }
  });

  it("siempre termina avisando al monitor sin los datos de quien reportó y que no se deshace", () => {
    for (const pagos of [[], [pago()], [pago({ estado: "en_revision" })]]) {
      const t = ACEPTAR(pagos);
      expect(t).toContain("Le avisamos al monitor por correo, sin los datos de contacto de quien reportó.");
      expect(t.endsWith("Esta decisión no se puede deshacer.")).toBe(true);
    }
  });
});

describe("consecuenciasDeRechazar", () => {
  const AHORA = new Date("2030-01-09T14:00:00.000Z");
  /** 10:00 en Bogotá del 10 de enero: después de AHORA. */
  const DESPUES = new Date("2030-01-10T15:00:00.000Z");
  const ANTES = new Date("2030-01-08T15:00:00.000Z");

  it("la monitoría no cambia, no hay reembolsos, el reporte no se repite, el Lead lo ve en su cita y no hay correo", () => {
    expect(llano(consecuenciasDeRechazar({ desembolso: null, desembolsableDesde: DESPUES }, AHORA))).toBe(
      "La monitoría sigue como estaba y no se crea ningún reembolso. El reporte no se puede volver a hacer. " +
        "Quien reportó verá tu decisión y tus observaciones en la página de su cita; no le mandamos correo. " +
        "Esta decisión no se puede deshacer.",
    );
  });

  it("con el desembolso pendiente dentro de la ventana: dice desde cuándo se puede ejecutar, si nada más lo bloquea", () => {
    const t = llano(consecuenciasDeRechazar({ desembolso: "pendiente", desembolsableDesde: DESPUES }, AHORA));
    expect(t).toContain(
      "El desembolso de esta monitoría deja de esperar este reporte: se puede ejecutar cuando termine la ventana de reporte (después del jueves, 10 de enero de 2030, 10:00 a. m.), si nada más lo bloquea.",
    );
  });

  it("con el desembolso pendiente y la ventana ya terminada: ya se puede ejecutar si nada más lo bloquea", () => {
    const t = llano(consecuenciasDeRechazar({ desembolso: "pendiente", desembolsableDesde: ANTES }, AHORA));
    expect(t).toContain("El desembolso de esta monitoría deja de esperar este reporte: ya se puede ejecutar si nada más lo bloquea.");
    expect(t).not.toContain("después del");
  });

  it("N-6: en el instante exacto el desembolso todavía no es ejecutable; un milisegundo después, sí", () => {
    const limite = new Date("2030-01-09T14:00:00.000Z");
    expect(consecuenciasDeRechazar({ desembolso: "pendiente", desembolsableDesde: limite }, limite)).toContain("después del");
    expect(consecuenciasDeRechazar({ desembolso: "pendiente", desembolsableDesde: limite }, new Date(limite.getTime() + 1))).toContain("ya se puede ejecutar");
  });

  it("sin desembolso pendiente (no existe, ya transferido o anulado) no habla del desembolso", () => {
    for (const desembolso of [null, "desembolsado", "anulado"] as const) {
      expect(consecuenciasDeRechazar({ desembolso, desembolsableDesde: DESPUES }, AHORA)).not.toContain("desembolso");
    }
  });
});

describe("ayudas de las observaciones: quién las lee", () => {
  it("al aceptar las lee quien pagó, junto con su pedido de llave; al rechazar, quien reportó, en su cita", () => {
    expect(AYUDA_AL_ACEPTAR).toBe(
      "Opcionales. Hasta 500 caracteres. Quien pagó lee este comentario junto con la solicitud de su llave, en el correo y en la página donde la envía: escríbelo pensando en esa persona.",
    );
    expect(AYUDA_AL_RECHAZAR).toBe(
      "Opcionales. Hasta 500 caracteres. Quien reportó lo lee en la página de su cita: escríbelo pensando en esa persona.",
    );
  });
});

describe("avisosDeLaPagina", () => {
  const base = { estado: "aceptado" as const, desembolso: "anulado" as const, pagos: [{ estado: "aprobado" as const, tieneReembolso: true }] };

  it("aceptado: lo dice con lo que de verdad hay en la base", () => {
    expect(avisosDeLaPagina({ resuelto: "aceptado" }, base)).toEqual([
      {
        exito: true,
        texto:
          "Aceptaste el reporte. La monitoría quedó cancelada y su desembolso, anulado. Creamos 1 reembolso y le pedimos la llave a quien pagó. Le avisamos al monitor por correo.",
      },
    ]);
  });

  it("aceptado con varios reembolsos y un pago en revisión", () => {
    const [aviso] = avisosDeLaPagina(
      { resuelto: "aceptado" },
      {
        ...base,
        pagos: [
          { estado: "aprobado", tieneReembolso: true },
          { estado: "aprobado", tieneReembolso: true },
          { estado: "en_revision", tieneReembolso: false },
        ],
      },
    );
    expect(aviso.texto).toContain("Creamos 2 reembolsos y le pedimos la llave a quien pagó.");
    expect(aviso.texto).toContain("Los pagos en revisión recibirán el suyo cuando se aprueben.");
    expect(aviso.texto.endsWith("Le avisamos al monitor por correo.")).toBe(true);
  });

  it("aceptado sin pagos con reembolso ni desembolso: no dice nada que no pasó", () => {
    const [aviso] = avisosDeLaPagina({ resuelto: "aceptado" }, { estado: "aceptado", desembolso: null, pagos: [] });
    expect(aviso.texto).toBe("Aceptaste el reporte. La monitoría quedó cancelada y no se le desembolsa al monitor. Le avisamos al monitor por correo.");
    expect(aviso.texto).not.toContain("anulado");
    expect(aviso.texto).not.toContain("Creamos");
  });

  it("aceptado con el desembolso ya transferido: dice que no se anuló", () => {
    const [aviso] = avisosDeLaPagina({ resuelto: "aceptado" }, { ...base, desembolso: "desembolsado" });
    expect(aviso.texto).toContain("La monitoría quedó cancelada. Su desembolso ya se había transferido y no se anuló.");
    expect(aviso.texto).not.toContain("anulado");
  });

  it("rechazado: dice que la monitoría sigue y dónde verá la decisión quien reportó", () => {
    expect(avisosDeLaPagina({ resuelto: "rechazado" }, { estado: "rechazado", desembolso: null, pagos: [] })).toEqual([
      {
        exito: true,
        texto: "Rechazaste el reporte. La monitoría sigue como estaba. Quien reportó verá tu decisión en la página de su cita.",
      },
    ]);
  });

  it("el éxito solo se dice si el reporte de verdad quedó así: un enlace viejo o escrito a mano no anuncia una decisión que no pasó", () => {
    expect(avisosDeLaPagina({ resuelto: "aceptado" }, { ...base, estado: "en_revision" })).toEqual([]);
    expect(avisosDeLaPagina({ resuelto: "aceptado" }, { ...base, estado: "rechazado" })).toEqual([]);
    expect(avisosDeLaPagina({ resuelto: "rechazado" }, base)).toEqual([]);
    expect(avisosDeLaPagina({ resuelto: "rechazado" }, { ...base, estado: "en_revision" })).toEqual([]);
    expect(avisosDeLaPagina({ resuelto: "deshecho" }, base)).toEqual([]);
    expect(avisosDeLaPagina({ resuelto: ["aceptado"] }, base)).toEqual([]);
    expect(avisosDeLaPagina({}, base)).toEqual([]);
  });

  it.each(CAMBIOS_DEL_REPORTE)("?error=%s dice lo que cambió mientras el admin miraba", (error) => {
    expect(avisosDeLaPagina({ error }, { ...base, estado: "en_revision" })).toEqual([{ exito: false, texto: MENSAJES_DE_RESOLUCION[error] }]);
  });

  it("un error que no es de los que vuelven a la página no se anuncia", () => {
    for (const error of ["observaciones_invalidas", "sin_permiso", "aceptado", "", "otro"]) {
      expect(avisosDeLaPagina({ error }, base)).toEqual([]);
    }
  });
});

describe("sin cifras de comisión", () => {
  it("ningún texto habla de comisión, bruto ni neto", () => {
    const textos = [
      ...Object.values(MENSAJES_DE_RESOLUCION),
      MENSAJE_DE_FALLO,
      AYUDA_AL_ACEPTAR,
      AYUDA_AL_RECHAZAR,
      ACEPTAR([pago(), pago({ estado: "en_revision" }), pago({ estado: "rechazado", caso: "abierto" })], "pendiente"),
      ACEPTAR([pago({ estado: "rechazado", caso: "cerrado", cierre: "cobrado" })], "desembolsado"),
      llano(consecuenciasDeRechazar({ desembolso: "pendiente", desembolsableDesde: new Date("2030-01-10T15:00:00.000Z") }, new Date("2030-01-09T14:00:00.000Z"))),
      ...avisosDeLaPagina({ resuelto: "aceptado" }, { estado: "aceptado", desembolso: "anulado", pagos: [{ estado: "aprobado", tieneReembolso: true }] }).map((a) => a.texto),
    ];
    for (const texto of textos) expect(texto).not.toMatch(/comisi|bruto|neto/i);
  });
});
