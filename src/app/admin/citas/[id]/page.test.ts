import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CitaParaAutorizar, PagoParaAutorizar } from "@/lib/admin/citas";
import { MENSAJES_DE_AUTORIZACION, type AutorizacionRegistrada } from "@/lib/admin/citas-reglas";
import { formatearPesos } from "@/lib/moneda";
import AutorizarUnaCancelacion, { metadata } from "./page";

// Sin navegador ni base: la página de una cita con la sesión y la cita inventadas, y se lee el HTML. Aquí se fija qué ve el
// admin (los datos, los pagos con lo que se devolvería, el aviso de P-07 a la vista, el formulario solo cuando se puede
// autorizar y dentro de una confirmación cerrada, el registro de una autorización ya hecha, el motivo por el que no se
// puede), que el texto libre se escapa y que ninguna cifra de comisión llega a la página. El recorrido con la base lo
// cubre e2e/cancelar-fuera-de-plazo.spec.ts.

const ID = "52525252-0000-4000-8000-000000000052";
const REEMBOLSO = "70707070-0000-4000-8000-000000000052";
const YO = "a0a0a0a0-0000-4000-8000-000000000052";
const OTRO = "a0a0a0a0-0000-4000-8000-000000005201";
const OTRA_CITA = "52525252-0000-4000-8000-000000005299";

const rutas = vi.hoisted(() => ({ pedidas: [] as [string, string][], cargadas: [] as string[] }));
const datos = vi.hoisted(() => ({ cita: null as CitaParaAutorizar | null, falla: null as Error | null }));

