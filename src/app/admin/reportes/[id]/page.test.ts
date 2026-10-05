import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PagoParaElReporte, ReporteParaResolver } from "@/lib/admin/reportes";
import { MENSAJES_DE_RESOLUCION } from "@/lib/admin/reportes-reglas";
import { LARGO_MAXIMO_NOMBRE_PAGADOR } from "@/lib/pagos/reglas";
import ResolverUnReporte from "./page";

// Sin navegador ni base: la resolución de un reporte con la sesión y el reporte inventados, y se lee el HTML. Aquí se
// fija qué ve cada admin (el asignado con los dos formularios cerrados, otro admin sin acciones, el reporte ya decidido
// con sus observaciones), qué consecuencias se leen antes de cada decisión, que el texto de quien reportó y de quien
// pagó se escapa y que ni la llave del monitor ni cifras de comisión llegan a la página. El recorrido con la base lo
// cubre e2e/resolver-reportes.spec.ts.

const ID = "30303030-0000-4000-8000-000000000030";
const MONITORIA = "40404040-0000-4000-8000-000000000030";
const REEMBOLSO = "70707070-0000-4000-8000-000000000030";
const YO = "a0a0a0a0-0000-4000-8000-000000000030";
const OTRO = "a0a0a0a0-0000-4000-8000-000000003001";

const rutas = vi.hoisted(() => ({ pedidas: [] as string[] }));
const datos = vi.hoisted(() => ({ reporte: null as ReporteParaResolver | null, falla: null as Error | null }));

