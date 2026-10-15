import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { diaDelNegocio, formatearDia, formatearDiaConSemana, formatearHora } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { enviarCredenciales, expect, test as base, usarTurnstileDePrueba, type Cuenta } from "./utilidades";

// HU-050 (D-59): el monitor abre «Mis desembolsos» desde su panel y ve lo que Calibra le transfiere: lo que está por
// transferir, lo que ya se transfirió y lo que se anuló, con las tres cifras (el total de la monitoría, la comisión de
// Calibra y lo que se le transfiere). Es la única pantalla con cifras de comisión: el segundo y el tercer grupo de pruebas
// recorren las demás pantallas de cada rol con un desembolso de bruto 87.531 (que no es el monto de ningún pago) y
// comprueban que ninguna lo muestra. Corre contra el Supabase local (Auth y base) y el servidor de Next con la
// configuración de .env.local (`npm run db:env`). Cada prueba crea y borra su propio admin, sus monitores, la materia, la
// franja, el Lead, las monitorías con sus pagos y sus desembolsos, y se reconoce por montos y nombres al azar.
//
// Las monitorías se insertan ya realizadas (el trigger que crea el desembolso es solo de UPDATE) y su desembolso, como
// lo dejaría el trigger, con una foto (25.000 no, una rara: 31.313) distinta de los pagos de hoy, para que se vea que la
// pantalla lee lo de ahora. La monitoría del Lead se confirma y se realiza con UPDATE, como en e2e/resolver-reportes.spec.ts:
// así los triggers le anotan su token (el del enlace de la cita) y le crean su desembolso.
//
// Presupuesto de inicios de sesión (el Auth local deja 30 cada 5 minutos para toda la suite, con los dos proyectos en
// paralelo): el monitor dueño entra una vez y en esa sesión hace el recorrido, las reglas del producto y el barrido de sus
// otras pantallas; el admin entra una vez y recorre las suyas; el otro monitor, que no tiene desembolsos, entra una vez.
// El Lead abre el enlace de su cita y «sin sesión» es un contexto sin cookies: no gastan nada. Son 3 por proyecto.

const ESPERA = { timeout: 20_000 };
const HORA = 3_600_000;

/** El desembolso del barrido de la comisión: dos pagos aprobados y uno rechazado que Calibra asumió (HU-078 lo suma al bruto). */
const PAGOS_DEL_BARRIDO = [
  { monto: 40_000, estado: "aprobado" },
  { monto: 37_531, estado: "aprobado" },
  { monto: 10_000, estado: "rechazado", asumido: true },
] as const;
const BRUTO_DEL_BARRIDO = 87_531;

/** La foto con la que se crean los por transferir: no es la de hoy de ninguno, así que no debe aparecer en ninguna parte. */
const FOTO_RARA = { bruto: 31_313, comision: 3_131, neto: 28_182 };

const hoy = () => diaDelNegocio(new Date());

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El lunes de hace `semanas` semanas o el anterior: su sesión de las 10:00 a las 11:00 terminó hace más de 24 h. */
function lunesDeHace(semanas: number): string {
  let fecha = sumarDias(hoy(), -7 * semanas);
  while (new Date(`${fecha}T12:00:00Z`).getUTCDay() !== 1) fecha = sumarDias(fecha, -1);
  return fecha;
}

/** Texto con los espacios duros (los pesos y la hora los llevan) como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s+/g, " ").trim();

const pesos = (monto: number) => normalizar(formatearPesos(monto));
/** El monto como lo escribe la pantalla, sin el signo: `87.531`. */
const miles = (monto: number) => pesos(monto).replace(/^\$\s*/, "");

const formatoDeHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Bogota",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** El día y la hora (`HH:MM:SS`) de un instante en Bogotá, tal como los guarda la base, y los minutos desde la medianoche. */
function sesionEn(instante: Date) {
  const fecha = diaDelNegocio(instante);
  const hora = formatoDeHora.format(instante);
  return {
    fecha,
    dia: new Date(`${fecha}T12:00:00Z`).getUTCDay() || 7,
    hora,
    minutoDelDia: Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)),
  };
}

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Montos = { bruto: number; comision: number; neto: number };

type PagoSembrado = {
  monto: number;
  estado: "aprobado" | "en_revision" | "rechazado";
  /** Un rechazado cuyo caso P-24 ya cerró un admin como asumido: su monto cuenta en el bruto. */
  asumido?: boolean;
};

type OpcionesDeSiembra = {
  /** El lunes de hace `semanas` semanas (10:00 a 11:00). */
  semanas?: number;
  /** O una sesión de 30 minutos que empezó hace tantas horas, en su propia franja: su ventana de reporte sigue abierta. */
  haceHoras?: number;
  pagos: PagoSembrado[];
  desembolso?: {
    estado: "pendiente" | "desembolsado" | "anulado";
    /** Lo que guarda la fila: la foto de un pendiente, o lo transferido. Por defecto, lo de ahora de los pagos. */
    montos?: Montos;
    /** La llave copiada al desembolso; por defecto, la del monitor. */
    llave?: string;
    referencia?: string;
    /** Para un desembolsado: el día de la transferencia (a mediodía de Bogotá). */
    diaDeTransferencia?: string;
  };
  /** Un reporte de inasistencia en revisión, asignado al admin de la prueba. */
  reporte?: boolean;
  /** Se confirma y se realiza con UPDATE: así tiene el token de su cita y el trigger crea el desembolso. */
  conToken?: boolean;
};

type Sembrado = {
  /** El desembolso. */
  id: string;
  idMonitoria: string;
  /** El día de la sesión. */
  fecha: string;
  /** Lo de ahora de los pagos: aprobados y rechazados asumidos. */
  ahora: Montos;
  pagos: { id: string; monto: number; estado: string }[];
  idReporte: string | null;
  token: string | null;
  /** Desde cuándo se puede transferir (fin + 24 h): solo con `haceHoras`. */
  desde: Date | null;
  /** Lo que quedó escrito en el desembolso: la referencia (solo un transferido) y la llave copiada. */
  referencia: string | null;
  llaveDestino: string;
};

