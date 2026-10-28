import { randomInt, randomUUID } from "node:crypto";
import type { Locator, Page, Route } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarCredenciales, esperarSesion, expect, test as base, type Cuenta } from "./utilidades";

// HU-055 (D-62): el admin crea, corrige y borra materias y evaluaciones desde /admin/materias. Corre contra el Supabase local
// (Auth y base) con cuentas y datos que crea y borra cada prueba, en móvil (390) y en escritorio (1280).
//
// La lista de materias es de todas las pruebas en paralelo: cada una crea las suyas con un nombre único y un código con letras
// que el banco real no usa (`ZZEE`) y cuatro números al azar, y de la lista solo mira lo propio. Los códigos de lo que se edita por
// pantalla tienen forma Uniandes; las materias de fixture con código `E2E-…` solo sirven para el caso de una materia que ya
// traía un código sin esa forma. Lo que la pantalla cambia o borra se comprueba también en la base, con la llave secreta.

const ESPERA = { timeout: 20_000 };
const RUTA = "/admin/materias";
const LETRAS = "ZZEE";
const SIN_FORMA = "El código debe tener cuatro letras, un guion y cuatro números, como MATE-1214.";
const FALLO_AL_GUARDAR = "No pudimos guardar los cambios. Intenta de nuevo.";

// ---------------------------------------------------------------------------
// Escenario: monitores, materias, evaluaciones y certificados que la prueba borra al terminar
// ---------------------------------------------------------------------------
type Materia = { id: string; nombre: string; codigo: string };

type Escenario = {
  /** Un texto único para reconocer lo propio entre lo de las demás pruebas. */
  marca(): string;
  /** Un código con forma Uniandes (`ZZEE-1234`) que ninguna materia tiene todavía. Lo que la pantalla cree con él se borra al final. */
  codigo(): Promise<string>;
  /** Un monitor con su contacto, sin certificados. */
  monitor(): Promise<Cuenta>;
  /** Una materia creada con la llave secreta (no pasa por el trigger de la app: sin marca de «editada en la app»). */
  materia(datos?: { nombre?: string; codigo?: string }): Promise<Materia>;
  evaluacion(idMateria: string, datos: { nombre: string; semana: number; activa?: boolean; acumulativo?: boolean }): Promise<string>;
  /** Un tema de la materia, cubierto por la evaluación. Con él la evaluación y la materia quedan con algo ligado. */
  tema(idMateria: string, idEvaluacion: string): Promise<void>;
  certificar(idMonitor: string, idMateria: string, idAdmin: string): Promise<void>;
  /** Una franja del lunes a las 10:00, para que el monitor tenga fechas libres. */
  franja(idMonitor: string): Promise<void>;
  /** Lo que la base guardó con ese código, sin distinguir mayúsculas; `null` si no hay. */
  materiaPorCodigo(codigo: string): Promise<(Materia & { carpeta: string | null; editada_en_app: boolean }) | null>;
  evaluacionEnLaBase(id: string): Promise<{ nombre: string; semana: number; activa: boolean; acumulativo: boolean; editada_en_app: boolean } | null>;
  existeLaMateria(id: string): Promise<boolean>;
  existeLaEvaluacion(id: string): Promise<boolean>;
  /** Cuántas materias se llaman así (para ver que no se creó otra). */
  cuantasSeLlaman(nombre: string): Promise<number>;
  certificadosDe(idMonitor: string): Promise<string[]>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar, testInfo) => {
    const cliente: SupabaseClient = cuentas.cliente;
    const monitores: string[] = [];
    const materias: string[] = [];
    const codigos = new Set<string>();

    const ok = <T>(resultado: { data: T; error: { message: string } | null }, contexto: string): NonNullable<T> => {
      if (resultado.error) throw new Error(`${contexto}: ${resultado.error.message}`);
      return resultado.data as NonNullable<T>;
    };

    const escenario: Escenario = {
      marca: () => randomUUID().slice(0, 8),
      async codigo() {
        // Móvil y escritorio corren a la vez: cada proyecto saca los suyos de la mitad del rango.
        const inicio = testInfo.project.name === "movil" ? 0 : 5000;
        for (;;) {
          const codigo = `${LETRAS}-${String(inicio + randomInt(0, 5000)).padStart(4, "0")}`;
          if (codigos.has(codigo)) continue;
          // Una corrida cortada pudo dejar la materia: se prueba con otro número.
          if (ok(await cliente.from("materia").select("id").ilike("codigo", codigo), "buscar el código").length > 0) continue;
          codigos.add(codigo);
          return codigo;
        }
      },
      async monitor() {
        const monitor = await cuentas.crearMonitor();
        monitores.push(monitor.id);
        return monitor;
      },
      async materia(datos = {}) {
        const nombre = datos.nombre ?? `Materia e2e ${escenario.marca()}`;
        const codigo = datos.codigo ?? (await escenario.codigo());
        const { id } = ok(await cliente.from("materia").insert({ nombre, codigo }).select("id").single(), "insertar materia");
        materias.push(id);
        return { id, nombre, codigo };
      },
      async evaluacion(idMateria, datos) {
        const { id } = ok(
          await cliente
            .from("evaluacion")
            .insert({ id_materia: idMateria, nombre: datos.nombre, semana: datos.semana, activa: datos.activa ?? false, acumulativo: datos.acumulativo ?? false })
            .select("id")
            .single(),
          "insertar evaluación",
        );
        return id;
      },
      async tema(idMateria, idEvaluacion) {
        const { id } = ok(
          await cliente.from("tema").insert({ id_materia: idMateria, clave: `tema-${escenario.marca()}`, nombre: "Tema de la prueba", orden: 1 }).select("id").single(),
          "insertar tema",
        );
        ok(await cliente.from("evaluacion_tema").insert({ id_evaluacion: idEvaluacion, id_tema: id, id_materia: idMateria }).select("id_tema"), "ligar el tema");
      },
      async certificar(idMonitor, idMateria, idAdmin) {
        ok(await cliente.from("certificado").insert({ id_monitor: idMonitor, id_materia: idMateria, id_admin: idAdmin }).select("id_materia"), "insertar certificado");
      },
      async franja(idMonitor) {
        ok(
          await cliente
            .from("franja")
            .insert({ id_monitor: idMonitor, dia: 1, hora: "10:00", duracion_min: 60, presencial: true, precio: 25_000, lugar: "Salón de prueba" })
            .select("id"),
          "insertar franja",
        );
      },
      async materiaPorCodigo(codigo) {
        const filas = ok(await cliente.from("materia").select("id, nombre, codigo, carpeta, editada_en_app").ilike("codigo", codigo), "leer la materia");
        return filas[0] ?? null;
      },
      async evaluacionEnLaBase(id) {
        const filas = ok(await cliente.from("evaluacion").select("nombre, semana, activa, acumulativo, editada_en_app").eq("id", id), "leer la evaluación");
        return filas[0] ?? null;
      },
      async existeLaMateria(id) {
        return ok(await cliente.from("materia").select("id").eq("id", id), "leer la materia").length === 1;
      },
      async existeLaEvaluacion(id) {
        return ok(await cliente.from("evaluacion").select("id").eq("id", id), "leer la evaluación").length === 1;
      },
      async cuantasSeLlaman(nombre) {
        return ok(await cliente.from("materia").select("id").eq("nombre", nombre), "contar las materias").length;
      },
      async certificadosDe(idMonitor) {
        return ok(await cliente.from("certificado").select("id_materia").eq("id_monitor", idMonitor), "leer certificados").map((c: { id_materia: string }) => c.id_materia);
      },
    };

    await entregar(escenario);

    // Limpieza, antes de que la fixture `cuentas` borre a los monitores y al admin: las franjas y los certificados cuelgan de
    // ellos, y las evaluaciones no caen en cascada con la materia. Se busca también lo que creó la pantalla, por su código.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    const delaPantalla = codigos.size ? ok(await cliente.from("materia").select("id").in("codigo", [...codigos]), "buscar lo que creó la pantalla") : [];
    const ids = [...new Set([...materias, ...delaPantalla.map((m: { id: string }) => m.id)])];
    if (monitores.length) await borrar("franjas", cliente.from("franja").delete().in("id_monitor", monitores));
    if (ids.length) {
      await borrar("certificados", cliente.from("certificado").delete().in("id_materia", ids));
      await borrar("evaluaciones", cliente.from("evaluacion").delete().in("id_materia", ids));
      await borrar("materias", cliente.from("materia").delete().in("id", ids));
    }
    if (monitores.length) await borrar("certificados de los monitores", cliente.from("certificado").delete().in("id_monitor", monitores));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 90_000 });

