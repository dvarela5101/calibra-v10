import { describe, expect, it } from "vitest";
import { renderizar } from "@/lib/correo/plantillas";
import {
  avisoDeQuienRevisa,
  avisosDeLaPagina,
  ayudaDeObservaciones,
  casoDeRechazo,
  consecuenciasDelRechazo,
  correoDeRechazo,
  esResultadoDeRevision,
  LARGO_MAXIMO_OBSERVACIONES,
  leerRevision,
  MENSAJE_DEL_COMPROBANTE,
  MENSAJES_DE_REVISION,
  observacionesValidas,
  pideObservaciones,
  puedeRevisar,
  quienRevisa,
  quienSeEntera,
  RESULTADOS_DE_REVISION,
  type PagoParaElCorreo,
} from "./pagos-reglas";

const ID = "6a6a6a6a-0000-4000-8000-000000000020";

const formulario = (campos: Record<string, string>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

describe("resultados de la revisión (HU-020)", () => {
  it.each(Object.keys(MENSAJES_DE_REVISION))("%s tiene un mensaje para el admin", (resultado) => {
    const mensaje = MENSAJES_DE_REVISION[resultado as keyof typeof MENSAJES_DE_REVISION];
    expect(mensaje.trim().length).toBeGreaterThan(10);
    expect(mensaje).not.toMatch(/undefined|null|_/);
  });

  it("todo resultado que no es aprobar ni rechazar tiene mensaje", () => {
    const sinMensaje = RESULTADOS_DE_REVISION.filter((r) => r !== "aprobado" && r !== "rechazado" && !(r in MENSAJES_DE_REVISION));
    expect(sinMensaje).toEqual([]);
  });

  it("reconoce solo lo que responde la base", () => {
    for (const resultado of RESULTADOS_DE_REVISION) expect(esResultadoDeRevision(resultado)).toBe(true);
    expect(esResultadoDeRevision("revisado")).toBe(false);
    expect(esResultadoDeRevision(null)).toBe(false);
  });

  it("P-24: el mensaje pide anotar qué se hará con el cobro", () => {
    expect(MENSAJES_DE_REVISION.observaciones_requeridas).toMatch(/cobrarlo por fuera o asumirlo/);
  });
});

describe("leerRevision", () => {
  it("lee el pago, la decisión y las observaciones recortadas", () => {
    expect(leerRevision(formulario({ id_pago: ` ${ID.toUpperCase()} `, decision: "rechazar", observaciones: "  Se cobra por fuera.\n " }))).toEqual({
      ok: true,
      datos: { idPago: ID, decision: "rechazar", observaciones: "Se cobra por fuera." },
    });
  });

  it("observaciones vacías o en blanco cuentan como ninguna, y aprobar no las necesita", () => {
    expect(leerRevision(formulario({ id_pago: ID, decision: "aprobar" }))).toEqual({ ok: true, datos: { idPago: ID, decision: "aprobar", observaciones: null } });
    expect(leerRevision(formulario({ id_pago: ID, decision: "rechazar", observaciones: " \n\t " }))).toEqual({
      ok: true,
      datos: { idPago: ID, decision: "rechazar", observaciones: null },
    });
  });

  it("HU-077 (nota de D-39): no juzga el largo de las observaciones, que se mira después de saber quién revisa", () => {
    const largas = "a".repeat(LARGO_MAXIMO_OBSERVACIONES + 1);
    expect(leerRevision(formulario({ id_pago: ID, decision: "rechazar", observaciones: ` ${largas} ` }))).toEqual({
      ok: true,
      datos: { idPago: ID, decision: "rechazar", observaciones: largas },
    });
  });

  it.each([
    ["sin pago", { decision: "aprobar" }, MENSAJES_DE_REVISION.no_encontrado],
    ["con un pago que no es un id", { id_pago: "1 or 1=1", decision: "aprobar" }, MENSAJES_DE_REVISION.no_encontrado],
    ["sin decisión", { id_pago: ID }, MENSAJES_DE_REVISION.decision_invalida],
    ["con otra decisión", { id_pago: ID, decision: "deshacer" }, MENSAJES_DE_REVISION.decision_invalida],
  ])("rechaza un formulario %s", (_caso, campos, error) => {
    expect(leerRevision(formulario(campos))).toEqual({ ok: false, error });
  });

  it("un archivo en vez de texto no cuenta como observaciones", () => {
    const datos = formulario({ id_pago: ID, decision: "rechazar" });
    datos.set("observaciones", new Blob(["texto"]));
    expect(leerRevision(datos)).toEqual({ ok: true, datos: { idPago: ID, decision: "rechazar", observaciones: null } });
  });
});

describe("observacionesValidas", () => {
  it("cuenta caracteres como la base, no unidades de JavaScript: 500 caracteres de dos unidades caben", () => {
    // U+1D11E (clave de sol) ocupa dos unidades de JavaScript y es un solo carácter para char_length.
    const quinientos = "\u{1D11E}".repeat(LARGO_MAXIMO_OBSERVACIONES);
    expect(quinientos.length).toBe(2 * LARGO_MAXIMO_OBSERVACIONES);
    expect(observacionesValidas(quinientos)).toBe(true);
    expect(observacionesValidas(`${quinientos}a`)).toBe(false);
  });

  it("sin observaciones, o con 500 caracteres, valen; con 501 no", () => {
    expect(observacionesValidas(null)).toBe(true);
    expect(observacionesValidas("a".repeat(LARGO_MAXIMO_OBSERVACIONES))).toBe(true);
    expect(observacionesValidas("a".repeat(LARGO_MAXIMO_OBSERVACIONES + 1))).toBe(false);
  });
});

describe("quién revisa (HU-077, D-38)", () => {
  const YO = "a0a0a0a0-0000-4000-8000-000000000077";
  const OTRO = "a0a0a0a0-0000-4000-8000-000000007701";
  const LIMITE = new Date("2030-01-07T14:30:00.000Z");
  const DE_OTRO = { idAdmin: OTRO, revisionHasta: LIMITE };
  const antes = new Date(LIMITE.getTime() - 60_000);
  const despues = new Date(LIMITE.getTime() + 1);

  it("supuesto 5: el asignado revisa antes y después de su hora", () => {
    const mio = { idAdmin: YO, revisionHasta: LIMITE };
    for (const ahora of [antes, LIMITE, despues]) {
      expect(quienRevisa(mio, YO, ahora)).toBe("asignado");
      expect(puedeRevisar(mio, YO, ahora)).toBe(true);
    }
  });

  it("criterio 2: otro admin dentro de la hora del asignado no puede", () => {
    expect(quienRevisa(DE_OTRO, YO, antes)).toBe("en_hora");
    expect(puedeRevisar(DE_OTRO, YO, antes)).toBe(false);
  });

  it("supuesto 1 (P-40): justo en el límite el pago todavía es solo del asignado; un milisegundo después, de cualquiera", () => {
    expect(quienRevisa(DE_OTRO, YO, LIMITE)).toBe("en_hora");
    expect(puedeRevisar(DE_OTRO, YO, LIMITE)).toBe(false);
    expect(quienRevisa(DE_OTRO, YO, despues)).toBe("hora_vencida");
    expect(puedeRevisar(DE_OTRO, YO, despues)).toBe(true);
  });

  it("criterio 2: a otro admin en la hora le dice de quién es y hasta cuándo; al asignado no le dice nada", () => {
    const pago = { nombreAdmin: "Admin Dos", revisionHasta: LIMITE };
    // 9:30 en Bogotá; la hora lleva espacios duros.
    expect(avisoDeQuienRevisa("en_hora", pago)?.replace(/\xa0/g, " ")).toBe(
      "Este pago está asignado a Admin Dos hasta el lunes, 7 de enero de 2030, 9:30 a. m. Si para entonces no lo ha revisado, podrás aprobarlo o rechazarlo tú.",
    );
    expect(avisoDeQuienRevisa("asignado", pago)).toBeNull();
  });

  it("criterio 1: con la hora vencida le dice a quién está asignado, desde cuándo venció y que puede revisarlo él", () => {
    expect(avisoDeQuienRevisa("hora_vencida", { nombreAdmin: "Admin Dos", revisionHasta: LIMITE })?.replace(/\xa0/g, " ")).toBe(
      "Este pago está asignado a Admin Dos, pero se le pasó la hora el lunes, 7 de enero de 2030, 9:30 a. m. Puedes aprobarlo o rechazarlo tú.",
    );
  });

  it("no_asignado ya no le dice a quien lo intenta que el pago era suyo: es de otro admin y su hora no ha pasado", () => {
    expect(MENSAJES_DE_REVISION.no_asignado).not.toMatch(/ya no está asignado a ti/);
    expect(MENSAJES_DE_REVISION.no_asignado).toMatch(/otro admin/);
  });
});

describe("casoDeRechazo (RN-43, P-24, supuesto 2)", () => {
  const INICIO = new Date("2030-01-07T15:00:00.000Z");
  const antes = new Date(INICIO.getTime() - 1);

  it("una confirmada que aún no empieza se cancela", () => {
    expect(casoDeRechazo("confirmada", INICIO, antes)).toBe("cancela_la_cita");
  });

  it("una confirmada en su inicio exacto ya empezó (P-40, borde incluido), y después también", () => {
    expect(casoDeRechazo("confirmada", INICIO, INICIO)).toBe("ya_empezo");
    expect(casoDeRechazo("confirmada", INICIO, new Date(INICIO.getTime() + 60_000))).toBe("ya_empezo");
  });

  it("la realizada no se cancela, aunque su inicio sea futuro para este reloj", () => {
    expect(casoDeRechazo("realizada", INICIO, antes)).toBe("ya_realizada");
  });

  it("la cancelada se queda como está, y la pendiente de pago (defensivo) se cancela", () => {
    expect(casoDeRechazo("cancelada", INICIO, antes)).toBe("ya_cancelada");
    expect(casoDeRechazo("cancelada", INICIO, INICIO)).toBe("ya_cancelada");
    expect(casoDeRechazo("pendiente_pago", INICIO, antes)).toBe("cancela_la_cita");
  });

  it("solo P-24 pide observaciones, y la ayuda lo dice", () => {
    expect(pideObservaciones("ya_empezo")).toBe(true);
    expect(pideObservaciones("ya_realizada")).toBe(true);
    expect(pideObservaciones("cancela_la_cita")).toBe(false);
    expect(pideObservaciones("ya_cancelada")).toBe(false);
    expect(ayudaDeObservaciones("ya_empezo")).toMatch(/^Obligatorias: .*cobrarlo por fuera o asumirlo\. Hasta 500 caracteres\.$/);
    expect(ayudaDeObservaciones("cancela_la_cita")).toMatch(/^Opcionales: .*Hasta 500 caracteres\.$/);
  });
});

describe("quienSeEntera (HU-076): la regla de la base, solo para el texto", () => {
  it("cancela_la_cita: el pagador siempre; el monitor solo si estaba confirmada (una por pagar no se le avisa, D-16)", () => {
    expect(quienSeEntera("cancela_la_cita", { estado: "confirmada", motivoCancelacion: null })).toEqual({ pagador: "cita_cancelada", monitor: true });
    expect(quienSeEntera("cancela_la_cita", { estado: "pendiente_pago", motivoCancelacion: null })).toEqual({ pagador: "cita_cancelada", monitor: false });
  });

  it("ya_cancelada: por pago_rechazado, el mismo aviso de siempre al pagador; por estudiante, el de «no hay reembolso»; ningún monitor", () => {
    expect(quienSeEntera("ya_cancelada", { estado: "cancelada", motivoCancelacion: "pago_rechazado" })).toEqual({ pagador: "cita_cancelada", monitor: false });
    expect(quienSeEntera("ya_cancelada", { estado: "cancelada", motivoCancelacion: "estudiante" })).toEqual({ pagador: "cita_ya_cancelada", monitor: false });
  });

  it.each(["monitor_no_asistio", "diferencia_no_cubierta"] as const)("ya_cancelada por %s: nadie", (motivo) => {
    expect(quienSeEntera("ya_cancelada", { estado: "cancelada", motivoCancelacion: motivo })).toEqual({ pagador: null, monitor: false });
  });

  it.each(["ya_empezo", "ya_realizada"] as const)("%s (P-24, criterio 6): nadie, y no se escribe al pagador", (caso) => {
    expect(quienSeEntera(caso, { estado: "confirmada", motivoCancelacion: null })).toEqual({ pagador: null, monitor: false });
    expect(quienSeEntera(caso, { estado: "realizada", motivoCancelacion: null })).toEqual({ pagador: null, monitor: false });
  });
});

describe("consecuenciasDelRechazo (supuestos 4 y 7; HU-076)", () => {
  const CONFIRMADA = { estado: "confirmada" as const, motivoCancelacion: null };
  const PAGO = { fechaSesion: "2030-01-07", nombrePagador: "Camila Rojas", contacto: "camila@uniandes.edu.co", monitoria: CONFIRMADA };
  const POR_ESTUDIANTE = { estado: "cancelada" as const, motivoCancelacion: "estudiante" as const };

  it("D-38: se cancela la cita, la fecha queda libre, no hay reembolso y se le avisa al pagador y al monitor", () => {
    expect(consecuenciasDelRechazo("cancela_la_cita", PAGO)).toBe(
      "Se cancela la monitoría del 7 de enero de 2030 y esa fecha queda libre para otra persona. Un pago rechazado no se reembolsa. Le avisaremos a Camila Rojas por correo, a camila@uniandes.edu.co. También le avisaremos al monitor.",
    );
  });

  it("si la monitoría estaba pendiente de pago (defensivo), no se le avisa al monitor", () => {
    expect(consecuenciasDelRechazo("cancela_la_cita", { ...PAGO, monitoria: { estado: "pendiente_pago", motivoCancelacion: null } })).toBe(
      "Se cancela la monitoría del 7 de enero de 2030 y esa fecha queda libre para otra persona. Un pago rechazado no se reembolsa. Le avisaremos a Camila Rojas por correo, a camila@uniandes.edu.co.",
    );
  });

  it("con un teléfono de contacto, el admin tiene que avisarle él al pagador, y al monitor se le sigue avisando", () => {
    expect(consecuenciasDelRechazo("cancela_la_cita", { ...PAGO, contacto: "3001234567" })).toBe(
      "Se cancela la monitoría del 7 de enero de 2030 y esa fecha queda libre para otra persona. Un pago rechazado no se reembolsa. El contacto de Camila Rojas no es un correo: tendrás que avisarle tú, al 3001234567. También le avisaremos al monitor.",
    );
  });

  it("D-39 d: con la cita ya cancelada por el estudiante, solo cambia el pago y se le avisa al pagador que no hay reembolso", () => {
    expect(consecuenciasDelRechazo("ya_cancelada", { ...PAGO, monitoria: POR_ESTUDIANTE })).toBe(
      "La monitoría ya estaba cancelada: solo cambia el pago. Un pago rechazado no se reembolsa. Le avisaremos a Camila Rojas por correo, a camila@uniandes.edu.co, que no hay reembolso.",
    );
  });

  it("D-39 d: si el contacto no es un correo, la misma frase de «tendrás que avisarle tú»", () => {
    expect(consecuenciasDelRechazo("ya_cancelada", { ...PAGO, contacto: "3001234567", monitoria: POR_ESTUDIANTE })).toBe(
      "La monitoría ya estaba cancelada: solo cambia el pago. Un pago rechazado no se reembolsa. El contacto de Camila Rojas no es un correo: tendrás que avisarle tú, al 3001234567.",
    );
  });

  it("supuesto 2: si otro pago de la misma cita ya la canceló por el rechazo, el pagador recibe el aviso de siempre y no se nombra al monitor", () => {
    const texto = consecuenciasDelRechazo("ya_cancelada", { ...PAGO, monitoria: { estado: "cancelada", motivoCancelacion: "pago_rechazado" } });
    expect(texto).toBe(
      "La monitoría ya estaba cancelada: solo cambia el pago. Un pago rechazado no se reembolsa. Le avisaremos a Camila Rojas por correo, a camila@uniandes.edu.co.",
    );
    expect(texto).not.toContain("al monitor");
  });

  it.each(["monitor_no_asistio", "diferencia_no_cubierta"] as const)("cancelada por %s: el texto de antes, al pagador no le escribimos", (motivo) => {
    expect(consecuenciasDelRechazo("ya_cancelada", { ...PAGO, monitoria: { estado: "cancelada", motivoCancelacion: motivo } })).toBe(
      "La monitoría ya estaba cancelada: solo cambia el pago. Un pago rechazado no se reembolsa y al pagador no le escribimos.",
    );
  });

  it.each(["ya_empezo", "ya_realizada"] as const)("%s: no se cancela nada, no hay reembolso y no se escribe a nadie", (caso) => {
    const texto = consecuenciasDelRechazo(caso, { ...PAGO, monitoria: { estado: caso === "ya_realizada" ? "realizada" : "confirmada", motivoCancelacion: null } });
    expect(texto).toContain("no se reembolsa");
    expect(texto).toContain("al pagador no le escribimos");
    expect(texto).not.toMatch(/Se cancela|queda libre|Le avisaremos/);
  });

  it("P-24 (HU-078, D-39): el caso queda por cobrar o asumir y cuenta en el desembolso solo cuando alguien lo cierra", () => {
    const porCobrar =
      "el caso queda en «Pagos por cobrar o asumir»: el pago cuenta en el desembolso del monitor solo cuando alguien lo cierre como cobrado o asumido. Un pago rechazado no se reembolsa y al pagador no le escribimos.";
    expect(consecuenciasDelRechazo("ya_empezo", PAGO)).toBe(`La sesión ya empezó, así que la monitoría no se cancela y ${porCobrar}`);
    expect(consecuenciasDelRechazo("ya_realizada", { ...PAGO, monitoria: { estado: "realizada", motivoCancelacion: null } })).toBe(
      `La monitoría ya se realizó, así que no se cancela y ${porCobrar}`,
    );
    // Con la monitoría ya cancelada no hay caso (supuesto 1 de HU-078).
    expect(consecuenciasDelRechazo("ya_cancelada", { ...PAGO, monitoria: POR_ESTUDIANTE })).not.toMatch(/cobrar o asumir|desembolso/);
  });

  it("ningún texto menciona comisión", () => {
    for (const caso of ["cancela_la_cita", "ya_empezo", "ya_realizada", "ya_cancelada"] as const) {
      expect(consecuenciasDelRechazo(caso, PAGO).toLowerCase()).not.toMatch(/comisi/);
    }
  });
});

describe("correoDeRechazo (criterio 3, supuesto 4)", () => {
  const RECHAZADO: PagoParaElCorreo = {
    estado: "rechazado",
    contacto: "camila@uniandes.edu.co",
    nombrePagador: "Camila Rojas",
    monto: 32_000,
    monitoria: { estado: "cancelada", motivoCancelacion: "pago_rechazado", fecha: "2030-01-07" },
  };

  it("va al contacto del pago, con su nombre, su monto, el día de la sesión y el correo de Calibra", () => {
    expect(correoDeRechazo(RECHAZADO, "datos@calibra.example")).toEqual({
      destinatario: "camila@uniandes.edu.co",
      datos: { nombre: "Camila Rojas", monto: 32_000, fechaSesion: "2030-01-07", contactoSoporte: "datos@calibra.example" },
    });
  });

  it("sin correo de Calibra configurado, no promete un contacto de soporte", () => {
    const correo = correoDeRechazo(RECHAZADO, null);
    expect(correo?.datos).toEqual({ nombre: "Camila Rojas", monto: 32_000, fechaSesion: "2030-01-07" });
    expect(renderizar("pago_rechazado_individual", correo!.datos).texto).not.toContain("escríbenos");
  });

  it("la plantilla lo arma con el día legible y sin reembolso", () => {
    const correo = renderizar("pago_rechazado_individual", correoDeRechazo(RECHAZADO, "datos@calibra.example")!.datos);
    // El peso lleva un espacio duro.
    const texto = correo.texto.replace(/[\xa0 ]/g, " ");
    expect(correo.asunto).toBe("No pudimos verificar tu pago y la monitoría se canceló");
    expect(texto).toContain("No pudimos verificar tu pago de $ 32.000, así que la monitoría del 7 de enero de 2030 quedó cancelada.");
    expect(texto).toContain("no hay reembolso");
    expect(texto).toContain("escríbenos a datos@calibra.example");
  });

  it.each([
    ["el pago sigue en revisión", { ...RECHAZADO, estado: "en_revision" as const }],
    ["el pago se aprobó", { ...RECHAZADO, estado: "aprobado" as const }],
    ["P-24: la monitoría se realizó", { ...RECHAZADO, monitoria: { estado: "realizada" as const, motivoCancelacion: null, fecha: "2030-01-07" } }],
    ["P-24: la monitoría sigue confirmada", { ...RECHAZADO, monitoria: { estado: "confirmada" as const, motivoCancelacion: null, fecha: "2030-01-07" } }],
    ["la canceló el estudiante", { ...RECHAZADO, monitoria: { estado: "cancelada" as const, motivoCancelacion: "estudiante" as const, fecha: "2030-01-07" } }],
    ["no tiene monitoría legible", { ...RECHAZADO, monitoria: null }],
  ])("no aplica si %s", (_caso, pago) => {
    expect(correoDeRechazo(pago, "datos@calibra.example")).toBeNull();
  });
});

describe("avisosDeLaPagina", () => {
  // Sin caso: la monitoría se canceló (el rechazo la canceló o el estudiante ya lo había hecho).
  const RECHAZADO = {
    estado: "rechazado" as const,
    contacto: "camila@uniandes.edu.co",
    caso: null,
    monitoria: { estado: "cancelada" as const, motivoCancelacion: "pago_rechazado" as const },
  };
  const EN_UNOS_MINUTOS = "Rechazaste el pago. Ya no aparece en tu bandeja. Le avisaremos al pagador por correo en unos minutos.";

  it("dice que se aprobó solo si el pago de verdad está aprobado", () => {
    expect(avisosDeLaPagina({ revisado: "aprobado" }, { ...RECHAZADO, estado: "aprobado" })).toEqual([
      { exito: true, texto: "Aprobaste el pago. Ya no aparece en tu bandeja." },
    ]);
    expect(avisosDeLaPagina({ revisado: "aprobado" }, { ...RECHAZADO, estado: "en_revision" })).toEqual([]);
    expect(avisosDeLaPagina({ revisado: "rechazado" }, { ...RECHAZADO, estado: "aprobado" })).toEqual([]);
  });

  it("HU-076: al rechazar una cita que se canceló, dice que el correo al pagador saldrá en unos minutos", () => {
    expect(avisosDeLaPagina({ revisado: "rechazado" }, RECHAZADO)).toEqual([{ exito: true, texto: EN_UNOS_MINUTOS }]);
  });

  it("HU-076: con la cita ya cancelada por el estudiante también sale el correo, el de «no hay reembolso»", () => {
    const pago = { ...RECHAZADO, monitoria: { estado: "cancelada" as const, motivoCancelacion: "estudiante" as const } };
    expect(avisosDeLaPagina({ revisado: "rechazado" }, pago)).toEqual([{ exito: true, texto: EN_UNOS_MINUTOS }]);
  });

  it("HU-076: si el contacto no es un correo, no promete nada y le dice al admin que avise él", () => {
    expect(avisosDeLaPagina({ revisado: "rechazado" }, { ...RECHAZADO, contacto: "3001234567" })).toEqual([
      { exito: true, texto: "Rechazaste el pago. Ya no aparece en tu bandeja." },
      { exito: false, texto: "El contacto del pagador no es un correo: avísale tú, al 3001234567." },
    ]);
  });

  it("si al pagador no se le escribe (cancelada por otro motivo, o un caso P-24 ya cerrado), no promete ningún correo", () => {
    const solo = [{ exito: true, texto: "Rechazaste el pago. Ya no aparece en tu bandeja." }];
    expect(avisosDeLaPagina({ revisado: "rechazado" }, { ...RECHAZADO, monitoria: { estado: "cancelada", motivoCancelacion: "monitor_no_asistio" } })).toEqual(solo);
    expect(avisosDeLaPagina({ revisado: "rechazado" }, { ...RECHAZADO, caso: "cerrado", monitoria: { estado: "realizada", motivoCancelacion: null } })).toEqual(solo);
  });

  it("el parámetro ?correo= ya no hace nada: un enlace viejo o escrito a mano no inventa avisos del correo", () => {
    for (const correo of ["enviado", "por_reintentar", "no_es_correo", "fallo"]) {
      expect(avisosDeLaPagina({ revisado: "rechazado", correo }, RECHAZADO)).toEqual([{ exito: true, texto: EN_UNOS_MINUTOS }]);
    }
  });

  it("HU-078, criterio 5: tras un rechazo en P-24 dice que el caso quedó en Pagos por cobrar o asumir, y no que salió de la bandeja", () => {
    const p24 = { ...RECHAZADO, caso: "abierto" as const, monitoria: { estado: "realizada" as const, motivoCancelacion: null } };
    const exito = {
      exito: true,
      texto: "Rechazaste el pago. El caso quedó en «Pagos por cobrar o asumir» de la bandeja hasta que alguien lo cierre como cobrado o asumido.",
    };
    expect(avisosDeLaPagina({ revisado: "rechazado" }, p24)).toEqual([exito]);
    // En P-24 no se le escribe al pagador: un ?correo= escrito a mano no inventa avisos del correo.
    expect(avisosDeLaPagina({ revisado: "rechazado", correo: "enviado" }, p24)).toEqual([exito]);
    expect(avisosDeLaPagina({ revisado: "rechazado", correo: "fallo" }, p24)).toEqual([exito]);
    // Un enlace viejo no anuncia un rechazo que no pasó.
    expect(avisosDeLaPagina({ revisado: "rechazado" }, { ...p24, estado: "aprobado" })).toEqual([]);
  });

  it("los errores que vuelven a la página se dicen como alerta; los desconocidos no", () => {
    for (const error of ["ya_revisado", "no_asignado", "no_individual"] as const) {
      expect(avisosDeLaPagina({ error }, RECHAZADO)).toEqual([{ exito: false, texto: MENSAJES_DE_REVISION[error] }]);
    }
    expect(avisosDeLaPagina({ error: "comprobante" }, RECHAZADO)).toEqual([{ exito: false, texto: MENSAJE_DEL_COMPROBANTE }]);
    expect(avisosDeLaPagina({ error: "<script>" }, RECHAZADO)).toEqual([]);
    expect(avisosDeLaPagina({ error: ["ya_revisado", "no_asignado"] }, RECHAZADO)).toEqual([]);
  });
});