type Escenario = {
  /** El admin de la prueba: ejecuta los transferidos, revisa los pagos y es el único admin que entra. */
  admin: Cuenta;
  /** El monitor dueño de los desembolsos. */
  monitor: Cuenta;
  /** La llave del monitor (`monitor_privado`). */
  llave: string;
  materia: string;
  lead: { nombre: string; correo: string; telefono: string };
  pagador: { nombre: string; contacto: string };
  /** Otro monitor, sin desembolsos. */
  otroMonitor(): Promise<Cuenta>;
  sembrar(opciones: OpcionesDeSiembra): Promise<Sembrado>;
  /** El total, la comisión y el neto que calcula la base para ese bruto (N-2: solo con la llave secreta). */
  cifras(bruto: number): Promise<Montos>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const monitor = await cuentas.crearMonitor();
    const creados = {
      reportes: [] as string[],
      pagos: [] as string[],
      comprobantes: [] as string[],
      monitorias: [] as string[],
      franjas: [] as string[],
      leads: [] as string[],
      materias: [] as string[],
    };

    async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
      const { data, error } = await cliente.from(tabla).insert(fila).select("id").single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data.id as string;
    }

    async function actualizar(tabla: string, id: string, cambios: Record<string, unknown>): Promise<void> {
      const { error } = await cliente.from(tabla).update(cambios).eq("id", id);
      if (error) throw new Error(`actualizar ${tabla}: ${error.message}`);
    }

    async function calcular(funcion: "comision" | "monto_neto", bruto: number): Promise<number> {
      const { data, error } = await cliente.rpc(funcion, { p_monto_bruto: bruto });
      if (error) throw new Error(`${funcion}: ${error.message}`);
      return data as number;
    }

    const cifras = async (bruto: number): Promise<Montos> => ({ bruto, comision: await calcular("comision", bruto), neto: await calcular("monto_neto", bruto) });

    const { data: privado, error: errorLlave } = await cliente.from("monitor_privado").select("llave").eq("id_monitor", monitor.id).single();
    if (errorLlave) throw new Error(`leer la llave del monitor: ${errorLlave.message}`);
    const llave = (privado as { llave: string }).llave;

    const materia = `Materia e2e mis desembolsos ${randomUUID().slice(0, 6)}`;
    const idMateria = await insertar("materia", { nombre: materia, codigo: `E2E-${randomUUID().slice(0, 12)}` });
    creados.materias.push(idMateria);
    const { error: errorCertificado } = await cliente.from("certificado").insert({ id_monitor: monitor.id, id_materia: idMateria, id_admin: admin.id });
    if (errorCertificado) throw new Error(`insertar certificado: ${errorCertificado.message}`);
    const idFranjaDeLosLunes = await insertar("franja", { id_monitor: monitor.id, dia: 1, hora: "10:00", duracion_min: 60, presencial: true, precio: 25_000, lugar: "Salón e2e" });
    creados.franjas.push(idFranjaDeLosLunes);

    const lead = {
      nombre: `Lead e2e ${randomUUID().slice(0, 8)}`,
      correo: `lead-${randomUUID()}@calibra.test`,
      telefono: `31${randomInt(10_000_000, 99_999_999)}`,
    };
    const idLead = await insertar("lead", {
      nombre: lead.nombre,
      correo: lead.correo,
      numero_telefono: lead.telefono,
      acepta_tratamiento_datos: true,
      fecha_consentimiento: new Date().toISOString(),
    });
    creados.leads.push(idLead);
    const pagador = { nombre: `Pagador e2e ${randomUUID().slice(0, 8)}`, contacto: `pagador-${randomUUID()}@calibra.test` };

    /** Un pago de la monitoría; su comprobante tiene que estar revisado antes (HU-059). */
    async function crearPago(idMonitoria: string, pago: PagoSembrado): Promise<Sembrado["pagos"][number]> {
      const comprobante = `${randomUUID()}/${randomUUID()}.png`;
      const { error } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
      if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
      creados.comprobantes.push(comprobante);
      const ahora = new Date().toISOString();
      const id = await insertar("pago", {
        id_monitoria: idMonitoria,
        monto: pago.monto,
        nombre_pagador: pagador.nombre,
        contacto: pagador.contacto,
        id_admin: admin.id,
        comprobante,
        estado: pago.estado,
        fecha_revision: pago.estado === "en_revision" ? null : ahora,
        ...(pago.estado === "rechazado" ? { observaciones: "Se cobra por fuera (P-24)." } : {}),
        ...(pago.asumido
          ? { cierre_rechazo: "asumido", nota_cierre: "Lo asume Calibra.", id_admin_cierre: admin.id, fecha_cierre: ahora }
          : {}),
      });
      creados.pagos.push(id);
      return { id, monto: pago.monto, estado: pago.estado };
    }

    await entregar({
      admin,
      monitor,
      llave,
      materia,
      lead,
      pagador,
      otroMonitor: () => cuentas.crearMonitor(),
      cifras,
      async sembrar(opciones) {
        let fecha: string;
        let idFranja = idFranjaDeLosLunes;
        let fechaFinalizacion: string;
        let desde: Date | null = null;
        if (opciones.haceHoras !== undefined) {
          // Empezó hace unas horas, en su propia franja: el cierre automático y el plazo de la ventana de reporte siguen abiertos.
          const inicio = new Date(Math.floor((Date.now() - opciones.haceHoras * HORA) / 1_000) * 1_000);
          const sesion = sesionEn(inicio);
          const duracion = Math.min(30, 24 * 60 - sesion.minutoDelDia);
          idFranja = await insertar("franja", { id_monitor: monitor.id, dia: sesion.dia, hora: sesion.hora, duracion_min: duracion, presencial: true, precio: 25_000, lugar: "Salón e2e" });
          creados.franjas.push(idFranja);
          fecha = sesion.fecha;
          fechaFinalizacion = new Date().toISOString();
          desde = new Date(inicio.getTime() + duracion * 60_000 + 24 * HORA);
        } else {
          fecha = lunesDeHace(opciones.semanas ?? 2);
          fechaFinalizacion = `${fecha}T16:30:00+00:00`;
        }

        // valor_total (25.000, igual que el precio de la franja) no coincide con ningún bruto de la prueba.
        const base = { id_franja: idFranja, id_monitor: monitor.id, id_materia: idMateria, id_lead: idLead, fecha, valor_total: 25_000 };
        const idMonitoria = await insertar("monitoria", opciones.conToken ? { ...base, estado: "pendiente_pago" } : { ...base, estado: "realizada", fecha_finalizacion: fechaFinalizacion });
        creados.monitorias.push(idMonitoria);
        if (opciones.conToken) await actualizar("monitoria", idMonitoria, { estado: "confirmada" });

        const pagos = [];
        for (const pago of opciones.pagos) pagos.push(await crearPago(idMonitoria, pago));
        const bruto = opciones.pagos.filter((p) => p.estado === "aprobado" || p.asumido).reduce((suma, p) => suma + p.monto, 0);
        const ahora = await cifras(bruto);

        let id: string;
        let referencia: string | null = null;
        let llaveDestino = llave;
        if (opciones.conToken) {
          // El trigger de HU-028 crea el desembolso al realizarse, con los pagos de ese momento.
          await actualizar("monitoria", idMonitoria, { estado: "realizada", fecha_finalizacion: fechaFinalizacion });
          const { data, error } = await cliente.from("desembolso").select("id").eq("id_monitoria", idMonitoria).single();
          if (error) throw new Error(`leer el desembolso: ${error.message}`);
          id = data.id as string;
        } else {
          const d = opciones.desembolso ?? { estado: "pendiente" as const };
          const montos = d.montos ?? ahora;
          const transferido = d.estado === "desembolsado";
          llaveDestino = d.llave ?? llave;
          referencia = transferido ? (d.referencia ?? `REF-${randomUUID().slice(0, 8)}`) : null;
          id = await insertar("desembolso", {
            id_monitoria: idMonitoria,
            monto_bruto: montos.bruto,
            comision: montos.comision,
            monto_neto: montos.neto,
            llave_destino: llaveDestino,
            estado: d.estado,
            id_admin: transferido ? admin.id : null,
            fecha_desembolso: transferido ? `${d.diaDeTransferencia ?? sumarDias(hoy(), -1)}T17:00:00Z` : null,
            referencia_transferencia: referencia,
          });
        }

        let idReporte: string | null = null;
        if (opciones.reporte) {
          idReporte = await insertar("reporte_inasistencia", { id_monitoria: idMonitoria, id_admin: admin.id, estado: "en_revision" });
          creados.reportes.push(idReporte);
        }
        let token: string | null = null;
        if (opciones.conToken) {
          const { data, error } = await cliente.from("confirmacion_cita").select("token").eq("id_monitoria", idMonitoria).single();
          if (error) throw new Error(`leer el token de la cita: ${error.message}`);
          token = (data as { token: string }).token;
        }
        return { id, idMonitoria, fecha, ahora, pagos, idReporte, token, desde, referencia, llaveDestino };
      },
    });

    // Limpieza en el orden de las llaves foráneas, antes de que `cuentas` borre al admin y al monitor (desembolso, pago,
    // reporte y certificado le apuntan sin cascada). El aviso al monitor y el token de la cita se van con la monitoría.
    // Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (creados.monitorias.length) await borrar("reportes", cliente.from("reporte_inasistencia").delete().in("id_monitoria", creados.monitorias));
    if (creados.monitorias.length) await borrar("desembolsos", cliente.from("desembolso").delete().in("id_monitoria", creados.monitorias));
    if (creados.pagos.length) await borrar("pagos", cliente.from("pago").delete().in("id", creados.pagos));
    // Después de los pagos, que les apuntan.
    if (creados.comprobantes.length) await borrar("comprobantes revisados", cliente.from("comprobante_revisado").delete().in("ruta", creados.comprobantes));
    if (creados.monitorias.length) await borrar("monitorías", cliente.from("monitoria").delete().in("id", creados.monitorias));
    await borrar("franjas", cliente.from("franja").delete().in("id", creados.franjas));
    await borrar("certificados", cliente.from("certificado").delete().eq("id_admin", admin.id));
    await borrar("leads", cliente.from("lead").delete().in("id", creados.leads));
    await borrar("materias", cliente.from("materia").delete().in("id", creados.materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 240_000 });