// ---------------------------------------------------------------------------
// Ayudantes de pantalla
// ---------------------------------------------------------------------------
/** Entra por /ingresar a la ruta pedida: sin sesión, la página protegida manda a iniciar sesión. */
async function entrar(page: Page, ruta: string, cuenta: Cuenta): Promise<void> {
  await page.goto(ruta);
  await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
  await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
  await expect(page).toHaveURL(ruta, ESPERA);
}

/** Abre una página y espera a que termine de hidratarse: los campos no dependen de React, pero el envío sí. */
async function abrir(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta);
  await page.waitForLoadState("networkidle");
}

const estado = (donde: Page | Locator, texto: string | RegExp) => donde.getByRole("status").filter({ hasText: texto });
const alerta = (donde: Page | Locator, texto: string | RegExp) => donde.getByRole("alert").filter({ hasText: texto });
const titulo1 = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre, exact: true });

/** El formulario «Nueva materia» de la lista. */
const nueva = (page: Page) => ({
  nombre: page.getByLabel("Nombre", { exact: true }),
  codigo: page.getByLabel("Código", { exact: true }),
  crear: page.getByRole("button", { name: "Crear materia", exact: true }),
});

/** Los campos de «Datos de la materia» en la página de la materia (hay otros «Nombre» en las evaluaciones: se piden por id). */
const datos = (page: Page) => ({
  nombre: page.locator("#materia-nombre"),
  codigo: page.locator("#materia-codigo"),
  guardar: page.getByRole("button", { name: "Guardar cambios", exact: true }),
});

/** La tarjeta de una evaluación, por el id de su título. */
const tarjeta = (page: Page, idEvaluacion: string) => page.getByRole("listitem").filter({ has: page.locator(`#evaluacion-${idEvaluacion}`) });

const camposDeLaEvaluacion = (carta: Locator) => ({
  nombre: carta.getByLabel("Nombre", { exact: true }),
  semana: carta.getByLabel("Semana", { exact: true }),
  guardar: carta.getByRole("button", { name: "Guardar evaluación", exact: true }),
});

const listaDeMaterias = (page: Page, nombre: string) => page.getByRole("listitem").filter({ has: page.getByRole("link", { name: nombre, exact: true }) });

/** Crea una materia con el formulario de la lista y espera su aviso. Deja la página en la lista. */
async function crearPorLaPantalla(page: Page, nombre: string, codigo: string): Promise<void> {
  const campos = nueva(page);
  await campos.nombre.fill(nombre);
  await campos.codigo.fill(codigo);
  await campos.crear.click();
  await expect(estado(page, "Creamos la materia")).toHaveText(`Creamos la materia ${nombre.trim()} (${codigo.trim().toUpperCase()}).`, ESPERA);
}

const idDeLaUrl = (page: Page): string => {
  const id = new URL(page.url()).pathname.split("/").pop();
  if (!id) throw new Error(`La URL no trae un id: ${page.url()}`);
  return id;
};