vi.mock("@/lib/auth/sesion", () => ({
  exigirRol: async (rol: string, ruta: string) => {
    rutas.pedidas.push([rol, ruta]);
    return { idUsuario: YO, rol: "admin" };
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => ({}) }));
vi.mock("@/lib/admin/citas", () => ({
  cargarCitaParaAutorizar: async (_cliente: unknown, id: string) => {
    rutas.cargadas.push(id);
    if (datos.falla) throw datos.falla;
    return datos.cita;
  },
  cargarCitasSinPlazo: vi.fn(),
  autorizarCancelacion: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

// 4:00 a. m. del lunes 7 de enero de 2030 en Bogotá: el plazo terminó anoche a las 10:00 p. m. y la sesión empieza a las 10:00 a. m.
const AHORA = new Date("2030-01-07T09:00:00.000Z");

const PAGO: PagoParaAutorizar = {
  id: "50505050-0000-4000-8000-000000000052",
  nombrePagador: "Camila Rojas",
  monto: 32_000,
  estado: "aprobado",
  reembolso: null,
};

const AUTORIZACION: AutorizacionRegistrada = {
  categoria: "fuerza_mayor",
  nota: "Accidente de tránsito.\nLa familia avisó por correo.",
  autorizadaEn: new Date("2030-01-07T08:30:00.000Z"),
  idAdmin: YO,
  nombreAdmin: "Admin Uno",
};

function cita(cambios: Partial<CitaParaAutorizar> = {}): CitaParaAutorizar {
  return {
    id: ID,
    estado: "confirmada",
    motivoCancelacion: null,
    fecha: "2030-01-07",
    hora: "10:00:00",
    duracionMin: 60,
    nombreMateria: "Cálculo Diferencial",
    nombreMonitor: "Andrés Gómez",
    lead: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", telefono: "3001234567" },
    inicio: new Date("2030-01-07T15:00:00.000Z"),
    cancelableHasta: new Date("2030-01-07T03:00:00.000Z"),
    grupal: false,
    pagos: [PAGO],
    autorizacion: null,
    ...cambios,
  };
}

/** Una cita ya cancelada con su autorización registrada y los reembolsos que nacieron. */
const autorizada = (cambios: Partial<CitaParaAutorizar> = {}) =>
  cita({
    estado: "cancelada",
    motivoCancelacion: "estudiante",
    autorizacion: AUTORIZACION,
    pagos: [{ ...PAGO, reembolso: { id: REEMBOLSO, estado: "esperando_llave" } }],
    ...cambios,
  });

async function pintar(c: CitaParaAutorizar | null, consulta: Record<string, string> = {}, id = ID): Promise<string> {
  datos.cita = c;
  return renderToStaticMarkup(await AutorizarUnaCancelacion({ params: Promise.resolve({ id }), searchParams: Promise.resolve(consulta) }));
}

/** El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Lo que cuesta una frase con cifras: los montos llevan espacio duro, que `texto` vuelve normal. */
const pesos = (monto: number) => texto(formatearPesos(monto));

beforeEach(() => {
  vi.useFakeTimers({ now: AHORA, toFake: ["Date"] });
  rutas.pedidas = [];
  rutas.cargadas = [];
  datos.falla = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Autorizar una cancelación (HU-052): lo que ve el admin", () => {
  it("el título de la pestaña y la sesión: se pide el rol de admin con la ruta de la cita, y se carga la cita de la dirección", async () => {
    expect(metadata.title).toBe("Autorizar una cancelación · Calibra");
    await pintar(cita());
    // El rol cuenta tanto como la ruta: con otro rol, el admin rebotaría y un monitor o un Lead entrarían.
    expect(rutas.pedidas).toEqual([["admin", `/admin/citas/${ID}`]]);
    expect(rutas.cargadas).toEqual([ID]);
  });

  it("carga la cita que trae la dirección, sea cual sea, y no otra", async () => {
    await pintar(cita({ id: OTRA_CITA }), {}, OTRA_CITA);
    expect(rutas.pedidas).toEqual([["admin", `/admin/citas/${OTRA_CITA}`]]);
    expect(rutas.cargadas).toEqual([OTRA_CITA]);
  });

  it("los datos de la cita: materia, fecha, hora, monitor, quién agendó y cómo contactarlo, estado y plazo", async () => {
    const html = await pintar(cita());
    const t = texto(html);
    for (const dato of [
      "Cancelaciones",
      "Autorizar la cancelación",
      "Materia Cálculo Diferencial",
      "Fecha 7 de enero de 2030",
      "Hora 10:00 a 11:00",
      "Monitor Andrés Gómez",
      "Quién agendó Camila Rojas",
      "Contacto de quien agendó camila@uniandes.edu.co · 3001234567",
      "Estado Confirmada",
      // El plazo ya pasó: 10:00 p. m. del domingo 6 de enero (3:00 a. m. UTC del 7 era la medianoche; el plazo es 12 h antes de las 10:00 a. m.).
      "Plazo para cancelar Terminó el",
    ]) {
      expect(t, dato).toContain(dato);
    }
    expect(html).toContain('<time dateTime="2030-01-07">7 de enero de 2030</time>');
    expect(html).toContain('<time dateTime="2030-01-07T03:00:00.000Z">');
    // Un monitor, sin su contacto (P-37).
    expect(t).not.toContain("andres@");
  });

  it("el contacto es el que haya: solo el correo, solo el teléfono o ninguno", async () => {
    expect(texto(await pintar(cita({ lead: { nombre: "Camila Rojas", correo: "camila@uniandes.edu.co", telefono: null } })))).toContain(
      "Contacto de quien agendó camila@uniandes.edu.co Estado",
    );
    expect(texto(await pintar(cita({ lead: { nombre: "Camila Rojas", correo: null, telefono: "3001234567" } })))).toContain(
      "Contacto de quien agendó 3001234567 Estado",
    );
    expect(texto(await pintar(cita({ lead: { nombre: "Camila Rojas", correo: null, telefono: null } })))).toContain(
      "Contacto de quien agendó Sin datos de contacto Estado",
    );
  });

  it("el nombre, el contacto y los nombres de quienes pagaron son texto libre: se escapan y se pueden partir", async () => {
    const html = await pintar(
      cita({
        lead: { nombre: "<img src=x onerror=alert(1)>", correo: "<b>largo</b>@uniandes.edu.co", telefono: null },
        pagos: [{ ...PAGO, nombrePagador: "<script>alert(2)</script>" }],
      }),
    );
    // El logo de la marca es un <img> y React deja su propio <script> para los formularios: se miran solo las etiquetas inyectadas.
    expect(html).not.toMatch(/<img src=x|<b>largo|<script>alert/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;largo&lt;/b&gt;@uniandes.edu.co");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("«Termina el» mientras el plazo no ha terminado y «Terminó el» cuando ya pasó", async () => {
    expect(texto(await pintar(cita()))).toContain("Terminó el");
    vi.setSystemTime(new Date("2030-01-07T02:00:00.000Z"));
    const antes = texto(await pintar(cita()));
    expect(antes).toContain("Plazo para cancelar Termina el");
    expect(antes).not.toContain("Terminó el");
    // El instante exacto del límite todavía es plazo (P-40).
    vi.setSystemTime(new Date("2030-01-07T03:00:00.000Z"));
    expect(texto(await pintar(cita()))).toContain("Termina el");
    vi.setSystemTime(new Date("2030-01-07T03:00:00.001Z"));
    expect(texto(await pintar(cita()))).toContain("Terminó el");
  });

  it("una grupal lo dice en su estado", async () => {
    expect(texto(await pintar(cita({ grupal: true })))).toContain("Estado Grupal · Confirmada");
  });

  it("siempre se puede volver a la bandeja", async () => {
    for (const c of [cita(), autorizada(), cita({ estado: "realizada" })]) {
      expect(await pintar(c)).toMatch(/<a [^>]*href="\/admin"[^>]*>Volver a mi bandeja<\/a>/);
    }
  });
});

describe("Autorizar una cancelación: los pagos y lo que se devolvería", () => {
  it("cada pago con su nombre, monto y estado; nunca bruto, comisión ni neto", async () => {
    const t = texto(
      await pintar(
        cita({
          pagos: [
            PAGO,
            { ...PAGO, id: "50505050-0000-4000-8000-000000000053", nombrePagador: "Luis Pérez", monto: 15_000, estado: "en_revision" },
            { ...PAGO, id: "50505050-0000-4000-8000-000000000054", nombrePagador: "Ana Torres", monto: 8_000, estado: "rechazado" },
          ],
        }),
      ),
    );
    expect(t).toContain(`Camila Rojas ${pesos(32_000)} · Aprobado`);
    expect(t).toContain(`Luis Pérez ${pesos(15_000)} · En revisión`);
    expect(t).toContain(`Ana Torres ${pesos(8_000)} · Rechazado`);
    expect(t).not.toMatch(/comisi|bruto|neto/i);
  });

  it("dice cuánto se devolvería: la suma de los pagos aprobados, no los que siguen en revisión ni los rechazados", async () => {
    const t = texto(
      await pintar(
        cita({
          pagos: [
            PAGO,
            { ...PAGO, id: "50505050-0000-4000-8000-000000000053", nombrePagador: "Luis Pérez", monto: 15_000 },
            { ...PAGO, id: "50505050-0000-4000-8000-000000000054", nombrePagador: "Ana Torres", monto: 9_000, estado: "en_revision" },
            { ...PAGO, id: "50505050-0000-4000-8000-000000000055", nombrePagador: "Otra Persona", monto: 8_000, estado: "rechazado" },
          ],
        }),
      ),
    );
    expect(t).toContain(`Se devolverían ${pesos(47_000)}.`);
  });

  it("sin pagos aprobados dice que no hay nada que devolver; sin pagos, que la monitoría no tiene", async () => {
    expect(texto(await pintar(cita({ pagos: [{ ...PAGO, estado: "en_revision" }] })))).toContain("No hay pagos aprobados que devolver.");
    const sin = texto(await pintar(cita({ pagos: [] })));
    expect(sin).toContain("Esta monitoría no tiene pagos.");
    expect(sin).toContain("No hay pagos aprobados que devolver.");
  });

  it("los pagos en revisión llevan el aviso de P-07 a la vista, fuera de la confirmación", async () => {
    const uno = await pintar(cita({ pagos: [PAGO, { ...PAGO, id: "50505050-0000-4000-8000-000000000053", estado: "en_revision" }] }));
    const aviso = "Un pago sigue en revisión: si se aprueba, recibe su reembolso; si se rechaza, no hay reembolso.";
    // Una vez en la página, antes del <details>; otra, dentro de él, en las consecuencias.
    const [antes, dentro] = uno.split("<details");
    expect(texto(antes)).toContain(aviso);
    expect(texto(dentro)).toContain(aviso);

    const varios = texto(
      await pintar(
        cita({
          pagos: [
            { ...PAGO, estado: "en_revision" },
            { ...PAGO, id: "50505050-0000-4000-8000-000000000053", estado: "en_revision" },
          ],
        }),
      ),
    );
    expect(varios).toContain("2 pagos siguen en revisión: cada uno recibe su reembolso si se aprueba; si se rechaza, no hay reembolso.");
    // Sin pagos en revisión no hay aviso.
    expect(texto(await pintar(cita()))).not.toContain("en revisión");
  });

  it("el reembolso de un pago dice cómo va y abre su página", async () => {
    for (const [estado, dicho] of [
      ["esperando_llave", "Reembolso: esperando la llave"],
      ["pendiente", "Reembolso: listo para transferir"],
      ["reembolsado", "Reembolso: reembolsado"],
    ] as const) {
      const html = await pintar(autorizada({ pagos: [{ ...PAGO, reembolso: { id: REEMBOLSO, estado } }] }));
      expect(texto(html), estado).toContain(dicho);
      expect(html).toContain(`<a href="/admin/reembolsos/${REEMBOLSO}"`);
      expect(texto(html)).toContain("Abrir el reembolso");
    }
    expect(await pintar(cita())).not.toContain("/admin/reembolsos/");
  });
});

describe("Autorizar una cancelación: el formulario, solo cuando se puede autorizar", () => {
  it("una cita que se puede autorizar tiene un solo formulario, dentro de un <details> cerrado", async () => {
    const html = await pintar(cita());
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html.match(/<form/g)).toHaveLength(1);
    // El formulario entero va dentro de la confirmación: nada de campos ni botón fuera.
    const [fuera, dentro] = html.split("<details");
    expect(fuera).not.toMatch(/<form|<input|<textarea|<button/);
    expect(dentro).toContain("<form");
    expect(dentro.split("</details>")[1]).not.toMatch(/<form|<input|<textarea|<button/);
    // El título del <details> es lo único que se ve con la confirmación cerrada.
    expect(html).toMatch(/<summary[^>]*>Autorizar la cancelación<\/summary>/);
  });

  it("trae el motivo con sus tres opciones, la nota con su ayuda y el botón de confirmar", async () => {
    const html = await pintar(cita());
    const t = texto(html);
    expect(html).toContain(`name="id_monitoria" value="${ID}"`);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    for (const valor of ["fuerza_mayor", "falla_de_calibra", "otro"]) expect(html, valor).toMatch(new RegExp(`<input[^>]* name="categoria"[^>]* value="${valor}"|<input[^>]* value="${valor}"[^>]* name="categoria"`));
    expect(html).not.toMatch(/<input[^>]* checked/);
    expect(t).toContain("Motivo");
    expect(t).toContain("Fuerza mayor de quien agendó (urgencia de salud, accidente o calamidad familiar)");
    expect(t).toContain("Una falla de Calibra impidió cancelar a tiempo");
    expect(t).toContain("Otro (la nota es obligatoria)");
    expect(t).toContain("Nota (hasta 500 caracteres)");
    expect(t).toContain("Escribe solo lo necesario para recordar el caso. No incluyas diagnósticos ni datos de salud.");
    expect(html).toMatch(/<textarea[^>]* maxLength="500"/);
    expect(html).toMatch(/<textarea[^>]* rows="4"/);
    expect(html).toMatch(/<textarea[^>]* aria-describedby="nota-ayuda"/);
    // Los campos no son obligatorios para el navegador: la acción es la que pide el motivo y la nota (con su mensaje).
    expect(html).not.toMatch(/ required/);
    expect(t).toContain("Sí, cancelar la monitoría");
  });

  it("el motivo se escoge tocando la etiqueta entera, que mide 44 px: la opción es un <label> que envuelve el círculo", async () => {
    const html = await pintar(cita());
    expect(html.match(/<label[^>]*><input type="radio"/g)).toHaveLength(3);
  });

  it("las consecuencias se leen antes de confirmar y el botón apunta a ellas", async () => {
    const html = await pintar(cita());
    expect(html).toContain('id="autorizar-consecuencias"');
    expect(html).toContain('aria-describedby="autorizar-consecuencias"');
    const t = texto(html);
    expect(t).toContain("La monitoría de Cálculo Diferencial del 7 de enero de 2030 a las 10:00 se cancela. Esto no se puede deshacer.");
    expect(t).toContain(`Se devuelven ${pesos(32_000)} a quien pagó y se le pide la llave por correo.`);
    expect(t).toContain("Quien agendó y el monitor reciben un correo. Ninguno dice el motivo ni la nota.");
    expect(t).toContain("El monitor no cobra esta sesión.");
  });

  it("antes del formulario dice que se compruebe que quien escribió usó el mismo correo o teléfono", async () => {
    const html = await pintar(cita());
    const frase = "Antes de autorizar, comprueba que quien te escribió usó el mismo correo o teléfono que ves aquí.";
    expect(texto(html.split("<details")[0])).toContain(frase);
    for (const c of [autorizada(), cita({ estado: "realizada" })]) expect(texto(await pintar(c))).not.toContain(frase);
  });

  it("las cinco razones por las que no se puede autorizar no tienen formulario, y dicen por qué", async () => {
    const casos: [string, CitaParaAutorizar, keyof typeof MENSAJES_DE_AUTORIZACION][] = [
      ["una grupal", cita({ grupal: true }), "no_individual"],
      ["una cancelada por quien agendó", cita({ estado: "cancelada", motivoCancelacion: "estudiante" }), "ya_cancelada"],
      ["una realizada", cita({ estado: "realizada" }), "no_cancelable"],
      ["una por pagar", cita({ estado: "pendiente_pago" }), "no_cancelable"],
      ["una cancelada porque el monitor no asistió", cita({ estado: "cancelada", motivoCancelacion: "monitor_no_asistio" }), "no_cancelable"],
    ];
    for (const [nombre, c, motivo] of casos) {
      const html = await pintar(c);
      expect(html, nombre).not.toMatch(/<form|<details|<textarea|<button|<input/);
      const t = texto(html);
      expect(t, nombre).toContain("No se puede autorizar esta cancelación");
      expect(t, nombre).toContain(MENSAJES_DE_AUTORIZACION[motivo]);
      // En estos modos no se cancela nada: ni lo que se devolvería ni el aviso de P-07.
      expect(t, nombre).not.toContain("Se devolverían");
    }
  });

  it("todavía hay plazo: la cita no se autoriza (con el instante exacto del límite sigue dentro del plazo)", async () => {
    vi.setSystemTime(new Date("2030-01-07T03:00:00.000Z"));
    const html = await pintar(cita());
    expect(html).not.toMatch(/<form|<details/);
    expect(texto(html)).toContain(MENSAJES_DE_AUTORIZACION.dentro_de_plazo);
    vi.setSystemTime(new Date("2030-01-07T03:00:00.001Z"));
    expect(await pintar(cita())).toMatch(/<form/);
  });

  it("la sesión ya empezó: no se autoriza, y en el instante exacto del inicio tampoco", async () => {
    vi.setSystemTime(new Date("2030-01-07T14:59:59.999Z"));
    expect(await pintar(cita())).toMatch(/<form/);
    for (const ahora of ["2030-01-07T15:00:00.000Z", "2030-01-07T16:00:00.000Z"]) {
      vi.setSystemTime(new Date(ahora));
      const html = await pintar(cita());
      expect(html, ahora).not.toMatch(/<form|<details/);
      expect(texto(html), ahora).toContain(MENSAJES_DE_AUTORIZACION.ya_empezo);
    }
  });

  it("en los modos que no cancelan nada, un pago en revisión no promete un reembolso", async () => {
    const revision = [{ ...PAGO, estado: "en_revision" as const }];
    expect(texto(await pintar(cita({ estado: "realizada", pagos: revision })))).not.toContain("sigue en revisión");
    expect(texto(await pintar(cita({ grupal: true, pagos: revision })))).not.toContain("sigue en revisión");
  });
});

describe("Autorizar una cancelación: una cancelación ya autorizada", () => {
  it("dice quién, cuándo, con qué motivo y con qué nota, y no trae formulario", async () => {
    const html = await pintar(autorizada());
    const t = texto(html);
    expect(t).toContain("Cancelación autorizada");
    expect(t).toContain("Autorización");
    expect(t).toContain("Autorizó Admin Uno");
    expect(t).toContain("Cuándo");
    expect(t).toContain("Motivo Fuerza mayor de quien agendó Nota");
    expect(t).toContain("Accidente de tránsito. La familia avisó por correo.");
    expect(html).toContain('<time dateTime="2030-01-07T08:30:00.000Z">');
    expect(html).not.toMatch(/<form|<details|<textarea|<button|<input/);
    // La nota conserva sus saltos de línea y se parte donde haga falta: lo hace el estilo, que se comprueba abajo.
    expect(html).toContain("Accidente de tránsito.\nLa familia avisó por correo.");
  });

  it("cada motivo, en su versión corta; sin nota dice «Sin nota»", async () => {
    for (const [categoria, dicho] of [
      ["fuerza_mayor", "Fuerza mayor de quien agendó"],
      ["falla_de_calibra", "Una falla de Calibra impidió cancelar a tiempo"],
      ["otro", "Otro"],
    ] as const) {
      const t = texto(await pintar(autorizada({ autorizacion: { ...AUTORIZACION, categoria, nota: null } })));
      expect(t, categoria).toContain(`Motivo ${dicho} Nota Sin nota`);
    }
  });

  it("la nota es texto libre: se escapa", async () => {
    const html = await pintar(autorizada({ autorizacion: { ...AUTORIZACION, nota: "<script>alert(1)</script> & <b>negrita</b>" } }));
    expect(html).not.toMatch(/<script>alert|<b>negrita/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;negrita&lt;/b&gt;");
  });

  it("una nota de 500 letras sin espacios y un correo largo no se salen de la pantalla: el estilo las parte donde haga falta", async () => {
    const largo = "a".repeat(500);
    const html = await pintar(autorizada({ autorizacion: { ...AUTORIZACION, nota: largo }, lead: { nombre: "Camila", correo: `${"b".repeat(70)}@uniandes.edu.co`, telefono: null } }));
    expect(html).toContain(largo);
    // El estilo propio de la página: la nota conserva los saltos de línea y parte la palabra; los valores y los contactos también.
    const css = readFileSync(join(__dirname, "cita.module.css"), "utf8");
    const regla = (selector: string) => css.match(new RegExp(`\\n\\.${selector} \\{([^}]*)\\}`))?.[1] ?? "";
    expect(regla("nota")).toMatch(/white-space:\s*pre-line/);
    expect(regla("nota")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(regla("valor")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(regla("detalle")).toMatch(/overflow-wrap:\s*anywhere/);
    // Y la nota lleva esa clase.
    expect(html).toMatch(/<dd class="[^"]*nota[^"]*">a{500}<\/dd>/);
  });

  it("el éxito se anuncia solo si la autorización es de esta sesión y la dirección trae ?autorizada=1", async () => {
    const con = await pintar(autorizada(), { autorizada: "1" });
    expect(con).toMatch(/<p role="status"[^>]*>Autorizaste la cancelación\. La monitoría quedó cancelada\. Creamos 1 reembolso y le pedimos la llave a quien pagó\. Quien agendó y el monitor reciben un correo\.<\/p>/);
    // Sin la dirección, o con la autorización de otro admin, nada se anuncia.
    expect(await pintar(autorizada())).not.toContain("Autorizaste");
    expect(await pintar(autorizada({ autorizacion: { ...AUTORIZACION, idAdmin: OTRO } }), { autorizada: "1" })).not.toContain("Autorizaste");
    // Ni en una cita que no se ha autorizado.
    expect(await pintar(cita(), { autorizada: "1" })).not.toContain("Autorizaste");
  });

  it("los pagos en revisión de una cita autorizada llevan su aviso, y se cuentan en el éxito", async () => {
    const c = autorizada({
      pagos: [
        { ...PAGO, reembolso: { id: REEMBOLSO, estado: "esperando_llave" } },
        { ...PAGO, id: "50505050-0000-4000-8000-000000000053", nombrePagador: "Luis Pérez", estado: "en_revision" },
      ],
    });
    const html = await pintar(c, { autorizada: "1" });
    expect(texto(html)).toContain("El pago en revisión recibirá su reembolso cuando se apruebe.");
    expect(texto(html)).toContain("Un pago sigue en revisión: si se aprueba, recibe su reembolso; si se rechaza, no hay reembolso.");
  });
});

describe("Autorizar una cancelación: lo que cambió mientras el admin miraba", () => {
  it("«ya cancelada» vuelve como alerta, una sola vez, y sin formulario", async () => {
    const html = await pintar(cita({ estado: "cancelada", motivoCancelacion: "estudiante" }), { error: "ya_cancelada" });
    expect(html).toMatch(/<p role="alert"[^>]*>Esta monitoría ya estaba cancelada/);
    expect(html.split(MENSAJES_DE_AUTORIZACION.ya_cancelada).length - 1).toBe(1);
    expect(html).not.toMatch(/<form|<details/);
    expect(texto(html)).toContain("No se puede autorizar esta cancelación");
  });

  it("si la autorizó otro admin, la alerta convive con el registro de quién la autorizó", async () => {
    const html = await pintar(autorizada({ autorizacion: { ...AUTORIZACION, idAdmin: OTRO, nombreAdmin: "Admin Dos" } }), { error: "ya_cancelada" });
    expect(html).toMatch(/<p role="alert"/);
    expect(texto(html)).toContain("Autorizó Admin Dos");
  });

  it("cada resultado que cambia el estado se dice como alerta con su mensaje", async () => {
    for (const resultado of ["no_cancelable", "dentro_de_plazo", "ya_empezo", "no_individual"] as const) {
      const html = await pintar(cita({ estado: "realizada" }), { error: resultado });
      expect(html, resultado).toContain(`<p role="alert"`);
      expect(texto(html), resultado).toContain(MENSAJES_DE_AUTORIZACION[resultado]);
    }
  });

  it("un ?error= que no es de esos resultados no anuncia nada", async () => {
    for (const error of ["sin_permiso", "no_existe", "x", ""]) {
      expect(await pintar(cita(), { error }), error).not.toMatch(/role="alert"/);
    }
  });
});

describe("Autorizar una cancelación: cuando no se puede cargar", () => {
  it("un id que no es un UUID da 404, sin leer nada de la base", async () => {
    await expect(pintar(cita(), {}, "123")).rejects.toThrow("notFound");
    expect(rutas.cargadas).toEqual([]);
  });

  it("una cita que no existe (o que la sesión no lee) da 404", async () => {
    await expect(pintar(null)).rejects.toThrow("notFound");
  });

  it("si la lectura falla, lo dice como alerta, sin formulario y con el camino de vuelta", async () => {
    datos.falla = new Error("La cita está incompleta.");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await pintar(cita());
    espia.mockRestore();
    expect(html).toMatch(/<p role="alert"[^>]*>Recarga la página; si sigue igual, avisa al equipo\.<\/p>/);
    expect(texto(html)).toContain("No pudimos cargar la cita");
    expect(html).not.toMatch(/<form|<details/);
    expect(html).toMatch(/<a [^>]*href="\/admin"[^>]*>Volver a mi bandeja<\/a>/);
  });
});

describe("Autorizar una cancelación: el estilo", () => {
  const css = readFileSync(join(__dirname, "cita.module.css"), "utf8");
  const regla = (selector: string) => css.match(new RegExp(`\\n\\.${selector} \\{([^}]*)\\}`))?.[1] ?? "";

  it("la etiqueta de cada motivo y el título de la confirmación miden 44 px o más", () => {
    expect(regla("opcion")).toMatch(/min-block-size:\s*var\(--toque-min\)/);
    expect(regla("resumen")).toMatch(/min-block-size:\s*var\(--toque-min\)/);
    // `display: list-item` conserva el triángulo que dice si la confirmación está abierta.
    expect(regla("resumen")).toMatch(/display:\s*list-item/);
  });

  it("ningún texto por debajo de 14 px y los colores salen de los tokens", () => {
    const tamanos = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(tamanos.length).toBeGreaterThan(0);
    for (const px of tamanos) expect(px).toBeGreaterThanOrEqual(14);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|gradient/);
  });
});

describe("Autorizar una cancelación: sin cifras de comisión (CLAUDE.md, D-59)", () => {
  it("en ningún modo hay comisión, bruto ni neto en el HTML", async () => {
    const pagos: PagoParaAutorizar[] = [
      PAGO,
      { ...PAGO, id: "50505050-0000-4000-8000-000000000053", nombrePagador: "Luis Pérez", monto: 15_000, estado: "en_revision" },
    ];
    const escenas: [string, CitaParaAutorizar, Record<string, string>][] = [
      ["autorizar", cita({ pagos }), {}],
      ["autorizar con error de cambio", cita({ pagos }), { error: "dentro_de_plazo" }],
      ["autorizada", autorizada({ pagos }), { autorizada: "1" }],
      ["grupal", cita({ grupal: true, pagos }), {}],
      ["ya cancelada", cita({ estado: "cancelada", motivoCancelacion: "estudiante", pagos }), {}],
      ["no cancelable", cita({ estado: "realizada", pagos }), {}],
    ];
    for (const [nombre, c, consulta] of escenas) {
      const html = await pintar(c, consulta);
      expect(html, nombre).not.toMatch(/comisi|bruto|neto/i);
    }
    vi.setSystemTime(new Date("2030-01-07T03:00:00.000Z"));
    expect(await pintar(cita({ pagos }))).not.toMatch(/comisi|bruto|neto/i);
    vi.setSystemTime(new Date("2030-01-07T16:00:00.000Z"));
    expect(await pintar(cita({ pagos }))).not.toMatch(/comisi|bruto|neto/i);
    datos.falla = new Error("se cayó");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await pintar(cita())).not.toMatch(/comisi|bruto|neto/i);
    espia.mockRestore();
  });
});