// ---------------------------------------------------------------------------
// Ayudas de página
// ---------------------------------------------------------------------------
const RUTA = "/monitor/desembolsos";

/** Entra por /ingresar a la ruta pedida: sin sesión, la página protegida manda a iniciar sesión. */
async function entrar(page: Page, ruta: string, cuenta: Cuenta): Promise<void> {
  await page.goto(ruta);
  await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
  await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
  await expect(page).toHaveURL(ruta, ESPERA);
}

const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
const grupo = (page: Page, nombre: string) => page.getByRole("region", { name: nombre });
/** Las tarjetas a la vista de un grupo; las que van detrás de «Ver N más» están en su `details`. */
const tarjetasDe = (zona: Locator) => zona.locator(":scope > ul > li");

/** El texto que se ve de un localizador, con los espacios duros como espacios normales. */
const textoVisible = async (donde: { innerText(): Promise<string> }) => normalizar(await donde.innerText());

/** El HTML que ve el navegador, con los datos que Next incrusta para hidratar. */
const htmlDe = (page: Page) => page.content();

/**
 * Si un número suelto de la base (`87531`, sin puntos) aparece en el HTML o en lo que Next incrusta. Se pide que no haya
 * una letra, un dígito, un punto, una barra ni un guion pegados: así no cuenta el número de una ruta, de un archivo ni
 * de un identificador.
 */
const apareceComoNumero = (texto: string, numero: number) => new RegExp(`(?<![\\w./-])${numero}(?![\\w.-])`).test(texto);