// ---------------------------------------------------------------------------
// Criterios 1 a 3: la lista, crear y validar
// ---------------------------------------------------------------------------
test.describe("Criterios 1 a 3 · la lista y crear una materia", () => {
  test("el admin llega desde su bandeja, crea una materia y la ve en la lista, en certificados y en la solicitud de monitor; en /monitores todavía no", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    // Sin ningún monitor, /admin/certificados no muestra el formulario ni el selector de materias.
    await escenario.monitor();
    const nombre = `Materia nueva ${escenario.marca()}`;
    const codigo = await escenario.codigo();

    await entrar(page, "/admin", admin);
    await page.getByRole("link", { name: "Materias y evaluaciones" }).click();
    await expect(page).toHaveURL(RUTA, ESPERA);
    await expect(page).toHaveTitle("Materias y evaluaciones · Calibra");
    await expect(titulo1(page, "Materias y evaluaciones")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Nueva materia" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^Materias \(\d+\)$/ })).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Escribe el código en minúsculas y con espacios: se guarda en mayúsculas.
    await crearPorLaPantalla(page, `  ${nombre}  `, ` ${codigo.toLowerCase()} `);
    await expect(nueva(page).nombre).toHaveValue("");
    await expect(nueva(page).codigo).toHaveValue("");
    await expect(listaDeMaterias(page, nombre)).toContainText(`${codigo} · Sin evaluaciones`, ESPERA);

    // La base la guardó normalizada, marcada como editada en la app y sin carpeta.
    const guardada = await escenario.materiaPorCodigo(codigo);
    expect(guardada).toMatchObject({ nombre, codigo, carpeta: null, editada_en_app: true });

    // Al recargar sigue en la lista.
    await page.reload();
    await expect(listaDeMaterias(page, nombre)).toContainText(`${codigo} · Sin evaluaciones`, ESPERA);

    // Está en el selector de /admin/certificados...
    await abrir(page, "/admin/certificados");
    await expect(page.getByLabel("Materia", { exact: true }).locator("option", { hasText: `${nombre} (${codigo})` })).toHaveCount(1, ESPERA);

    // ...y en el formulario de /quiero-ser-monitor.
    await page.goto("/quiero-ser-monitor");
    await expect(page.getByRole("checkbox", { name: nombre, exact: true })).toBeVisible(ESPERA);

    // No en el selector de /monitores hasta que un monitor se certifique en ella.
    await page.goto("/monitores");
    await expect(page.getByRole("heading", { level: 1, name: "Elige tu materia" })).toBeVisible(ESPERA);
    await expect(page.getByRole("link", { name: nombre })).toHaveCount(0);
    await page.goto(`/monitores?materia=${codigo}`);
    await expect(page.getByRole("heading", { level: 1, name: `Monitores de ${nombre}` })).toBeVisible(ESPERA);
    await expect(estado(page, "Todavía no hay monitores certificados en esta materia")).toBeVisible();
  });

  test("cada error sale junto a su campo con su texto, los campos conservan lo escrito y un código repetido dice de quién es", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    const nombre = `Materia con error ${escenario.marca()}`;
    const codigo = await escenario.codigo();
    await entrar(page, RUTA, admin);
    await page.waitForLoadState("networkidle");
    const campos = nueva(page);

    // Sin nada: los dos errores a la vez.
    await campos.crear.click();
    await expect(alerta(page, "Escribe el nombre de la materia.")).toBeVisible(ESPERA);
    await expect(alerta(page, SIN_FORMA)).toBeVisible();
    await expect(campos.nombre).toHaveAttribute("aria-invalid", "true");
    await expect(campos.codigo).toHaveAttribute("aria-invalid", "true");

    // Un código sin forma: el nombre y el código escritos se conservan.
    await campos.nombre.fill(nombre);
    await campos.codigo.fill("MATE-12");
    await campos.crear.click();
    await expect(alerta(page, SIN_FORMA)).toBeVisible(ESPERA);
    await expect(alerta(page, "Escribe el nombre de la materia.")).toHaveCount(0);
    await expect(campos.nombre).toHaveValue(nombre);
    await expect(campos.codigo).toHaveValue("MATE-12");

    // Un nombre de 121 caracteres.
    await campos.nombre.fill("n".repeat(121));
    await campos.codigo.fill(codigo);
    await campos.crear.click();
    await expect(alerta(page, "El nombre puede tener hasta 120 caracteres.")).toBeVisible(ESPERA);
    await expect(campos.codigo).toHaveValue(codigo);
    expect(await escenario.materiaPorCodigo(codigo)).toBeNull();

    // Nada de lo anterior guardó algo; ahora sí se crea.
    await campos.nombre.fill(nombre);
    await campos.crear.click();
    await expect(estado(page, "Creamos la materia")).toHaveText(`Creamos la materia ${nombre} (${codigo}).`, ESPERA);

    // El mismo código en minúsculas y con espacios: «Ya existe una materia con ese código: {nombre}.»
    await campos.nombre.fill(`Otra ${nombre}`);
    await campos.codigo.fill(`  ${codigo.toLowerCase()}  `);
    await campos.crear.click();
    await expect(alerta(page, `Ya existe una materia con ese código: ${nombre}.`)).toBeVisible(ESPERA);
    await expect(estado(page, "Creamos la materia")).toHaveCount(0);
    await expect(campos.nombre).toHaveValue(`Otra ${nombre}`);
    await expect(campos.codigo).toHaveValue(`  ${codigo.toLowerCase()}  `);
    expect(await escenario.cuantasSeLlaman(`Otra ${nombre}`)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Criterio 5: corregir el nombre y el código de una materia
// ---------------------------------------------------------------------------
test.describe("Criterio 5 · corregir una materia", () => {
  test("el aviso del código sale antes de guardar; lo nuevo lo encuentran la lista, certificados y /monitores, y el certificado sigue ligado", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    const monitor = await escenario.monitor();
    const materia = await escenario.materia();
    await escenario.certificar(monitor.id, materia.id, admin.id);
    await escenario.franja(monitor.id);
    const nuevoNombre = `Materia corregida ${escenario.marca()}`;
    const nuevoCodigo = await escenario.codigo();

    await entrar(page, RUTA, admin);
    await page.waitForLoadState("networkidle");
    await listaDeMaterias(page, materia.nombre).getByRole("link", { name: materia.nombre, exact: true }).click();
    await expect(page).toHaveURL(`${RUTA}/${materia.id}`, ESPERA);
    await expect(page).toHaveTitle("Materia · Calibra");
    await expect(titulo1(page, materia.nombre)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Datos de la materia" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    const campos = datos(page);
    await expect(campos.nombre).toHaveValue(materia.nombre);
    await expect(campos.codigo).toHaveValue(materia.codigo);
    await expect(estado(page, "Los enlaces con el código anterior")).toHaveCount(0);

    // El aviso aparece en cuanto el código difiere del guardado, antes de guardar; si vuelve a ser el mismo, se va.
    await campos.codigo.fill(nuevoCodigo.toLowerCase());
    await expect(estado(page, "Los enlaces con el código anterior dejarán de encontrar esta materia.")).toBeVisible();
    await campos.codigo.fill(materia.codigo);
    await expect(estado(page, "Los enlaces con el código anterior")).toHaveCount(0);
    await campos.codigo.fill(nuevoCodigo.toLowerCase());
    await campos.nombre.fill(nuevoNombre);
    await expect(estado(page, "Los enlaces con el código anterior dejarán de encontrar esta materia.")).toBeVisible();
    await campos.guardar.click();

    await expect(estado(page, "Cambios guardados.")).toBeVisible(ESPERA);
    await expect(titulo1(page, nuevoNombre)).toBeVisible(ESPERA);
    await expect(campos.codigo).toHaveValue(nuevoCodigo);
    expect(await escenario.materiaPorCodigo(nuevoCodigo)).toMatchObject({ id: materia.id, nombre: nuevoNombre, codigo: nuevoCodigo, editada_en_app: true });
    expect(await escenario.materiaPorCodigo(materia.codigo)).toBeNull();

    // La lista.
    await abrir(page, RUTA);
    await expect(listaDeMaterias(page, nuevoNombre)).toContainText(nuevoCodigo, ESPERA);
    await expect(page.getByRole("link", { name: materia.nombre, exact: true })).toHaveCount(0);

    // El certificado sigue ligado a la misma materia, con su nombre y su código nuevos.
    expect(await escenario.certificadosDe(monitor.id)).toEqual([materia.id]);
    await abrir(page, "/admin/certificados");
    const emitidos = page.getByRole("region", { name: /^Certificados emitidos \(\d+\)$/ });
    await expect(emitidos.getByRole("listitem").filter({ hasText: monitor.nombre })).toContainText(`${nuevoNombre} (${nuevoCodigo})`, ESPERA);

    // /monitores la encuentra por el código nuevo, con el monitor y su fecha; el código viejo ya no.
    await page.goto(`/monitores?materia=${nuevoCodigo}`);
    await expect(page.getByRole("heading", { level: 1, name: `Monitores de ${nuevoNombre}` })).toBeVisible(ESPERA);
    await expect(page.getByRole("heading", { level: 2, name: monitor.nombre })).toBeVisible();
    await page.goto(`/monitores?materia=${materia.codigo}`);
    await expect(alerta(page, "No encontramos esa materia. Elige una de la lista.")).toBeVisible(ESPERA);
  });

  test("un código repetido al editar dice de quién es y no cambia nada; una materia con código sin forma deja corregir el nombre sin tocarlo", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    const dueña = await escenario.materia({ nombre: `Dueña del código ${escenario.marca()}` });
    const materia = await escenario.materia();
    // Una materia de confianza con un código que no tiene forma Uniandes (los fixtures E2E-… y los datos históricos).
    const historica = await escenario.materia({ codigo: `E2E-${randomUUID().slice(0, 12)}` });
    await entrar(page, `${RUTA}/${materia.id}`, admin);
    await page.waitForLoadState("networkidle");
    const campos = datos(page);

    await campos.codigo.fill(`  ${dueña.codigo.toLowerCase()} `);
    await campos.guardar.click();
    await expect(alerta(page, `Ya existe una materia con ese código: ${dueña.nombre}.`)).toBeVisible(ESPERA);
    await expect(estado(page, "Cambios guardados.")).toHaveCount(0);
    expect((await escenario.materiaPorCodigo(materia.codigo))?.id).toBe(materia.id);

    // Guardar el nombre sin cambiar el código no choca con su propio código.
    await campos.codigo.fill(materia.codigo);
    await campos.nombre.fill(`${materia.nombre} corregida`);
    await campos.guardar.click();
    await expect(estado(page, "Cambios guardados.")).toBeVisible(ESPERA);

    // La materia histórica: el nombre se corrige y el código queda tal cual; un código nuevo sin forma se rechaza.
    await abrir(page, `${RUTA}/${historica.id}`);
    await datos(page).nombre.fill("Histórica corregida");
    await datos(page).guardar.click();
    await expect(estado(page, "Cambios guardados.")).toBeVisible(ESPERA);
    expect(await escenario.materiaPorCodigo(historica.codigo)).toMatchObject({ id: historica.id, nombre: "Histórica corregida", editada_en_app: true });

    await datos(page).codigo.fill("sin-forma");
    await datos(page).guardar.click();
    await expect(alerta(page, SIN_FORMA)).toBeVisible(ESPERA);
    expect((await escenario.materiaPorCodigo(historica.codigo))?.id).toBe(historica.id);
  });
});

// ---------------------------------------------------------------------------
// Criterios 6 y 7: la página de la materia y corregir una evaluación
// ---------------------------------------------------------------------------
test.describe("Criterios 6 y 7 · las evaluaciones de la materia", () => {
  test("se ven por semana con su estado escrito; la activa con un tema no ofrece borrar y la otra se corrige: semana 0 y nombre repetido se rechazan", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    const materia = await escenario.materia();
    const marca = escenario.marca();
    const activa = await escenario.evaluacion(materia.id, { nombre: `Parcial activo ${marca}`, semana: 6, activa: true, acumulativo: true });
    const inactiva = await escenario.evaluacion(materia.id, { nombre: `Parcial inactivo ${marca}`, semana: 3 });
    await escenario.tema(materia.id, activa);

    await entrar(page, `${RUTA}/${materia.id}`, admin);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { level: 2, name: "Evaluaciones (2)" })).toBeVisible();
    // Por semana: la 3 antes que la 6.
    const orden = await page.locator("li h3").allTextContents();
    expect(orden).toEqual([`Parcial inactivo ${marca}`, `Parcial activo ${marca}`]);
    await expect(tarjeta(page, inactiva)).toContainText("Semana 3 · No acumulativa · Inactiva");
    await expect(tarjeta(page, activa)).toContainText("Semana 6 · Acumulativa · Activa");

    // La activa tiene un tema: no hay botón y la página dice por qué. La otra no tiene nada ligado.
    await expect(tarjeta(page, activa).getByRole("button", { name: "Borrar", exact: true })).toHaveCount(0);
    await expect(tarjeta(page, activa)).toContainText("No se puede borrar: tiene temas.");
    await expect(tarjeta(page, inactiva).getByRole("button", { name: "Borrar", exact: true })).toBeVisible();
    await expect(tarjeta(page, inactiva)).not.toContainText("No se puede borrar");

    const campos = camposDeLaEvaluacion(tarjeta(page, inactiva));
    // Semana 0: el error sale junto al campo y el campo conserva lo escrito.
    await campos.semana.fill("0");
    await campos.guardar.click();
    await expect(alerta(tarjeta(page, inactiva), "La semana es un número entero mayor que 0.")).toBeVisible(ESPERA);
    await expect(campos.semana).toHaveValue("0");
    await expect(campos.semana).toHaveAttribute("aria-invalid", "true");
    // El nombre de la otra evaluación de la misma materia, con otras mayúsculas.
    await campos.semana.fill("4");
    await campos.nombre.fill(`  ${`Parcial activo ${marca}`.toUpperCase()} `);
    await campos.guardar.click();
    await expect(alerta(tarjeta(page, inactiva), "Ya hay una evaluación con ese nombre en esta materia.")).toBeVisible(ESPERA);
    expect(await escenario.evaluacionEnLaBase(inactiva)).toMatchObject({ nombre: `Parcial inactivo ${marca}`, semana: 3, editada_en_app: false });

    // Guardar el mismo nombre que ya tiene no cuenta como repetido.
    await campos.nombre.fill(`Parcial inactivo ${marca}`);
    await campos.semana.fill("4");
    await campos.guardar.click();
    await expect(estado(tarjeta(page, inactiva), "Cambios guardados.")).toBeVisible(ESPERA);

    // Un nombre y una semana nuevos: se ve en la página y la base solo cambió esos dos datos.
    const nuevoNombre = `Parcial corregido ${marca}`;
    await campos.nombre.fill(nuevoNombre);
    await campos.semana.fill(" 5 ");
    await campos.guardar.click();
    await expect(estado(tarjeta(page, inactiva), "Cambios guardados.")).toBeVisible(ESPERA);
    await expect(page.locator(`#evaluacion-${inactiva}`)).toHaveText(nuevoNombre, ESPERA);
    await expect(tarjeta(page, inactiva)).toContainText("Semana 5 · No acumulativa · Inactiva", ESPERA);
    expect(await escenario.evaluacionEnLaBase(inactiva)).toEqual({ nombre: nuevoNombre, semana: 5, activa: false, acumulativo: false, editada_en_app: true });
    expect(await escenario.evaluacionEnLaBase(activa)).toMatchObject({ activa: true, acumulativo: true, editada_en_app: false });
  });

  test("dos evaluaciones con el mismo nombre (el banco no lo impide): corregir solo la semana de una se guarda; cambiar su nombre al de otra distinta, no", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    const materia = await escenario.materia();
    const marca = escenario.marca();
    const nombre = `Parcial repetido ${marca}`;
    const primera = await escenario.evaluacion(materia.id, { nombre, semana: 5 });
    const segunda = await escenario.evaluacion(materia.id, { nombre, semana: 9 });
    const otra = await escenario.evaluacion(materia.id, { nombre: `Parcial otro ${marca}`, semana: 12 });

    await entrar(page, `${RUTA}/${materia.id}`, admin);
    await page.waitForLoadState("networkidle");

    // Solo la semana: el nombre es el mismo que ya tenía (y que tiene su hermana), así que no cuenta como repetido.
    const campos = camposDeLaEvaluacion(tarjeta(page, segunda));
    await campos.semana.fill("10");
    await campos.guardar.click();
    await expect(estado(tarjeta(page, segunda), "Cambios guardados.")).toBeVisible(ESPERA);
    await expect(alerta(tarjeta(page, segunda), "Ya hay una evaluación con ese nombre en esta materia.")).toHaveCount(0);
    expect(await escenario.evaluacionEnLaBase(segunda)).toMatchObject({ nombre, semana: 10, editada_en_app: true });
    expect(await escenario.evaluacionEnLaBase(primera)).toMatchObject({ nombre, semana: 5, editada_en_app: false });

    // Un nombre que sí cambia al de otra evaluación distinta se rechaza, también cuando el actual era un homónimo.
    await campos.nombre.fill(`Parcial otro ${marca}`);
    await campos.guardar.click();
    await expect(alerta(tarjeta(page, segunda), "Ya hay una evaluación con ese nombre en esta materia.")).toBeVisible(ESPERA);
    expect(await escenario.evaluacionEnLaBase(segunda)).toMatchObject({ nombre, semana: 10 });
    expect(await escenario.evaluacionEnLaBase(otra)).toMatchObject({ nombre: `Parcial otro ${marca}`, semana: 12, editada_en_app: false });
  });

  test("una materia sin evaluaciones lo dice y deja crear nada más que a través del banco", async ({ page, cuentas, escenario }) => {
    const admin = await cuentas.crearAdmin();
    const materia = await escenario.materia();
    await entrar(page, `${RUTA}/${materia.id}`, admin);

    await expect(page.getByRole("heading", { level: 2, name: "Evaluaciones (0)" })).toBeVisible();
    await expect(page.getByText("Esta materia no tiene evaluaciones. Las trae el banco (carpeta contenido/).")).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar evaluación" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Volver a las materias" })).toHaveAttribute("href", RUTA);
    await expect(page.getByRole("link", { name: "Volver a mi bandeja" })).toHaveAttribute("href", "/admin");
  });
});