vi.mock("@/lib/auth/sesion", () => ({
  exigirRol: async (_rol: string, ruta: string) => {
    rutas.pedidas.push(ruta);
    return { idUsuario: YO, rol: "admin" };
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => ({}) }));
vi.mock("@/lib/admin/reportes", () => ({
  cargarReporte: async () => {
    if (datos.falla) throw datos.falla;
    return datos.reporte;
  },
  cargarAsignacionDeReporte: vi.fn(),
  resolverReporte: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

const AHORA = new Date("2030-01-07T16:00:00.000Z");

const PAGO: PagoParaElReporte = {
  id: "50505050-0000-4000-8000-000000000030",
  nombrePagador: "Camila Rojas",
  monto: 32_000,
  estado: "aprobado",
  caso: null,
  cierre: null,
  reembolso: null,
  resena: null,
};

function reporte(
  cambios: Partial<Omit<ReporteParaResolver, "monitoria">> = {},
  monitoria: Partial<ReporteParaResolver["monitoria"]> = {},
): ReporteParaResolver {
  return {
    id: ID,
    estado: "en_revision",
    idAdmin: YO,
    nombreAdmin: "Admin Uno",
    // 12:00 m. del 7 de enero de 2030 en Bogotá.
    fechaReporte: new Date("2030-01-07T17:00:00.000Z"),
    fechaDecision: null,
    observaciones: null,
    lead: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", telefono: "3001234567" },
    monitor: { nombre: "Andrés Gómez", correo: "andres@uniandes.edu.co", telefono: "3109876543" },
    desembolso: null,
    desembolsableDesde: new Date("2030-01-08T16:00:00.000Z"),
    monitoria: {
      id: MONITORIA,
      estado: "confirmada",
      motivoCancelacion: null,
      fecha: "2030-01-07",
      hora: "10:00:00",
      duracionMin: 60,
      nombreMateria: "Cálculo Diferencial",
      fechaFinalizacion: null,
      grupal: false,
      ...monitoria,
    },
    pagos: [PAGO],
    ...cambios,
  };
}

async function pintar(r: ReporteParaResolver | null, consulta: Record<string, string> = {}, id = ID): Promise<string> {
  datos.reporte = r;
  return renderToStaticMarkup(await ResolverUnReporte({ params: Promise.resolve({ id }), searchParams: Promise.resolve(consulta) }));
}

/** El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  vi.useFakeTimers({ now: AHORA, toFake: ["Date"] });
  rutas.pedidas = [];
  datos.falla = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Resolución de un reporte (HU-030): lo que ve el admin", () => {
  it("quién reportó y cómo contactarlo, el monitor y su contacto, la monitoría, el estado y a quién está asignado", async () => {
    const html = await pintar(reporte());
    const t = texto(html);
    for (const dato of [
      "Reportes de inasistencia",
      "Resolver el reporte",
      "Reportó Camila Rojas",
      "Contacto de quien reportó camila@uniandes.edu.co · 3001234567",
      "Reportado lunes, 7 de enero de 2030, 12:00 p. m.",
      "Estado En revisión",
      "Asignado a Admin Uno",
      "Materia Cálculo Diferencial",
      "Monitor Andrés Gómez",
      "Contacto del monitor andres@uniandes.edu.co · 3109876543",
      "Fecha 7 de enero de 2030",
      "Hora 10:00 a 11:00",
      "Estado Confirmada",
    ]) {
      expect(t, dato).toContain(dato);
    }
    expect(html).toContain('<time dateTime="2030-01-07T17:00:00.000Z">');
    expect(html).toContain('<time dateTime="2030-01-07">7 de enero de 2030</time>');
    expect(rutas.pedidas).toEqual([`/admin/reportes/${ID}`]);
  });

  it("el contacto es el que haya: solo el correo, solo el teléfono o ninguno", async () => {
    expect(texto(await pintar(reporte({ lead: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", telefono: null } })))).toContain(
      "Contacto de quien reportó camila@uniandes.edu.co Reportado",
    );
    expect(texto(await pintar(reporte({ lead: { nombre: "Camila Rojas", correo: null, telefono: "3001234567" } })))).toContain(
      "Contacto de quien reportó 3001234567 Reportado",
    );
    expect(texto(await pintar(reporte({ lead: { nombre: "Camila Rojas", correo: null, telefono: null } })))).toContain(
      "Contacto de quien reportó Sin datos de contacto",
    );
  });

  it("subtítulo solo para quien puede resolver", async () => {
    expect(texto(await pintar(reporte()))).toContain("Quien agendó dice que el monitor no llegó. Revisa los datos y decide.");
    expect(texto(await pintar(reporte({ idAdmin: OTRO, nombreAdmin: "Admin Dos" })))).not.toContain("Quien agendó dice");
    expect(texto(await pintar(reporte({ estado: "aceptado", fechaDecision: new Date("2030-01-08T15:00:00.000Z") })))).not.toContain("Quien agendó dice");
  });

  it("la hora en que quedó realizada se dice sin atribuirla al monitor, y solo si la hay", async () => {
    const sin = texto(await pintar(reporte()));
    expect(sin).not.toContain("quedó realizada");
    const html = await pintar(reporte({}, { estado: "realizada", fechaFinalizacion: new Date("2030-01-07T18:30:00.000Z") }));
    // La hora termina en "p. m.": ese punto cierra la frase, sin un segundo punto.
    expect(texto(html)).toContain("La monitoría quedó realizada el lunes, 7 de enero de 2030, 1:30 p. m. Pagos");
    expect(html).not.toContain("p. m..");
    expect(html).toContain('<time dateTime="2030-01-07T18:30:00.000Z">');
    expect(texto(html)).not.toMatch(/el monitor la marc/i);
    expect(texto(html)).toContain("Estado Realizada");
  });

  it("los pagos con su nombre, monto y estado; nunca bruto, comisión ni neto", async () => {
    const t = texto(
      await pintar(
        reporte({
          pagos: [
            PAGO,
            { ...PAGO, id: "50505050-0000-4000-8000-000000000031", nombrePagador: "Luis Pérez", monto: 15_000, estado: "en_revision" },
            { ...PAGO, id: "50505050-0000-4000-8000-000000000032", nombrePagador: "Ana Torres", monto: 8_000, estado: "rechazado" },
          ],
        }),
      ),
    );
    expect(t).toContain("Camila Rojas $ 32.000 · Aprobado");
    expect(t).toContain("Luis Pérez $ 15.000 · En revisión");
    expect(t).toContain("Ana Torres $ 8.000 · Rechazado");
    expect(t).not.toMatch(/comisi|bruto|neto/i);
  });

  it("un pago rechazado con caso P-24 abierto dice que está por cobrar o asumir", async () => {
    const t = texto(await pintar(reporte({ pagos: [{ ...PAGO, estado: "rechazado", caso: "abierto" }] })));
    expect(t).toContain("Rechazado Por cobrar o asumir");
    expect(texto(await pintar(reporte({ pagos: [{ ...PAGO, estado: "rechazado", caso: null }] })))).not.toContain("Por cobrar o asumir");
  });

  it("el reembolso de un pago dice cómo va y abre su página", async () => {
    for (const [estado, dicho] of [
      ["esperando_llave", "Reembolso: esperando la llave"],
      ["pendiente", "Reembolso: listo para transferir"],
      ["reembolsado", "Reembolso: reembolsado"],
    ] as const) {
      const html = await pintar(reporte({ pagos: [{ ...PAGO, reembolso: { id: REEMBOLSO, estado } }] }));
      expect(texto(html), estado).toContain(dicho);
      expect(html).toContain(`<a href="/admin/reembolsos/${REEMBOLSO}"`);
      expect(texto(html)).toContain("Abrir el reembolso");
    }
    expect(await pintar(reporte())).not.toContain("/admin/reembolsos/");
  });

  it("D-40 (c): la reseña, si hay, se muestra con su calificación y su comentario; sin reseña, no hay sección", async () => {
    const con = texto(await pintar(reporte({ pagos: [{ ...PAGO, resena: { calificacion: 4, comentario: "Se demoró en conectarse." } }] })));
    expect(con).toContain("Reseña");
    expect(con).toContain("Camila Rojas 4 de 5. Se demoró en conectarse.");
    const sinComentario = texto(await pintar(reporte({ pagos: [{ ...PAGO, resena: { calificacion: 5, comentario: null } }] })));
    expect(sinComentario).toContain("Camila Rojas 5 de 5");
    expect(texto(await pintar(reporte()))).not.toContain("Reseña");
  });

  it("D-40 (c): el nombre de quien pagó, texto libre de hasta 120 caracteres, no va como etiqueta de una lista de datos: su columna mide lo que mide el nombre en una línea y aplasta la reseña a 390 px", async () => {
    const nombre = "Nombre muy largo ".repeat(8).slice(0, LARGO_MAXIMO_NOMBRE_PAGADOR);
    expect(nombre).toHaveLength(120);
    const html = await pintar(reporte({ pagos: [{ ...PAGO, nombrePagador: nombre, resena: { calificacion: 2, comentario: "No llegó nunca." } }] }));
    const resena = html.split('aria-labelledby="resena"')[1].split("</section>")[0];
    expect(resena).toContain(nombre);
    expect(texto(resena)).toContain("2 de 5. No llegó nunca.");
    // Un `<dt>` queda en la primera columna (`max-content`) de la cuadrícula de datos; el nombre va en una tarjeta que sí parte líneas.
    expect(resena).not.toMatch(/<dl|<dt|<dd/);
    expect(resena).toMatch(/<ul[^>]*>\s*<li[^>]*>/);
  });
});

describe("Resolución de un reporte: quién puede decidir", () => {
  it("el asignado con el reporte en revisión ve los dos formularios, cada uno dentro de un <details> cerrado", async () => {
    const html = await pintar(reporte());
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html.match(/<form/g)).toHaveLength(2);
    const t = texto(html);
    expect(t).toContain("Aceptar el reporte");
    expect(t).toContain("Rechazar el reporte");
    expect(t).toContain("Sí, aceptar el reporte");
    expect(t).toContain("Sí, rechazar el reporte");
    expect(html).toContain('name="id_reporte" value="' + ID + '"');
    expect(html).toContain('name="decision" value="aceptar"');
    expect(html).toContain('name="decision" value="rechazar"');
    // Observaciones opcionales, de hasta 500 caracteres, con la ayuda de quién las lee.
    expect(html.match(/maxLength="500"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<textarea[^>]* required/);
    expect(t).toContain("Quien pagó lee este comentario junto con la solicitud de su llave");
    expect(t).toContain("Quien reportó lo lee en la página de su cita");
  });

  it("cada botón apunta a su consecuencia: se lee antes de confirmar", async () => {
    const html = await pintar(reporte());
    expect(html).toContain('aria-describedby="aceptar-consecuencias"');
    expect(html).toContain('aria-describedby="rechazar-consecuencias"');
    expect(html).toContain('id="aceptar-consecuencias"');
    expect(html).toContain('id="rechazar-consecuencias"');
  });

  it("las consecuencias salen del estado real: un reembolso, el aviso al monitor y que no se deshace al aceptar", async () => {
    const t = texto(await pintar(reporte()));
    expect(t).toContain("La monitoría del 7 de enero de 2030 pasa a cancelada porque el monitor no asistió, y no se le desembolsa.");
    expect(t).toContain("Creamos un reembolso de $ 32.000 y le pedimos la llave a quien pagó, por correo.");
    expect(t).toContain("Le avisamos al monitor por correo, sin los datos de contacto de quien reportó.");
    expect(t).toContain("La monitoría sigue como estaba y no se crea ningún reembolso. El reporte no se puede volver a hacer.");
    expect(t).toContain("Quien reportó verá tu decisión y tus observaciones en la página de su cita; no le mandamos correo.");
    expect(t.match(/Esta decisión no se puede deshacer\./g)).toHaveLength(2);
  });

  it("con el desembolso pendiente, rechazar dice desde cuándo se puede ejecutar; con el ya transferido, aceptar dice que no se anula", async () => {
    const pendiente = texto(await pintar(reporte({ desembolso: "pendiente" }, { estado: "realizada" })));
    expect(pendiente).toContain("(después del martes, 8 de enero de 2030, 11:00 a. m.)");
    const transferido = texto(await pintar(reporte({ desembolso: "desembolsado" }, { estado: "realizada" })));
    expect(transferido).toContain("Su desembolso ya se había transferido al monitor y no se anula.");
  });

  it("otro admin lo ve sin formularios y sabe quién lo tiene asignado", async () => {
    const html = await pintar(reporte({ idAdmin: OTRO, nombreAdmin: "Admin Dos" }));
    expect(texto(html)).toContain("Este reporte lo tiene asignado Admin Dos: solo esa persona lo resuelve.");
    expect(html).not.toMatch(/<form|<details|<textarea|<button/);
    expect(texto(html)).not.toContain("Aceptar el reporte");
    // Pero ve los mismos datos del caso (supuesto 10).
    expect(texto(html)).toContain("Reportó Camila Rojas");
  });

  it("un reporte ya decidido no tiene formularios, y dice cuándo se decidió y con qué observaciones", async () => {
    for (const [estado, titulo, dicho] of [
      ["aceptado", "Reporte aceptado", "Estado Aceptado"],
      ["rechazado", "Reporte rechazado", "Estado Rechazado"],
    ] as const) {
      const html = await pintar(
        reporte({ estado, fechaDecision: new Date("2030-01-08T15:00:00.000Z"), observaciones: "El monitor avisó que no podía.\nSe revisó el chat." }),
      );
      const t = texto(html);
      expect(t, estado).toContain(titulo);
      expect(t, estado).toContain(dicho);
      expect(t, estado).toContain("Decidido martes, 8 de enero de 2030, 10:00 a. m.");
      expect(t, estado).toContain("Observaciones El monitor avisó que no podía. Se revisó el chat.");
      expect(html, estado).not.toMatch(/<form|<details|<textarea|<button/);
      expect(html, estado).toContain('<time dateTime="2030-01-08T15:00:00.000Z">');
      expect(t, estado).not.toContain("solo esa persona lo resuelve");
    }
  });

  it("un reporte en revisión no tiene fecha ni observaciones de decisión", async () => {
    const t = texto(await pintar(reporte()));
    expect(t).not.toContain("Decidido");
    expect(t).not.toContain("Observaciones El");
  });

  it("de una monitoría grupal, todavía sin formularios: sus reportes llegan con HU-045", async () => {
    const html = await pintar(reporte({}, { grupal: true }));
    expect(texto(html)).toContain(MENSAJES_DE_RESOLUCION.no_individual);
    expect(texto(html)).toContain("Grupal · Confirmada");
    expect(html).not.toMatch(/<form|<details|<textarea|<button/);
  });

  it("siempre ofrece volver a la bandeja", async () => {
    for (const r of [reporte(), reporte({ idAdmin: OTRO }), reporte({ estado: "aceptado" })]) {
      const html = await pintar(r);
      expect(html).toMatch(/<a [^>]*href="\/admin"[^>]*>Volver a mi bandeja<\/a>/);
    }
  });
});

describe("Resolución de un reporte: avisos de arriba", () => {
  it("?resuelto=aceptado con el reporte de verdad aceptado: aviso de éxito con role=status y lo que hay en la base", async () => {
    const html = await pintar(
      reporte({
        estado: "aceptado",
        desembolso: "anulado",
        fechaDecision: new Date("2030-01-08T15:00:00.000Z"),
        pagos: [{ ...PAGO, reembolso: { id: REEMBOLSO, estado: "esperando_llave" } }],
      }),
      { resuelto: "aceptado" },
    );
    expect(html).toMatch(/<p role="status"[^>]*>Aceptaste el reporte\. La monitoría quedó cancelada y su desembolso, anulado\. Creamos 1 reembolso y le pedimos la llave a quien pagó\. Le avisamos al monitor por correo\.<\/p>/);
  });

  it("?resuelto=rechazado con el reporte de verdad rechazado", async () => {
    const html = await pintar(reporte({ estado: "rechazado", fechaDecision: new Date("2030-01-08T15:00:00.000Z") }), { resuelto: "rechazado" });
    expect(html).toMatch(/<p role="status"[^>]*>Rechazaste el reporte\./);
  });

  it("un enlace viejo o escrito a mano no anuncia una decisión que no pasó", async () => {
    expect(await pintar(reporte(), { resuelto: "aceptado" })).not.toContain('role="status"');
    expect(await pintar(reporte(), { resuelto: "rechazado" })).not.toContain('role="status"');
    expect(await pintar(reporte({ estado: "rechazado" }), { resuelto: "aceptado" })).not.toContain('role="status"');
  });

  it.each(["ya_decidido", "no_asignado", "no_individual", "no_aceptable"] as const)("?error=%s se dice con role=alert", async (error) => {
    const html = await pintar(reporte(), { error });
    expect(html).toContain(`<p role="alert"`);
    expect(texto(html)).toContain(MENSAJES_DE_RESOLUCION[error]);
  });

  it("un error desconocido no se anuncia", async () => {
    expect(await pintar(reporte(), { error: "otro" })).not.toContain('role="alert"');
  });
});

describe("Resolución de un reporte: lo que no se puede abrir", () => {
  it("un id que no es un uuid es un 404, sin leer nada", async () => {
    await expect(pintar(reporte(), {}, "no-es-un-id")).rejects.toThrow("notFound");
  });

  it("un reporte que no existe (o que la sesión no lee) es un 404", async () => {
    await expect(pintar(null)).rejects.toThrow("notFound");
  });

  it("si la base falla, lo dice con role=alert, sin detalles, y deja volver a la bandeja", async () => {
    datos.falla = new Error("se cayó la base: detalle interno");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await pintar(reporte());
    espia.mockRestore();
    expect(texto(html)).toContain("No pudimos cargar el reporte");
    expect(html).toContain('<p role="alert"');
    expect(texto(html)).toContain("Recarga la página; si sigue igual, avisa al equipo.");
    expect(html).not.toContain("detalle interno");
    expect(texto(html)).toContain("Volver a mi bandeja");
    expect(html).not.toMatch(/<form|<details|<textarea/);
  });

  it("pide la sesión de admin con la ruta del reporte antes de cargar nada", async () => {
    await pintar(reporte());
    expect(rutas.pedidas).toEqual([`/admin/reportes/${ID}`]);
  });
});

describe("Resolución de un reporte: lo que viene de fuera se escapa y lo secreto no llega", () => {
  const MALICIOSO = '<script>alert("x")</script><img src=x onerror=alert(1)>';

  it("escapa el nombre de quien reportó, las observaciones, la reseña, los nombres de los pagadores y el monitor", async () => {
    const html = await pintar(
      reporte({
        estado: "rechazado",
        fechaDecision: new Date("2030-01-08T15:00:00.000Z"),
        observaciones: MALICIOSO,
        lead: { nombre: MALICIOSO, correo: "a@b.co", telefono: null },
        monitor: { nombre: MALICIOSO, correo: null, telefono: null },
        pagos: [{ ...PAGO, nombrePagador: MALICIOSO, resena: { calificacion: 1, comentario: MALICIOSO } }],
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html.match(/&lt;script&gt;/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it("la llave del monitor, la del desembolso y cualquier cifra de comisión no aparecen, aunque el objeto las trajera", async () => {
    const intruso = reporte({
      desembolso: "pendiente",
      monitor: {
        nombre: "Andrés Gómez",
        correo: "andres@uniandes.edu.co",
        telefono: "3109876543",
        llave: "LLAVE-DEL-MONITOR-9999",
      } as ReporteParaResolver["monitor"],
    });
    Object.assign(intruso, { llaveDestino: "LLAVE-DESTINO-8888", montoBruto: 987_654, comision: 123_456, montoNeto: 864_198 });
    const html = await pintar(intruso);
    for (const secreto of ["LLAVE-DEL-MONITOR-9999", "LLAVE-DESTINO-8888", "987.654", "123.456", "864.198"]) {
      expect(html, secreto).not.toContain(secreto);
    }
    expect(texto(html)).not.toMatch(/comisi|bruto|neto/i);
  });

  it("sin cifras de comisión en ningún estado de la página", async () => {
    for (const r of [
      reporte(),
      reporte({ desembolso: "pendiente" }, { estado: "realizada" }),
      reporte({ idAdmin: OTRO }),
      reporte({ estado: "aceptado", desembolso: "anulado" }),
      reporte({ estado: "rechazado" }),
    ]) {
      expect(texto(await pintar(r))).not.toMatch(/comisi|bruto|neto/i);
    }
  });
});