/** Ni la palabra comisión ni bruto, ni el bruto ni la comisión del desembolso del barrido, en la pantalla (el neto, solo si se permite). */
async function expectSinComision(page: Page, d: Sembrado, donde: string, { conNeto = false }: { conNeto?: boolean } = {}): Promise<void> {
  const texto = await textoVisible(page.locator("body"));
  expect(texto, `${donde}: sin la palabra comisión ni bruto`).not.toMatch(/comisi[oó]n|bruto/i);
  const prohibidos = conNeto ? [d.ahora.bruto, d.ahora.comision] : [d.ahora.bruto, d.ahora.comision, d.ahora.neto];
  for (const monto of prohibidos) expect(texto, `${donde}: sin ${miles(monto)}`).not.toContain(miles(monto));
  const html = await htmlDe(page);
  for (const monto of prohibidos) {
    expect(html, `${donde}: el HTML no trae ${miles(monto)}`).not.toContain(miles(monto));
    expect(apareceComoNumero(html, monto), `${donde}: el HTML no trae ${monto} suelto`).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// El recorrido del monitor dueño: criterios 1, 3 a 11 y 13 a 16
// ---------------------------------------------------------------------------
test.describe("El monitor abre Mis desembolsos desde su panel y ve cada situación con sus tres cifras", () => {
  test("Por transferir (5), Transferidos (12, con 2 detrás de «Ver 2 desembolsos más») y Anulados (1); cada tarjeta con su frase, el orden total/comisión/neto y los rótulos con y sin «Estimado:»; la llave cambiada con su aviso; sin los datos de nadie más; las reglas del producto a 390 y 1280; y la comisión no asoma en las otras pantallas del monitor", async ({
    page,
    escenario,
  }) => {
    const { monitor, lead, pagador, admin } = escenario;
    const llaveAnterior = `llave-anterior-${randomUUID()}`;
    const referenciaLarga = randomBytes(50).toString("hex");
    const llaveLarga = randomBytes(50).toString("hex");

    // Por transferir, del día más viejo al más nuevo: la que retiene un reporte (y es el desembolso del barrido de la
    // comisión), el rechazado con su caso abierto, el que espera un pago en revisión, el listo (con la llave cambiada) y el
    // que está dentro de la ventana de reporte.
    const enEspera = await escenario.sembrar({ semanas: 5, pagos: [...PAGOS_DEL_BARRIDO], reporte: true, desembolso: { estado: "pendiente", montos: FOTO_RARA } });
    const rechazado = await escenario.sembrar({ semanas: 4, pagos: [{ monto: 25_000, estado: "rechazado" }], desembolso: { estado: "pendiente", montos: FOTO_RARA } });
    const enRevision = await escenario.sembrar({
      semanas: 3,
      pagos: [
        { monto: randomInt(50_000, 100_000), estado: "aprobado" },
        { monto: 11_111, estado: "en_revision" },
      ],
      desembolso: { estado: "pendiente", montos: FOTO_RARA },
    });
    const listo = await escenario.sembrar({
      semanas: 2,
      pagos: [{ monto: randomInt(50_000, 100_000), estado: "aprobado" }],
      desembolso: { estado: "pendiente", montos: FOTO_RARA, llave: llaveAnterior },
    });
    const enPlazo = await escenario.sembrar({
      haceHoras: 3,
      pagos: [{ monto: randomInt(50_000, 100_000), estado: "aprobado" }],
      desembolso: { estado: "pendiente", montos: FOTO_RARA },
    });
    expect(enEspera.ahora, "el desembolso del barrido de la comisión").toEqual({ bruto: BRUTO_DEL_BARRIDO, comision: 8_753, neto: 78_778 });

    // Transferidos: el día de la transferencia baja de ayer a hace 12 días, así que el orden es el de i y los dos últimos van detrás.
    const transferidos: (Sembrado & { i: number; dia: string })[] = [];
    for (let i = 1; i <= 12; i++) {
      const dia = sumarDias(hoy(), -i);
      // Una referencia y una llave de 100 caracteres sin espacios: la tarjeta tiene que partirlas en vez de salirse de la pantalla.
      const referencia = i === 4 ? referenciaLarga : `REF-E2E-${String(i).padStart(2, "0")}-${randomUUID().slice(0, 6)}`;
      const sembrado = await escenario.sembrar({
        semanas: 5 + i,
        pagos: [{ monto: 40_000 + i * 1_000, estado: "aprobado" }],
        desembolso: { estado: "desembolsado", diaDeTransferencia: dia, referencia, llave: i === 4 ? llaveLarga : undefined },
      });
      transferidos.push({ i, dia, ...sembrado });
    }
    const anulado = await escenario.sembrar({ semanas: 18, pagos: [{ monto: 41_000, estado: "aprobado" }], desembolso: { estado: "anulado", montos: FOTO_RARA } });

    await test.step("desde su panel toca «Mis desembolsos», junto a «Mi agenda»", async () => {
      await entrar(page, "/monitor", monitor);
      const enlaces = page.getByRole("link", { name: /^(Mi agenda|Mis desembolsos|Mis franjas)$/ });
      await expect(enlaces).toHaveText(["Mi agenda", "Mis desembolsos", "Mis franjas"]);
      await expectReglasDelProducto(page, "el panel con el enlace a Mis desembolsos");
      await page.getByRole("link", { name: "Mis desembolsos" }).click();
      await expect(page).toHaveURL(RUTA, ESPERA);
      await expect(page).toHaveTitle("Mis desembolsos · Calibra");
      await expect(titulo(page, "Mis desembolsos")).toBeVisible(ESPERA);
    });

    const porTransferir = grupo(page, "Por transferir (5)");
    const transferidosVisibles = grupo(page, "Transferidos (12)");
    const anulados = grupo(page, "Anulados (1)");

    await test.step("criterio 1: los tres grupos con su conteo, los más viejos por transferir primero", async () => {
      await expect(porTransferir).toBeVisible(ESPERA);
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Por transferir (5)", "Transferidos (12)", "Anulados (1)"]);
      await expect(tarjetasDe(porTransferir)).toHaveCount(5);
      const cabezas = tarjetasDe(porTransferir).locator(":scope > span:first-child");
      await expect(cabezas).toHaveText([
        `${formatearDiaConSemana(enEspera.fecha)}, 10:00 a 11:00`,
        `${formatearDiaConSemana(rechazado.fecha)}, 10:00 a 11:00`,
        `${formatearDiaConSemana(enRevision.fecha)}, 10:00 a 11:00`,
        `${formatearDiaConSemana(listo.fecha)}, 10:00 a 11:00`,
        new RegExp(`^${formatearDiaConSemana(enPlazo.fecha)}, \\d{2}:\\d{2} a \\d{2}:\\d{2}$`),
      ]);
      await expect(tarjetasDe(porTransferir).first().locator(":scope > span:nth-child(2)")).toHaveText(`${escenario.materia} · 60 min`);
      await expect(porTransferir.locator("time").first()).toHaveAttribute("datetime", enEspera.fecha);
      // Criterio 16: los renglones de cada tarjeta van uno debajo del otro y dentro de ella. Una tarjeta en fila los pondría
      // lado a lado, sin salirse de la pantalla pero con la columna de cada uno hecha una tira; ninguna otra medición lo ve.
      const desordenadas = await page.locator("section > ul > li").evaluateAll((tarjetas) =>
        tarjetas.flatMap((tarjeta, i) => {
          const caja = tarjeta.getBoundingClientRect();
          const renglones = [...tarjeta.children].map((hijo) => hijo.getBoundingClientRect());
          const apilados = renglones.every((r, k) => k === 0 || r.top >= renglones[k - 1].bottom - 1);
          const dentro = renglones.every((r) => r.left >= caja.left - 1 && r.right <= caja.right + 1);
          return apilados && dentro ? [] : [i];
        }),
      );
      expect(desordenadas, "las tarjetas con sus renglones lado a lado o fuera de la tarjeta").toEqual([]);
    });

    await test.step("criterios 3, 5, 6 y 9: la frase de cada situación por transferir y sus tres cifras estimadas, de ahora y no de la foto", async () => {
      const [tEspera, tRechazado, tRevision, tListo, tPlazo] = await tarjetasDe(porTransferir).all();
      const frase = (tarjeta: typeof tEspera) => tarjeta.locator(":scope > span").nth(2);

      // D-59 b: espera por un reporte en revisión, sin «reporte» ni «inasistencia»; las tres cifras (bruto 87.531, comisión 8.753, neto 78.778).
      await expect(frase(tEspera)).toHaveText("En espera: Calibra tiene que resolver algo de esta monitoría antes de transferir.");
      await expectCifras(tEspera, enEspera.ahora, "estimadas");
      await expect(tEspera).toContainText("Los montos se confirman cuando un admin hace la transferencia.");

      await expect(frase(tRechazado)).toHaveText("En espera: Calibra está resolviendo un pago rechazado de esta monitoría.");
      // Con bruto 0 la tarjeta no pinta tres ceros rotulados «Estimado» (supuesto 5).
      await expect(tRechazado.locator("dl")).toHaveCount(0);
      await expect(tRechazado).toContainText("Todavía no hay un monto para transferir.");
      await expect(tRechazado).not.toContainText("Los montos se confirman");

      await expect(frase(tRevision)).toHaveText("En espera: un pago de esta monitoría sigue en revisión.");
      await expectCifras(tRevision, enRevision.ahora, "estimadas");

      await expect(frase(tListo)).toHaveText("Listo para transferir. Un admin lo transfiere a tu llave.");
      await expectCifras(tListo, listo.ahora, "estimadas");

      // Criterio 3: dentro de la ventana de reporte, desde cuándo se puede transferir y el monto estimado.
      const hora = normalizar(formatearHora(enPlazo.desde!));
      await expect(frase(tPlazo)).toHaveText(`Se puede transferir después del ${formatearDia(diaDelNegocio(enPlazo.desde!))} a las ${hora}${hora.endsWith(".") ? "" : "."}`);
      await expectCifras(tPlazo, enPlazo.ahora, "estimadas");
      await expect(tPlazo).toContainText("Los montos se confirman cuando un admin hace la transferencia.");
    });

    await test.step("criterio 11: solo el listo, cuya llave copiada es otra, avisa a cuál se transferirá; el correo de Calibra, si está configurado, va con su enlace", async () => {
      const [tEspera, , , tListo] = await tarjetasDe(porTransferir).all();
      await expect(tListo).toContainText(
        `Cambiaste tu llave después de esta monitoría. Los pagos que ya estaban en camino siguen yendo a la anterior: ${llaveAnterior}.`,
      );
      await expect(tEspera).not.toContainText("Cambiaste tu llave");
      // `CORREO_DATOS_PERSONALES` solo llega a la app si .env.local la trae: se comprueba la relación entre la frase y el enlace.
      const enlaceDeCorreo = tListo.locator('a[href^="mailto:"]');
      if ((await tListo.innerText()).includes("Si esa llave ya no sirve, escribe a")) {
        await expect(enlaceDeCorreo).toHaveCount(1);
        const correo = (await enlaceDeCorreo.getAttribute("href"))!.replace("mailto:", "");
        await expect(enlaceDeCorreo).toHaveText(correo);
        await expect(tListo).toContainText(`Si esa llave ya no sirve, escribe a ${correo}.`);
      } else {
        await expect(enlaceDeCorreo).toHaveCount(0);
      }
    });

    await test.step("criterios 7 y 15: los 10 transferidos más recientes con su día, referencia, llave y montos finales, sin «Estimado:»; los otros 2 detrás de «Ver 2 desembolsos más»", async () => {
      await expect(tarjetasDe(transferidosVisibles)).toHaveCount(10);
      for (const t of transferidos.slice(0, 10)) {
        const tarjeta = tarjetasDe(transferidosVisibles).filter({ hasText: `Referencia: ${t.referencia}` });
        await expect(tarjeta).toHaveCount(1);
        await expect(tarjeta.locator(":scope > span")).toHaveText([
          `${formatearDiaConSemana(t.fecha)}, 10:00 a 11:00`,
          `${escenario.materia} · 60 min`,
          `Transferido el ${formatearDia(t.dia)}.`,
          `Referencia: ${t.referencia}`,
          `Llave: ${t.llaveDestino}`,
        ]);
        await expectCifras(tarjeta, t.ahora, "finales");
        await expect(tarjeta).not.toContainText("Los montos se confirman");
        await expect(tarjeta).not.toContainText("Cambiaste tu llave");
      }
      // El orden: el más reciente primero.
      await expect(transferidosVisibles.locator(":scope > ul > li > span:nth-child(3)")).toHaveText(
        transferidos.slice(0, 10).map((t) => `Transferido el ${formatearDia(t.dia)}.`),
      );

      const resto = transferidosVisibles.locator("details");
      await expect(resto.locator("summary")).toHaveText("Ver 2 desembolsos más");
      await expect(resto).not.toHaveAttribute("open", "");
      await expect(resto.locator("li")).toHaveCount(2);
      await expect(resto.locator("li").first()).toBeHidden();
      await expectReglasDelProducto(page, "Mis desembolsos con «Ver 2 desembolsos más» cerrado");

      await resto.locator("summary").click();
      await expect(resto).toHaveAttribute("open", "");
      await expect(resto.locator("li").first()).toBeVisible();
      await expect(resto.locator("li").last()).toBeVisible();
      await expect(resto.locator("li > span:nth-child(3)")).toHaveText(transferidos.slice(10).map((t) => `Transferido el ${formatearDia(t.dia)}.`));
      await expectReglasDelProducto(page, "Mis desembolsos con «Ver 2 desembolsos más» abierto y una referencia y una llave de 100 caracteres sin espacios");
    });

    await test.step("criterio 8: el anulado dice que la monitoría se canceló y no se transfiere, sin cifras ni llave", async () => {
      await expect(tarjetasDe(anulados)).toHaveCount(1);
      const tarjeta = tarjetasDe(anulados).first();
      await expect(tarjeta.locator(":scope > span")).toHaveText([
        `${formatearDiaConSemana(anulado.fecha)}, 10:00 a 11:00`,
        `${escenario.materia} · 60 min`,
        "Anulado: la monitoría se canceló porque se aceptó un reporte de inasistencia. No se transfiere.",
      ]);
      await expect(tarjeta.locator("dl")).toHaveCount(0);
      expect(await textoVisible(tarjeta)).not.toMatch(/\$|llave/i);
    });

    await test.step("criterio 16: la situación del transferido va en el verde de texto, la del anulado en el rojo de texto y las demás en el color normal; lo que se transfiere, en negrita y más grande que las otras cifras", async () => {
      const colorDeLaFrase = (tarjeta: Locator) =>
        tarjeta
          .locator(":scope > span")
          .nth(2)
          .evaluate((el) => getComputedStyle(el).color);
      const verde = await colorDeToken(page, "--success-text");
      const rojo = await colorDeToken(page, "--alert-text");
      const normal = await colorDeToken(page, "--text");
      expect(new Set([verde, rojo, normal]).size, "los tres colores de tokens.css son distintos").toBe(3);

      const [tEspera, , , tListo] = await tarjetasDe(porTransferir).all();
      const tTransferido = tarjetasDe(transferidosVisibles).first();
      expect(await colorDeLaFrase(tTransferido), "transferido: verde de texto").toBe(verde);
      expect(await colorDeLaFrase(tarjetasDe(anulados).first()), "anulado: rojo de texto").toBe(rojo);
      expect(await colorDeLaFrase(tListo), "listo: color normal").toBe(normal);
      expect(await colorDeLaFrase(tEspera), "en espera: color normal").toBe(normal);

      for (const [situacion, tarjeta] of [
        ["listo", tListo],
        ["transferido", tTransferido],
      ] as const) {
        const cifras = await tarjeta.locator("dl dd").evaluateAll((dds) =>
          dds.map((dd) => ({ peso: Number(getComputedStyle(dd).fontWeight), tamano: parseFloat(getComputedStyle(dd).fontSize) })),
        );
        expect(cifras, `${situacion}: las tres cifras`).toHaveLength(3);
        expect(cifras[2].peso, `${situacion}: lo que se transfiere va en negrita`).toBeGreaterThanOrEqual(700);
        for (const otra of cifras.slice(0, 2)) {
          expect(otra.peso, `${situacion}: el total y la comisión no van en negrita`).toBeLessThan(700);
          expect(cifras[2].tamano, `${situacion}: lo que se transfiere es más grande que el total y la comisión`).toBeGreaterThan(otra.tamano);
        }
      }
    });

    await test.step("criterio 12: ningún dato de nadie más (el Lead, quien pagó, el admin), ni la foto, y ni «reporte» ni «inasistencia» fuera del anulado", async () => {
      const html = await htmlDe(page);
      for (const ajeno of [lead.nombre, lead.correo, lead.telefono, pagador.nombre, pagador.contacto, admin.id, admin.nombre, admin.correo]) {
        expect(html, `el HTML no trae ${ajeno}`).not.toContain(ajeno);
      }
      // La foto (31.313, 3.131 y 28.182) no es la de hoy de ninguno; el 25.000 de la franja y de la monitoría tampoco.
      const texto = await textoVisible(page.locator("body"));
      for (const monto of [FOTO_RARA.bruto, FOTO_RARA.comision, FOTO_RARA.neto]) {
        expect(texto, `la pantalla no trae la foto ${miles(monto)}`).not.toContain(miles(monto));
        expect(html, `el HTML no trae la foto ${miles(monto)}`).not.toContain(miles(monto));
        expect(apareceComoNumero(html, monto), `el HTML no trae la foto ${monto} suelta`).toBe(false);
      }
      for (const tarjeta of await page.locator("section li").all()) {
        const contenido = await textoVisible(tarjeta);
        if (contenido.startsWith("Anulado") || contenido.includes("Anulado:")) continue;
        expect(contenido, "una tarjeta que no es la anulada no habla de reportes").not.toMatch(/reporte|inasistencia/i);
      }
      expect(await page.locator("section").locator("form, button, input, textarea, select").count(), "la pantalla no tiene formularios ni botones").toBe(0);
    });

    await test.step("la comisión no asoma en las otras pantallas del monitor: ni en su panel, ni en su agenda, ni en sus franjas", async () => {
      for (const ruta of ["/monitor", "/monitor/agenda", "/monitor/franjas"]) {
        await page.goto(ruta);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible(ESPERA);
        await expectSinComision(page, enEspera, `la pantalla ${ruta} del monitor dueño`);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 2 y el barrido de la comisión: los demás roles
// ---------------------------------------------------------------------------
test.describe("La comisión solo sale en Mis desembolsos: ninguna otra pantalla de ningún rol la muestra", () => {
  test("un admin recorre su panel, el desembolso, el reporte y los pagos sin ver el bruto ni la comisión (el neto sí, por diseño de HU-028); a Mis desembolsos lo manda a su panel; el Lead no ve comisión ni neto en su cita; sin sesión pide iniciar sesión", async ({
    page,
    browser,
    baseURL,
    escenario,
  }) => {
    const { admin } = escenario;
    // El del reporte: se confirmó y se realizó con UPDATE (token de la cita y desembolso del trigger), con un reporte en revisión.
    const conReporte = await escenario.sembrar({ semanas: 3, pagos: [...PAGOS_DEL_BARRIDO], reporte: true, conToken: true });
    // El gemelo sin reporte: el que un admin sí puede ejecutar, así que su página muestra el neto.
    const ejecutable = await escenario.sembrar({ semanas: 2, pagos: [...PAGOS_DEL_BARRIDO] });
    expect(conReporte.ahora).toEqual({ bruto: BRUTO_DEL_BARRIDO, comision: 8_753, neto: 78_778 });

    await test.step("el admin entra una vez y recorre su bandeja, el desembolso ejecutable, el que tiene un reporte, el reporte y los pagos", async () => {
      await page.goto("/admin");
      await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
      await enviarCredenciales(page, admin.correo, admin.contrasena);
      await expect(page).toHaveURL("/admin", ESPERA);
      await expect(page.getByRole("heading", { level: 1, name: `Hola, ${admin.nombre}` })).toBeVisible(ESPERA);
      await expectSinComision(page, ejecutable, "la bandeja del admin", { conNeto: true });

      await page.goto(`/admin/desembolsos/${ejecutable.id}`);
      await expect(titulo(page, "Ejecutar el desembolso")).toBeVisible(ESPERA);
      // El neto sí: es lo que el admin transfiere (HU-028).
      await expect(page.getByRole("heading", { level: 2, name: `Transferir ${pesos(ejecutable.ahora.neto)}` })).toBeVisible();
      await expectSinComision(page, ejecutable, "el desembolso ejecutable del admin", { conNeto: true });

      await page.goto(`/admin/desembolsos/${conReporte.id}`);
      await expect(titulo(page, "Ejecutar el desembolso")).toBeVisible(ESPERA);
      await expectSinComision(page, conReporte, "el desembolso con un reporte, para el admin", { conNeto: true });

      await page.goto(`/admin/reportes/${conReporte.idReporte}`);
      await expect(titulo(page, "Resolver el reporte")).toBeVisible(ESPERA);
      await expectSinComision(page, conReporte, "el reporte del admin", { conNeto: true });

      for (const pago of [conReporte.pagos[1], conReporte.pagos[2]]) {
        await page.goto(`/admin/pagos/${pago.id}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible(ESPERA);
        await expectSinComision(page, conReporte, `el pago de ${pesos(pago.monto)} (${pago.estado}) para el admin`, { conNeto: true });
      }
    });

    await test.step("un admin que abre Mis desembolsos va a su panel, y ese HTML tampoco trae las cifras", async () => {
      await page.goto(RUTA);
      await expect(page).toHaveURL("/admin", ESPERA);
      await expect(page.getByRole("heading", { level: 1, name: `Hola, ${admin.nombre}` })).toBeVisible(ESPERA);
      await expectSinComision(page, conReporte, "el panel del admin tras abrir Mis desembolsos", { conNeto: true });
    });

    await test.step("el Lead, con el enlace de su cita, no ve la comisión ni el neto", async () => {
      const contexto = await browser.newContext({ baseURL });
      try {
        await usarTurnstileDePrueba(contexto);
        const suPagina = await contexto.newPage();
        await suPagina.goto(`/cita?token=${conReporte.token}`);
        await expect(suPagina.getByRole("heading", { level: 1 })).toBeVisible(ESPERA);
        const texto = await textoVisible(suPagina.locator("body"));
        expect(texto).not.toMatch(/comisi[oó]n|bruto/i);
        for (const monto of [conReporte.ahora.comision, conReporte.ahora.neto]) expect(texto).not.toContain(miles(monto));
        const html = await htmlDe(suPagina);
        for (const monto of [conReporte.ahora.comision, conReporte.ahora.neto]) {
          expect(html, `el HTML de la cita no trae ${miles(monto)}`).not.toContain(miles(monto));
          expect(apareceComoNumero(html, monto), `el HTML de la cita no trae ${monto} suelto`).toBe(false);
        }
      } finally {
        await contexto.close();
      }
    });

    await test.step("criterio 2: sin sesión, Mis desembolsos manda a iniciar sesión y no trae nada", async () => {
      const contexto = await browser.newContext({ baseURL });
      try {
        await usarTurnstileDePrueba(contexto);
        const suPagina = await contexto.newPage();
        await suPagina.goto(RUTA);
        await expect(suPagina).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(RUTA)}`, ESPERA);
        await expect(suPagina.getByLabel("Correo")).toBeVisible(ESPERA);
        const html = await htmlDe(suPagina);
        for (const monto of [conReporte.ahora.bruto, conReporte.ahora.comision, conReporte.ahora.neto]) expect(html).not.toContain(miles(monto));
      } finally {
        await contexto.close();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Criterios 2 y 13: otro monitor y un monitor sin desembolsos
// ---------------------------------------------------------------------------
test.describe("Otro monitor, sin desembolsos, solo ve el mensaje de que todavía no tiene", () => {
  test("abre Mis desembolsos y lee «Todavía no tienes desembolsos…», sin grupos ni cifras del monitor dueño; la pantalla respeta las reglas del producto", async ({
    page,
    escenario,
  }) => {
    const del = await escenario.sembrar({ semanas: 2, pagos: [...PAGOS_DEL_BARRIDO], desembolso: { estado: "pendiente", montos: FOTO_RARA } });
    const otro = await escenario.otroMonitor();

    await entrar(page, RUTA, otro);
    await expect(titulo(page, "Mis desembolsos")).toBeVisible(ESPERA);
    await expect(page.getByRole("status").filter({ hasText: "Todavía no tienes desembolsos. Aparece uno cuando una monitoría tuya queda realizada." })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(page.locator("dl")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Volver a mi panel" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Por transferir");

    await expectSinComision(page, del, "Mis desembolsos de otro monitor");
    const html = await htmlDe(page);
    for (const monto of [FOTO_RARA.bruto, FOTO_RARA.comision, FOTO_RARA.neto]) expect(html, `sin la foto ${miles(monto)}`).not.toContain(miles(monto));
    expect(html).not.toContain(escenario.llave);
    await expectReglasDelProducto(page, "Mis desembolsos de un monitor sin desembolsos");

    await page.getByRole("link", { name: "Volver a mi panel" }).click();
    await expect(page).toHaveURL("/monitor", ESPERA);
  });
});

/**
 * Las tres cifras de una tarjeta, en el orden total, comisión y neto. Las de un por transferir son estimadas («Estimado:»
 * delante de cada rótulo) y las de un transferido son las finales; el valor de cada una es el de la base.
 */
async function expectCifras(tarjeta: Locator, montos: Montos, como: "estimadas" | "finales"): Promise<void> {
  const rotulos =
    como === "estimadas"
      ? ["Estimado: total de la monitoría", "Estimado: comisión de Calibra", "Estimado: te transferimos"]
      : ["Total de la monitoría", "Comisión de Calibra", "Te transferimos"];
  await expect(tarjeta.locator("dl dt")).toHaveText(rotulos);
  await expect(tarjeta.locator("dl dd")).toHaveText([pesos(montos.bruto), pesos(montos.comision), pesos(montos.neto)]);
  // El neto es la resta: lo que se transfiere es el total menos la comisión.
  expect(montos.neto).toBe(montos.bruto - montos.comision);
}

/** El color que el navegador calcula para una variable de tokens.css (`--text`, `--success-text`...), para compararlo con el de un elemento. */
async function colorDeToken(page: Page, variable: string): Promise<string> {
  return page.evaluate((nombre) => {
    const sonda = document.createElement("span");
    sonda.style.color = `var(${nombre})`;
    document.body.appendChild(sonda);
    const color = getComputedStyle(sonda).color;
    sonda.remove();
    return color;
  }, variable);
}

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (copia de e2e/resolver-reportes.spec.ts: el desborde se mide por
// elemento, porque html y body llevan `overflow-x: hidden` y `scrollWidth` del documento nunca falla; a los campos de
// formulario, que desplazan por dentro un texto más largo que su ancho, solo se les mide la caja)
// ---------------------------------------------------------------------------

/** Con el tamaño de la prueba y, si es más ancho, también a 390 px (el ancho de referencia del teléfono). */
async function expectReglasDelProducto(page: Page, donde: string): Promise<void> {
  await expectReglas(page, donde);
  const original = page.viewportSize();
  if (original && original.width > 390) {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectReglas(page, `${donde} (390 px)`);
    await page.setViewportSize(original);
  }
}

async function expectReglas(page: Page, donde: string): Promise<void> {
  const medidas = await medir(page);
  expect(medidas.sinScrollHorizontal, `${donde}: sin scroll horizontal`).toBe(true);
  expect(medidas.desbordados, `${donde}: ningún elemento se sale de la pantalla`).toEqual([]);
  expect(medidas.menorTexto, `${donde}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
  expect(medidas.degradados, `${donde}: sin degradados`).toBe(0);
  expect(medidas.tactilesChicos, `${donde}: áreas táctiles de 44 px o más`).toEqual([]);
  expect(medidas.controlesSinNombre, `${donde}: todo control tiene nombre`).toEqual([]);
}

/** Texto, áreas táctiles, degradados, nombres y desbordes. */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
      (el) => visible(el) && [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden]), textarea, summary")].filter(visible);
    // Los enlaces dentro de una frase son texto corrido: quedan fuera.
    const tocables = controles
      .filter((el) => !(el.tagName === "A" && el.closest("label, p")))
      .map((el) => (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.labels?.[0] ?? el) : el));
    // `html` y `body` llevan `overflow-x: hidden` (globals.css): el scroll horizontal nunca aparece aunque el contenido se
    // desborde, así que `scrollWidth` de la página no lo delata. Se mide cada elemento a la vista: que su caja no se salga de
    // la ventana y que su contenido (un texto largo sin espacios, por ejemplo) no se salga de su propia caja.
    const ancho = window.innerWidth;
    const desbordados = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => visible(el) && !el.closest("nextjs-portal"))
      .flatMap((el) => {
        const caja = el.getBoundingClientRect();
        const fueraDeLaVentana = caja.right > ancho + 1 || caja.left < -1;
        // Un campo de formulario con más texto que ancho (la llave del panel) se desplaza por dentro: su caja sí se mide.
        const esCampo = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
        const contenidoFueraDeSuCaja = !esCampo && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
        if (!fueraDeLaVentana && !contenidoFueraDeSuCaja) return [];
        return [
          {
            elemento: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
            texto: (el.textContent ?? "").trim().slice(0, 40),
            izquierda: Math.round(caja.left),
            derecha: Math.round(caja.right),
            anchoDeLaCaja: el.clientWidth,
            anchoDelContenido: el.scrollWidth,
          },
        ];
      });
    return {
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      desbordados,
      menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
      degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length,
      tactilesChicos: tocables
        .map((el) => ({ texto: (el.textContent || el.id || el.tagName).trim().slice(0, 40), alto: Math.round(el.getBoundingClientRect().height) }))
        .filter((el) => el.alto < 44),
      controlesSinNombre: controles
        .filter((el) => {
          const etiquetas = (el as HTMLInputElement).labels?.length ?? 0;
          return !(el.textContent?.trim() || el.getAttribute("aria-label") || etiquetas);
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    };
  });
}