// ---------------------------------------------------------------------------
// Criterios 12 a 16: borrar
// ---------------------------------------------------------------------------
test.describe("Criterios 12 a 16 · borrar una materia o una evaluación", () => {
  test("la materia recién creada: «Cancelar» no hace nada y devuelve el foco; «Sí, borrar» la quita de la lista, de certificados y de la solicitud", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    await escenario.monitor();
    const nombre = `Materia por borrar ${escenario.marca()}`;
    const codigo = await escenario.codigo();
    await entrar(page, RUTA, admin);
    await page.waitForLoadState("networkidle");
    await crearPorLaPantalla(page, nombre, codigo);
    await listaDeMaterias(page, nombre).getByRole("link", { name: nombre, exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/materias\/[0-9a-f-]{36}$/, ESPERA);
    const id = idDeLaUrl(page);
    await page.waitForLoadState("networkidle");

    // Sin nada ligado: el botón está y no dice motivo alguno.
    const abrirElPaso = page.getByRole("button", { name: "Borrar materia", exact: true });
    const pregunta = `¿Borrar la materia ${nombre} (${codigo})? No se puede deshacer.`;
    await expect(abrirElPaso).toBeVisible();
    await expect(page.getByText("No se puede borrar:")).toHaveCount(0);

    await abrirElPaso.click();
    const paso = page.getByRole("group", { name: pregunta });
    await expect(paso).toBeVisible();
    await expect(paso.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
    await expect(paso.getByRole("button", { name: "Sí, borrar", exact: true })).toBeVisible();

    // «Cancelar»: no pasa nada y el foco vuelve al botón que abrió el paso.
    await paso.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(paso).toHaveCount(0);
    await expect(abrirElPaso).toBeFocused();
    expect(await escenario.existeLaMateria(id)).toBe(true);

    // «Sí, borrar»: vuelve a la lista con el aviso.
    await abrirElPaso.click();
    await page.getByRole("button", { name: "Sí, borrar", exact: true }).click();
    await expect(page).toHaveURL(`${RUTA}?${new URLSearchParams({ borrada: nombre })}`, ESPERA);
    await expect(estado(page, "Borramos la materia")).toHaveText(`Borramos la materia ${nombre}.`);
    await expect(page.getByRole("link", { name: nombre, exact: true })).toHaveCount(0);
    expect(await escenario.existeLaMateria(id)).toBe(false);

    // Ya no sale en certificados ni en la solicitud para ser monitor.
    await abrir(page, "/admin/certificados");
    await expect(page.getByLabel("Materia", { exact: true }).locator("option").first()).toBeAttached(ESPERA);
    await expect(page.getByLabel("Materia", { exact: true }).locator("option", { hasText: codigo })).toHaveCount(0);
    await page.goto("/quiero-ser-monitor");
    await expect(page.getByRole("heading", { level: 2, name: "Quiero ser monitor" })).toBeVisible(ESPERA);
    await expect(page.getByRole("checkbox").first()).toBeVisible(ESPERA);
    await expect(page.getByRole("checkbox", { name: nombre, exact: true })).toHaveCount(0);

    // Y su página ya no existe.
    const respuesta = await page.goto(`${RUTA}/${id}`);
    expect(respuesta?.status()).toBe(404);
  });

  test("una materia con un certificado no ofrece borrarla y dice por qué, ni en su página ni en la lista", async ({ page, cuentas, escenario }) => {
    const admin = await cuentas.crearAdmin();
    const monitor = await escenario.monitor();
    const materia = await escenario.materia();
    await escenario.certificar(monitor.id, materia.id, admin.id);
    const marca = escenario.marca();
    const evaluacion = await escenario.evaluacion(materia.id, { nombre: `Parcial ${marca}`, semana: 2 });
    await escenario.tema(materia.id, evaluacion);

    await entrar(page, `${RUTA}/${materia.id}`, admin);

    await expect(page.getByText("No se puede borrar: tiene evaluaciones, temas y certificados.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Borrar materia" })).toHaveCount(0);

    await page.goto(RUTA);
    await expect(listaDeMaterias(page, materia.nombre)).toBeVisible(ESPERA);
    await expect(page.getByRole("button", { name: /Borrar/ })).toHaveCount(0);
    expect(await escenario.existeLaMateria(materia.id)).toBe(true);
  });

  test("con la confirmación abierta, si se liga algo no se borra y lo dice; si ya no existe, también", async ({ page, cuentas, escenario }) => {
    const admin = await cuentas.crearAdmin();
    const monitor = await escenario.monitor();
    const conCertificado = await escenario.materia();
    const queDesaparece = await escenario.materia();

    // Se certifica a un monitor entre que se abrió la página y se confirmó el borrado.
    await entrar(page, `${RUTA}/${conCertificado.id}`, admin);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Borrar materia", exact: true }).click();
    const paso = page.getByRole("group", { name: `¿Borrar la materia ${conCertificado.nombre} (${conCertificado.codigo})? No se puede deshacer.` });
    await expect(paso).toBeVisible();
    await escenario.certificar(monitor.id, conCertificado.id, admin.id);
    await paso.getByRole("button", { name: "Sí, borrar", exact: true }).click();
    await expect(alerta(paso, "Ya no se puede borrar: tiene certificados. Recarga la página.")).toBeVisible(ESPERA);
    await expect(page).toHaveURL(`${RUTA}/${conCertificado.id}`);
    await expect(paso.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
    expect(await escenario.existeLaMateria(conCertificado.id)).toBe(true);

    // Al recargar, la página ya sabe que no se puede borrar.
    await page.reload();
    await expect(page.getByText("No se puede borrar: tiene certificados.", { exact: true })).toBeVisible(ESPERA);
    await expect(page.getByRole("button", { name: "Borrar materia" })).toHaveCount(0);

    // Otra materia: alguien la borra con la confirmación abierta.
    await abrir(page, `${RUTA}/${queDesaparece.id}`);
    await page.getByRole("button", { name: "Borrar materia", exact: true }).click();
    const otroPaso = page.getByRole("group", { name: `¿Borrar la materia ${queDesaparece.nombre} (${queDesaparece.codigo})? No se puede deshacer.` });
    await expect(otroPaso).toBeVisible();
    const { error } = await cuentas.cliente.from("materia").delete().eq("id", queDesaparece.id);
    expect(error).toBeNull();
    await otroPaso.getByRole("button", { name: "Sí, borrar", exact: true }).click();
    await expect(alerta(otroPaso, "No encontramos esa materia. Recarga la página.")).toBeVisible(ESPERA);
    await expect(page).toHaveURL(`${RUTA}/${queDesaparece.id}`);
  });

  test("una evaluación sin nada ligado se borra con su confirmación; con un tema ligado a la vez o ya borrada, no", async ({ page, cuentas, escenario }) => {
    const admin = await cuentas.crearAdmin();
    const materia = await escenario.materia();
    const marca = escenario.marca();
    const sinNada = await escenario.evaluacion(materia.id, { nombre: `Evaluación sin nada ${marca}`, semana: 2 });
    const hermana = await escenario.evaluacion(materia.id, { nombre: `Evaluación hermana ${marca}`, semana: 3 });
    const ligadaDespues = await escenario.evaluacion(materia.id, { nombre: `Evaluación que se liga ${marca}`, semana: 4 });
    const ajena = await escenario.evaluacion(materia.id, { nombre: `Evaluación que se borra ${marca}`, semana: 5 });

    await entrar(page, `${RUTA}/${materia.id}`, admin);
    await page.waitForLoadState("networkidle");

    // «Cancelar» no hace nada y el foco vuelve al botón «Borrar» de esa evaluación.
    const nombreSinNada = `Evaluación sin nada ${marca}`;
    const abrirElPaso = tarjeta(page, sinNada).getByRole("button", { name: "Borrar", exact: true });
    await expect(abrirElPaso).toHaveAccessibleDescription(nombreSinNada);
    await abrirElPaso.click();
    const paso = tarjeta(page, sinNada).getByRole("group", { name: `¿Borrar la evaluación ${nombreSinNada}? No se puede deshacer.` });
    await expect(paso.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
    await paso.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(paso).toHaveCount(0);
    await expect(abrirElPaso).toBeFocused();
    expect(await escenario.existeLaEvaluacion(sinNada)).toBe(true);

    // «Sí, borrar»: vuelve a la página de la materia con el aviso, y la evaluación ya no está.
    await abrirElPaso.click();
    await paso.getByRole("button", { name: "Sí, borrar", exact: true }).click();
    await expect(page).toHaveURL(`${RUTA}/${materia.id}?${new URLSearchParams({ evaluacion_borrada: nombreSinNada })}`, ESPERA);
    await expect(estado(page, "Borramos la evaluación")).toHaveText(`Borramos la evaluación ${nombreSinNada}.`);
    await expect(tarjeta(page, sinNada)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Evaluaciones (3)" })).toBeVisible();
    await expect(tarjeta(page, hermana)).toBeVisible();
    expect(await escenario.existeLaEvaluacion(sinNada)).toBe(false);
    expect(await escenario.existeLaEvaluacion(hermana)).toBe(true);

    // Se le liga un tema con la confirmación abierta.
    await tarjeta(page, ligadaDespues).getByRole("button", { name: "Borrar", exact: true }).click();
    const pasoLigado = tarjeta(page, ligadaDespues).getByRole("group");
    await expect(pasoLigado).toBeVisible();
    await escenario.tema(materia.id, ligadaDespues);
    await pasoLigado.getByRole("button", { name: "Sí, borrar", exact: true }).click();
    await expect(alerta(pasoLigado, "Ya no se puede borrar: tiene temas. Recarga la página.")).toBeVisible(ESPERA);
    expect(await escenario.existeLaEvaluacion(ligadaDespues)).toBe(true);

    // Otra se borra por fuera con la confirmación abierta.
    await tarjeta(page, ajena).getByRole("button", { name: "Borrar", exact: true }).click();
    const pasoAjeno = tarjeta(page, ajena).getByRole("group");
    await expect(pasoAjeno).toBeVisible();
    const { error } = await cuentas.cliente.from("evaluacion").delete().eq("id", ajena);
    expect(error).toBeNull();
    await pasoAjeno.getByRole("button", { name: "Sí, borrar", exact: true }).click();
    await expect(alerta(pasoAjeno, "No encontramos esa evaluación. Recarga la página.")).toBeVisible(ESPERA);
  });
});

// ---------------------------------------------------------------------------
// Criterio 18: fallas
// ---------------------------------------------------------------------------
test.describe("Criterio 18 · si la red falla", () => {
  test("al crear: «No pudimos guardar los cambios…» con los campos conservados, y al reintentar se crea", async ({ page, cuentas, escenario }) => {
    const admin = await cuentas.crearAdmin();
    const nombre = `Materia sin red ${escenario.marca()}`;
    const codigo = await escenario.codigo();
    await entrar(page, RUTA, admin);
    await page.waitForLoadState("networkidle");
    const campos = nueva(page);

    // La acción del servidor es un POST a la misma página con el encabezado next-action: se corta la red.
    const cortarLaRed = (pedido: Route) =>
      pedido.request().method() === "POST" && pedido.request().headers()["next-action"] ? pedido.abort("internetdisconnected") : pedido.continue();
    await page.route(`**${RUTA}`, cortarLaRed);

    await campos.nombre.fill(nombre);
    await campos.codigo.fill(codigo);
    await campos.crear.click();
    await expect(alerta(page, FALLO_AL_GUARDAR)).toBeVisible(ESPERA);
    await expect(campos.nombre).toHaveValue(nombre);
    await expect(campos.codigo).toHaveValue(codigo);
    expect(await escenario.materiaPorCodigo(codigo)).toBeNull();

    // Con la red de vuelta, el mismo envío crea la materia.
    await page.unroute(`**${RUTA}`, cortarLaRed);
    await campos.crear.click();
    await expect(estado(page, "Creamos la materia")).toHaveText(`Creamos la materia ${nombre} (${codigo}).`, ESPERA);
    expect(await escenario.materiaPorCodigo(codigo)).toMatchObject({ nombre, codigo });
  });

  test("al guardar una evaluación y al borrar: el aviso general, los campos conservados y nada cambia", async ({ page, cuentas, escenario }) => {
    const admin = await cuentas.crearAdmin();
    const materia = await escenario.materia();
    const marca = escenario.marca();
    const evaluacion = await escenario.evaluacion(materia.id, { nombre: `Evaluación sin red ${marca}`, semana: 2 });
    await entrar(page, `${RUTA}/${materia.id}`, admin);
    await page.waitForLoadState("networkidle");

    const ruta = `**${RUTA}/${materia.id}`;
    await page.route(ruta, (pedido) =>
      pedido.request().method() === "POST" && pedido.request().headers()["next-action"] ? pedido.abort("internetdisconnected") : pedido.continue(),
    );

    const campos = camposDeLaEvaluacion(tarjeta(page, evaluacion));
    await campos.nombre.fill(`Otro nombre ${marca}`);
    await campos.semana.fill("7");
    await campos.guardar.click();
    await expect(alerta(tarjeta(page, evaluacion), FALLO_AL_GUARDAR)).toBeVisible(ESPERA);
    await expect(campos.nombre).toHaveValue(`Otro nombre ${marca}`);
    await expect(campos.semana).toHaveValue("7");
    expect(await escenario.evaluacionEnLaBase(evaluacion)).toMatchObject({ nombre: `Evaluación sin red ${marca}`, semana: 2, editada_en_app: false });

    // Borrar la evaluación: el error sale dentro del paso de confirmación.
    await tarjeta(page, evaluacion).getByRole("button", { name: "Borrar", exact: true }).click();
    const paso = tarjeta(page, evaluacion).getByRole("group");
    await paso.getByRole("button", { name: "Sí, borrar", exact: true }).click();
    await expect(alerta(paso, "No pudimos borrar. Intenta de nuevo.")).toBeVisible(ESPERA);
    expect(await escenario.existeLaEvaluacion(evaluacion)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterio 10: los demás roles
// ---------------------------------------------------------------------------
test.describe("Criterio 10 · solo un admin entra", () => {
  test("sin sesión pide iniciar sesión; un monitor y una sesión anónima no ven nada de esto; un id que no es UUID o no existe da «no encontrada»", async ({
    page,
    context,
    cuentas,
    escenario,
  }) => {
    const monitor = await cuentas.crearMonitor();
    const materia = await escenario.materia();
    const adminDeLaPrueba = await cuentas.crearAdmin();
    const sinMateria = randomUUID();

    // Sin sesión: /ingresar, con la ruta pedida para volver a ella si su rol la permite.
    for (const ruta of [RUTA, `${RUTA}/${materia.id}`]) {
      await page.goto(ruta);
      await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
      await expect(page.getByRole("heading", { level: 1, name: "Inicia sesión" })).toBeVisible();
    }

    // Una sesión anónima (quien solo hizo un diagnóstico) tampoco: a /ingresar.
    await page.goto("/");
    const anonima = await esperarSesion(context);
    cuentas.borrarAlFinal(anonima.id);
    for (const ruta of [RUTA, `${RUTA}/${materia.id}`]) {
      await page.goto(ruta);
      await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
    }
    await expect(page.getByRole("heading", { level: 1, name: "Materias y evaluaciones" })).toHaveCount(0);

    // El monitor entra con su cuenta y la ruta de otro rol lo lleva a su panel, sin ver el formulario ni la lista.
    await context.clearCookies();
    await page.goto(RUTA);
    await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(RUTA)}`, ESPERA);
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);
    for (const ruta of [RUTA, `${RUTA}/${materia.id}`]) {
      await page.goto(ruta);
      await expect(page).toHaveURL("/monitor", ESPERA);
      await expect(page.getByRole("heading", { level: 1, name: `Hola, ${monitor.nombre}` })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /Crear materia|Guardar cambios|Borrar/ })).toHaveCount(0);
    await expect(page.getByText(materia.nombre)).toHaveCount(0);

    // El admin sí entra; un id que no es UUID o que no existe da la página «no encontrada».
    await context.clearCookies();
    await entrar(page, `${RUTA}/${materia.id}`, adminDeLaPrueba);
    for (const id of ["no-es-un-uuid", sinMateria]) {
      const respuesta = await page.goto(`${RUTA}/${id}`);
      expect(respuesta?.status(), id).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "No encontramos esta página" })).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Criterio 20: medidas
// ---------------------------------------------------------------------------
test.describe("Criterio 20 · accesibilidad del producto", () => {
  test("la lista y la página de la materia, con evaluaciones activas e inactivas, un nombre de 120 caracteres sin espacios y avisos a la vista, cumplen las reglas", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const admin = await cuentas.crearAdmin();
    const marca = escenario.marca();
    // Un nombre de 120 caracteres sin un solo espacio: no puede desbordar a 390 px.
    const largo = `M${marca}${"x".repeat(120 - 1 - marca.length)}`;
    expect(largo).toHaveLength(120);
    const materia = await escenario.materia({ nombre: largo });
    const activa = await escenario.evaluacion(materia.id, { nombre: `Parcial activo ${marca}`, semana: 8, activa: true, acumulativo: true });
    await escenario.evaluacion(materia.id, { nombre: `Parcial inactivo ${marca}`, semana: 4 });
    // La que se puede borrar también lleva un nombre de 120 caracteres sin espacios: sale en su título y en la pregunta de la confirmación.
    const sinNada = await escenario.evaluacion(materia.id, { nombre: `E${marca}${"y".repeat(120 - 1 - marca.length)}`, semana: 2 });
    await escenario.tema(materia.id, activa);

    // La lista, en reposo y con los dos errores de «Nueva materia» a la vista.
    await entrar(page, RUTA, admin);
    await page.waitForLoadState("networkidle");
    await expect(listaDeMaterias(page, largo)).toContainText(`${materia.codigo} · 3 evaluaciones, 1 activa`, ESPERA);
    await expectReglasDelProducto(page, "la lista");
    await nueva(page).crear.click();
    await expect(alerta(page, "Escribe el nombre de la materia.")).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "la lista con errores");

    // La materia: en reposo, con el aviso del código y con el paso de confirmación de una evaluación abierto.
    await abrir(page, `${RUTA}/${materia.id}`);
    await expect(titulo1(page, largo)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Evaluaciones (3)" })).toBeVisible();
    await expect(tarjeta(page, activa)).toContainText("Activa");
    await expect(tarjeta(page, sinNada)).toContainText("Inactiva");
    await expectReglasDelProducto(page, "la materia");

    await datos(page).codigo.fill(`${LETRAS}-0000`);
    await expect(estado(page, "Los enlaces con el código anterior")).toBeVisible();
    await expectReglasDelProducto(page, "la materia con el aviso del código");

    await tarjeta(page, sinNada).getByRole("button", { name: "Borrar", exact: true }).click();
    await expect(tarjeta(page, sinNada).getByRole("group")).toBeVisible();
    await expectReglasDelProducto(page, "la materia con la confirmación abierta");
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (copia de e2e/resolver-reportes.spec.ts: la medida por elemento)
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

/** Texto, áreas táctiles, degradados y nombres. De las casillas y los radios cuenta su etiqueta, que también los marca. */
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
        // El texto de un campo (`input`, `textarea`) más largo que su caja se desplaza dentro de ella: no es un desborde de la página.
        const esUnCampo = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
        const contenidoFueraDeSuCaja = !esUnCampo && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
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
