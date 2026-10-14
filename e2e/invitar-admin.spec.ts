import { createHash, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import {
  contrasenaAleatoria,
  correoUnico,
  enviarCredenciales,
  expect,
  test,
  usarTurnstileDePrueba,
  variable,
  type Cuenta,
  type Cuentas,
} from "./utilidades";

// HU-072: invitar a un admin por correo, ver y cancelar las invitaciones abiertas, registrarse como admin y reactivar a un
// admin desactivado. Corre contra el Supabase local (Auth, base y Mailpit) con cuentas que crea y borra cada prueba. La
// lista de /admin/equipo es de todos: con los proyectos movil y escritorio corriendo a la vez, cada prueba busca solo por
// el correo o el nombre únicos que ella misma creó.

test.describe.configure({ mode: "default", timeout: 90_000 });
const ESPERA = { timeout: 20_000 };
const RUTA = "/admin/equipo";
const TITULO_SIN_INVITACION = "Necesitas una invitación vigente";
const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

async function entrar(page: Page, cuenta: Cuenta): Promise<void> {
  await page.goto("/admin");
  await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent("/admin")}`, ESPERA);
  await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
  await page.getByRole("link", { name: "Equipo de admins" }).click();
  await expect(page).toHaveURL(RUTA, ESPERA);
}

// Por el nombre exacto de la cabecera de la tarjeta, no por cualquier texto (ver e2e/equipo.spec.ts).
const tarjeta = (page: Page, nombre: string) => page.getByRole("listitem").filter({ has: page.getByText(nombre, { exact: true }) });
// Una invitación: su tarjeta lleva el correo como cabecera.
const invitacion = (page: Page, correo: string) => page.getByRole("list", { name: "Invitaciones abiertas" }).getByRole("listitem").filter({ has: page.getByText(correo, { exact: true }) });

// Next pone su propio role="alert" fuera de <main> (el anunciador de rutas, que dice el título al navegar): la alerta de la
// pantalla se busca dentro de <main>.
const alerta = (page: Page) => page.getByRole("main").getByRole("alert");

/** Llena y envía el formulario de invitar. Los campos salen vacíos cada vez que la página vuelve. */
async function enviarInvitacion(page: Page, campos: { correo: string; repetido?: string; casilla?: boolean }): Promise<void> {
  await page.getByLabel("Correo de la persona").fill(campos.correo);
  await page.getByLabel("Escribe el correo otra vez").fill(campos.repetido ?? campos.correo);
  if (campos.casilla ?? true) await page.getByRole("checkbox", { name: /Entiendo que esta persona podrá ver datos personales/ }).check();
  await page.getByRole("button", { name: "Enviar invitación" }).click();
}

const AVISO_ENVIADA = "Enviamos la invitación. El enlace sirve una sola vez y vence en 7 días. La ves en «Invitaciones abiertas».";

async function invitarPorLaPantalla(page: Page, correo: string): Promise<void> {
  await enviarInvitacion(page, { correo });
  await expect(page.getByRole("status")).toHaveText(AVISO_ENVIADA, ESPERA);
  await expect(invitacion(page, correo)).toBeVisible();
}

/** Los enlaces de registro de los correos que recibió `correo`, del más viejo al más nuevo. */
async function enlacesRecibidos(correo: string, cuantos: number): Promise<string[]> {
  const mailpit = variable("MAILPIT_URL");
  let resumenes: { ID: string; Created: string }[] = [];
  await expect
    .poll(
      async () => {
        const respuesta = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
        resumenes = ((await respuesta.json()) as { messages?: { ID: string; Created: string }[] }).messages ?? [];
        return resumenes.length;
      },
      { message: `debían llegar ${cuantos} correos a ${correo}`, timeout: 30_000, intervals: [250, 500, 1_000] },
    )
    .toBe(cuantos);
  const ordenados = [...resumenes].sort((a, b) => new Date(a.Created).getTime() - new Date(b.Created).getTime());
  const enlaces: string[] = [];
  for (const { ID } of ordenados) {
    const { HTML } = (await (await fetch(`${mailpit}/api/v1/message/${ID}`)).json()) as { HTML: string };
    const enlace = /href="([^"]*\/admins\/registro\?[^"]*)"/.exec(HTML)?.[1]?.replaceAll("&amp;", "&");
    if (!enlace) throw new Error("El correo no trae el enlace de registro.");
    enlaces.push(enlace);
  }
  await fetch(`${mailpit}/api/v1/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ IDs: ordenados.map(({ ID }) => ID) }),
  });
  return enlaces;
}

async function invitacionesEnLaBase(cuentas: Cuentas, correo: string) {
  const { data, error } = await cuentas.cliente.from("invitacion_admin").select("id, usada_en, cancelada_en").eq("correo", correo);
  if (error) throw error;
  return data as { id: string; usada_en: string | null; cancelada_en: string | null }[];
}

/** Una invitación sembrada directo en la base, con un token que escoge la prueba. */
async function sembrarInvitacion(cuentas: Cuentas, idAdmin: string, correo: string): Promise<string> {
  const token = randomUUID().replaceAll("-", "").repeat(2);
  const { error } = await cuentas.cliente.from("invitacion_admin").insert({ correo, token_hash: sha256(token), id_admin: idAdmin });
  if (error) throw error;
  return token;
}

// ---------------------------------------------------------------------------------------------------------------

test.describe("Criterios 1 a 12 · de punta a punta", () => {
  test("el admin invita, la persona se registra con el enlace, aparece al final del equipo y el enlace ya no sirve", async ({ page, browser, cuentas }) => {
    const yo = await cuentas.crearAdmin();
    const correo = correoUnico();
    const nombre = `Admin nuevo ${Date.now()}`;
    const contrasena = contrasenaAleatoria();
    await entrar(page, yo);

    // Criterio 2: si falta algo no se crea nada y la pantalla dice qué.
    await enviarInvitacion(page, { correo, repetido: `otro-${correo}` });
    await expect(alerta(page)).toHaveText("Los dos correos no coinciden. Escríbelos de nuevo.", ESPERA);
    await expect(page).toHaveURL(`${RUTA}?error=correos_distintos`);
    await expect(page.getByLabel("Correo de la persona")).toHaveValue("");
    expect(await invitacionesEnLaBase(cuentas, correo)).toEqual([]);

    await enviarInvitacion(page, { correo, casilla: false });
    await expect(alerta(page)).toHaveText("Marca la casilla para confirmar que la persona podrá ver esos datos personales.", ESPERA);
    expect(await invitacionesEnLaBase(cuentas, correo)).toEqual([]);

    await enviarInvitacion(page, { correo, repetido: `otro-${correo}`, casilla: false });
    await expect(alerta(page)).toHaveText(
      "Los dos correos no coinciden y falta marcar la casilla. Escribe los correos de nuevo y marca la casilla.",
      ESPERA,
    );
    expect(await invitacionesEnLaBase(cuentas, correo)).toEqual([]);

    // Criterio 1: con todo bien se crea, aparece en la lista y llega el correo.
    await invitarPorLaPantalla(page, correo);
    expect(page.url()).not.toContain(correo);
    const tarjetaDeLaInvitacion = invitacion(page, correo);
    await expect(tarjetaDeLaInvitacion).toContainText(`Invitó ${yo.nombre}`);
    await expect(tarjetaDeLaInvitacion).not.toContainText("(desactivado)");
    await expect(tarjetaDeLaInvitacion).toContainText(/Vigente · vence el .+\d{4}/);
    await expect(page.getByRole("heading", { level: 2, name: /^Invitaciones abiertas \(\d+\)$/ })).toBeVisible();

    const mensaje = await cuentas.esperarCorreo(correo);
    expect(mensaje.asunto).toBe("Te invitaron al equipo de admins de Calibra");
    expect(mensaje.html).toContain(yo.nombre);
    const enlace = /href="([^"]*\/admins\/registro\?token=[0-9a-f]{64})"/.exec(mensaje.html)?.[1]?.replaceAll("&amp;", "&");
    expect(enlace, "el correo debía traer el enlace de registro").toBeTruthy();

    // Criterios 5 a 7 y 17: en un contexto limpio, la persona ve su correo, el vencimiento, y se registra.
    const contexto = await browser.newContext();
    await usarTurnstileDePrueba(contexto);
    try {
      const persona = await contexto.newPage();
      await persona.goto(enlace!);
      // El correo de la invitación va como texto (no en un campo que lo corte), con su etiqueta, y no se puede cambiar.
      await expect(persona.getByText(correo, { exact: true })).toBeVisible(ESPERA);
      await expect(persona.getByText("Correo", { exact: true })).toBeVisible();
      await expect(persona.locator('input[type="email"], input[name="correo"], input[name="email"]')).toHaveCount(0);
      await expect(persona.getByText(/^Esta invitación vence el .+\d{4}/)).toBeVisible();
      await expect(persona.getByLabel("Contraseña", { exact: true })).toBeVisible();
      await expect(persona.getByLabel("Repite la contraseña")).toBeVisible();

      await persona.getByLabel("Nombre completo").fill(nombre);
      await persona.getByLabel("Contraseña", { exact: true }).fill(contrasena);
      await persona.getByLabel("Repite la contraseña").fill(contrasena);
      await persona.getByRole("button", { name: "Crear mi cuenta" }).click();

      await expect(persona).toHaveURL("/admin", ESPERA);
      await expect(persona.getByRole("heading", { name: `Hola, ${nombre}` })).toBeVisible(ESPERA);

      // La cuenta se borra al terminar la prueba.
      // Que quede en el último lugar no se afirma aquí: otras pruebas crean admins con órdenes altos al azar mientras corre
      // esta (movil y escritorio van a la vez). Eso lo comprueban pgTAP y la integración, que miran el máximo en ese instante.
      const { data } = await cuentas.cliente.from("admin").select("id").eq("correo", correo).single();
      expect(data, "el registro debía crear la fila de admin").not.toBeNull();
      cuentas.borrarAlFinal(data!.id as string);

      // Criterio 7 (enlace de un solo uso): ya no sirve.
      await persona.goto(enlace!);
      await expect(persona.getByRole("heading", { name: TITULO_SIN_INVITACION })).toBeVisible(ESPERA);
      await expect(persona.locator('input[type="password"]')).toHaveCount(0);
    } finally {
      await contexto.close();
    }

    // Criterios 10 y 11: el admin recarga; la invitación salió de la lista y el nuevo admin está activo, sin casos y con «Subir».
    await page.reload();
    await expect(invitacion(page, correo)).toHaveCount(0);
    const nueva = tarjeta(page, nombre);
    await expect(nueva).toBeVisible(ESPERA);
    await expect(nueva).toContainText("Activo · Sin casos abiertos");
    await expect(nueva).toContainText(correo);
    await expect(nueva.getByRole("button", { name: "Subir" })).toBeVisible();
    await expect(nueva.getByText(`Reactivar a ${nombre}`, { exact: true })).toHaveCount(0);
  });
});

test.describe("Criterio 2 · sin JavaScript", () => {
  test("el formulario de invitar se envía y vuelve con el aviso o con el error, redirigiendo desde el servidor", async ({ page, browser, cuentas }) => {
    const yo = await cuentas.crearAdmin();
    const correo = correoUnico();
    await entrar(page, yo);
    const sesion = await page.context().storageState();

    const contexto = await browser.newContext({ javaScriptEnabled: false, storageState: sesion });
    try {
      const sinJs = await contexto.newPage();
      await sinJs.goto(RUTA);
      await expect(sinJs.getByRole("heading", { level: 1, name: "Equipo de admins" })).toBeVisible(ESPERA);

      // Con los correos distintos vuelve con el error y sin crear nada.
      await enviarInvitacion(sinJs, { correo, repetido: `otro-${correo}` });
      await expect(alerta(sinJs)).toHaveText("Los dos correos no coinciden. Escríbelos de nuevo.", ESPERA);
      await expect(sinJs).toHaveURL(`${RUTA}?error=correos_distintos`);
      expect(await invitacionesEnLaBase(cuentas, correo)).toEqual([]);

      // Con todo bien crea la invitación y vuelve con el aviso, sin el correo en la dirección.
      await enviarInvitacion(sinJs, { correo });
      await expect(sinJs.getByRole("status")).toHaveText(AVISO_ENVIADA, ESPERA);
      await expect(sinJs).toHaveURL(`${RUTA}?invitada=1`);
      await expect(invitacion(sinJs, correo)).toBeVisible();
      expect(await invitacionesEnLaBase(cuentas, correo)).toHaveLength(1);
    } finally {
      await contexto.close();
    }
    await cuentas.esperarCorreo(correo);
  });
});

test.describe("Criterio 12 · cancelar", () => {
  test("cancelar pide confirmación, la saca de la lista y su enlace se lee como uno vencido; en una pestaña vieja dice que ya no está abierta", async ({
    page,
    cuentas,
  }) => {
    const yo = await cuentas.crearAdmin();
    const correo = correoUnico();
    await entrar(page, yo);
    await invitarPorLaPantalla(page, correo);
    const [enlace] = await enlacesRecibidos(correo, 1);

    // Una pestaña vieja que sigue mostrando la invitación.
    const vieja = await page.context().newPage();
    await vieja.goto(RUTA);
    await expect(invitacion(vieja, correo)).toBeVisible(ESPERA);

    const suya = invitacion(page, correo);
    await suya.getByText(`Cancelar la invitación a ${correo}`, { exact: true }).click();
    await expect(suya.getByText("El enlace que ya salió dejará de servir. Si lo necesitas, puedes invitar de nuevo.")).toBeVisible();
    await suya.getByRole("button", { name: "Sí, cancelar la invitación" }).click();

    await expect(page.getByRole("status")).toHaveText("La invitación quedó cancelada: su enlace ya no sirve.", ESPERA);
    await expect(invitacion(page, correo)).toHaveCount(0);
    const filas = await invitacionesEnLaBase(cuentas, correo);
    expect(filas).toHaveLength(1);
    expect(filas[0].cancelada_en).not.toBeNull();

    // El enlace cancelado se lee como uno vencido.
    await page.goto(enlace);
    await expect(page.getByRole("heading", { name: TITULO_SIN_INVITACION })).toBeVisible(ESPERA);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    // Cancelar otra vez desde la pestaña vieja no cambia nada y lo dice.
    await invitacion(vieja, correo).getByText(`Cancelar la invitación a ${correo}`, { exact: true }).click();
    await invitacion(vieja, correo).getByRole("button", { name: "Sí, cancelar la invitación" }).click();
    await expect(alerta(vieja)).toHaveText("Esa invitación ya no está abierta.", ESPERA);
    expect((await invitacionesEnLaBase(cuentas, correo))[0].cancelada_en).toBe(filas[0].cancelada_en);
  });
});

test.describe("Criterio 4 · reinvitar", () => {
  test("dos invitaciones al mismo correo dejan una sola tarjeta: el enlace del primer correo ya no sirve y el del segundo sí", async ({ page, cuentas }) => {
    const yo = await cuentas.crearAdmin();
    const correo = correoUnico();
    await entrar(page, yo);

    await invitarPorLaPantalla(page, correo);
    await invitarPorLaPantalla(page, correo);

    await expect(invitacion(page, correo)).toHaveCount(1);
    const [primero, segundo] = await enlacesRecibidos(correo, 2);
    expect(primero).not.toBe(segundo);

    await page.goto(primero);
    await expect(page.getByRole("heading", { name: TITULO_SIN_INVITACION })).toBeVisible(ESPERA);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    await page.goto(segundo);
    await expect(page.getByRole("heading", { name: "Crea tu cuenta de admin" })).toBeVisible(ESPERA);
    await expect(page.getByText(correo, { exact: true })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(2);

    const filas = await invitacionesEnLaBase(cuentas, correo);
    expect(filas).toHaveLength(2);
    expect(filas.filter((fila) => fila.cancelada_en === null && fila.usada_en === null)).toHaveLength(1);
  });
});

test.describe("Criterio 3 · correos que no se pueden invitar", () => {
  test("un admin activo, uno desactivado y un monitor se rechazan con su mensaje y sin crear nada", async ({ page, cuentas }) => {
    const yo = await cuentas.crearAdmin();
    const activo = await cuentas.crearAdmin();
    const desactivado = await cuentas.crearAdmin();
    await cuentas.desactivar(desactivado.id);
    const monitor = await cuentas.crearMonitor();
    await entrar(page, yo);

    await enviarInvitacion(page, { correo: activo.correo });
    await expect(alerta(page)).toHaveText("Ese correo ya es de un admin del equipo.", ESPERA);

    await enviarInvitacion(page, { correo: desactivado.correo });
    await expect(alerta(page)).toHaveText("Ese correo es de un admin desactivado. Se reactiva desde su tarjeta, con «Reactivar».", ESPERA);

    await enviarInvitacion(page, { correo: monitor.correo });
    await expect(alerta(page)).toHaveText("Ese correo ya tiene una cuenta de monitor.", ESPERA);

    // Un correo que no es un correo se rechaza antes de tocar la base.
    await enviarInvitacion(page, { correo: "no-es-un-correo" });
    await expect(alerta(page)).toHaveText("Escribe un correo válido.", ESPERA);

    for (const cuenta of [activo, desactivado, monitor]) expect(await invitacionesEnLaBase(cuentas, cuenta.correo)).toEqual([]);
    // El correo no viaja en la dirección, tampoco en un rechazo.
    expect(page.url()).not.toContain("calibra.test");
  });
});

test.describe("Criterio 13 · reactivar", () => {
  test("la tarjeta de un desactivado ofrece «Reactivar» con confirmación; al confirmar vuelve a entrar. Una tarjeta activa no lo ofrece", async ({
    page,
    browser,
    cuentas,
  }) => {
    const yo = await cuentas.crearAdmin();
    const otro = await cuentas.crearAdmin();
    await cuentas.desactivar(otro.id);
    await entrar(page, yo);

    // Una tarjeta activa no ofrece reactivar.
    await expect(tarjeta(page, `${yo.nombre} (tú)`)).toBeVisible();
    await expect(tarjeta(page, `${yo.nombre} (tú)`).getByText(/^Reactivar a /)).toHaveCount(0);

    const suya = tarjeta(page, otro.nombre);
    await expect(suya).toContainText("Desactivado");
    await expect(suya.getByText(`Desactivar a ${otro.nombre}`, { exact: true })).toHaveCount(0);
    await suya.getByText(`Reactivar a ${otro.nombre}`, { exact: true }).click();
    await expect(suya.getByText(new RegExp(`${otro.nombre} podrá volver a entrar a Calibra con su contraseña de siempre y conserva su lugar en el orden de revisión\\. Sus casos abiertos no se le devuelven\\.`))).toBeVisible();
    await suya.getByRole("button", { name: `Sí, reactivar a ${otro.nombre}` }).click();

    await expect(page.getByRole("status")).toHaveText(`${otro.nombre} quedó reactivado: ya puede volver a entrar. Conserva su lugar en el orden de revisión.`, ESPERA);
    // La dirección trae el id de la persona, no su nombre: el nombre sale del equipo que la página carga con la sesión.
    await expect(page).toHaveURL(`${RUTA}?reactivado=${otro.id}`);
    await expect(tarjeta(page, otro.nombre)).toContainText("Activo");
    await expect(tarjeta(page, otro.nombre).getByText(/^Reactivar a /)).toHaveCount(0);
    await expect(tarjeta(page, otro.nombre).getByText(`Desactivar a ${otro.nombre}`, { exact: true })).toBeVisible();

    // Un texto escrito a mano en la dirección no llega a un aviso de éxito: ni una frase que parezca de soporte, ni un nombre.
    const falso = "Soporte de Calibra: confirma tu clave en https://calibra.example/acceso";
    await page.goto(`${RUTA}?reactivado=${encodeURIComponent(falso)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Equipo de admins" })).toBeVisible(ESPERA);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByText("Soporte de Calibra")).toHaveCount(0);
    await page.goto(`${RUTA}?reactivado=${encodeURIComponent(otro.nombre)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Equipo de admins" })).toBeVisible(ESPERA);
    await expect(page.getByRole("status")).toHaveCount(0);

    // En un contexto limpio, quien se reactivó inicia sesión y llega a /admin.
    const contexto = await browser.newContext();
    await usarTurnstileDePrueba(contexto);
    try {
      const reactivado = await contexto.newPage();
      await reactivado.goto("/admin");
      await expect(reactivado).toHaveURL(`/ingresar?siguiente=${encodeURIComponent("/admin")}`, ESPERA);
      await enviarCredenciales(reactivado, otro.correo, otro.contrasena);
      await expect(reactivado).toHaveURL("/admin", ESPERA);
      await expect(reactivado.getByRole("heading", { name: `Hola, ${otro.nombre}` })).toBeVisible(ESPERA);
    } finally {
      await contexto.close();
    }
  });
});

test.describe("Quien invitó tiene que seguir activo", () => {
  test("la invitación de un admin desactivado sale marcada en la lista y su enlace no sirve; si lo reactivan desde su tarjeta, vuelve a servir", async ({
    page,
    cuentas,
  }) => {
    const yo = await cuentas.crearAdmin();
    const quienInvito = await cuentas.crearAdmin();
    const correo = correoUnico();
    const token = await sembrarInvitacion(cuentas, quienInvito.id, correo);
    await cuentas.desactivar(quienInvito.id);
    await entrar(page, yo);

    // La lista la sigue mostrando, y dice la verdad: no sirve mientras quien invitó siga desactivado.
    const suya = invitacion(page, correo);
    await expect(suya).toContainText(`Invitó ${quienInvito.nombre} (desactivado)`);
    await expect(suya).toContainText(/No sirve mientras quien invitó siga desactivado · vence el .+\d{4}/);
    await expect(suya).not.toContainText("Vigente");

    // Su enlace se lee como uno vencido: ni formulario ni campos de contraseña.
    await page.goto(`/admins/registro?token=${token}`);
    await expect(page.getByRole("heading", { name: TITULO_SIN_INVITACION })).toBeVisible(ESPERA);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    // Reactivan a quien invitó desde su tarjeta: la invitación vuelve a servir.
    await page.goto(RUTA);
    const tarjetaDeQuienInvito = tarjeta(page, quienInvito.nombre);
    await tarjetaDeQuienInvito.getByText(`Reactivar a ${quienInvito.nombre}`, { exact: true }).click();
    await tarjetaDeQuienInvito.getByRole("button", { name: `Sí, reactivar a ${quienInvito.nombre}` }).click();
    await expect(page.getByRole("status")).toContainText(`${quienInvito.nombre} quedó reactivado`, ESPERA);
    await expect(invitacion(page, correo)).toContainText(/Vigente · vence el .+\d{4}/);
    await expect(invitacion(page, correo)).not.toContainText("(desactivado)");

    await page.goto(`/admins/registro?token=${token}`);
    await expect(page.getByRole("heading", { name: "Crea tu cuenta de admin" })).toBeVisible(ESPERA);
    await expect(page.locator('input[type="password"]')).toHaveCount(2);
  });
});

test.describe("Criterio 8 · dos pestañas con el mismo enlace", () => {
  test("quien envía después de que otra persona ya se registró ve que el enlace ya no sirve y la pantalla esconde el formulario", async ({
    browser,
    cuentas,
  }) => {
    const yo = await cuentas.crearAdmin();
    const correo = correoUnico();
    const token = await sembrarInvitacion(cuentas, yo.id, correo);
    const contrasena = contrasenaAleatoria();
    const enlace = `/admins/registro?token=${token}`;

    // Dos contextos limpios, cada uno con su pestaña ya abierta en el formulario (el enlace viejo sigue ahí).
    const primero = await browser.newContext();
    const segundo = await browser.newContext();
    await usarTurnstileDePrueba(primero);
    await usarTurnstileDePrueba(segundo);
    try {
      const a = await primero.newPage();
      const b = await segundo.newPage();
      for (const pestana of [a, b]) {
        await pestana.goto(enlace);
        await expect(pestana.getByRole("heading", { name: "Crea tu cuenta de admin" })).toBeVisible(ESPERA);
        await expect(pestana.locator('input[type="password"]')).toHaveCount(2);
      }

      // La primera se registra y entra.
      await a.getByLabel("Nombre completo").fill(`Primera ${Date.now()}`);
      await a.getByLabel("Contraseña", { exact: true }).fill(contrasena);
      await a.getByLabel("Repite la contraseña").fill(contrasena);
      await a.getByRole("button", { name: "Crear mi cuenta" }).click();
      await expect(a).toHaveURL("/admin", ESPERA);
      const { data } = await cuentas.cliente.from("admin").select("id").eq("correo", correo).single();
      expect(data, "el registro debía crear la fila de admin").not.toBeNull();
      cuentas.borrarAlFinal(data!.id as string);

      // La segunda envía su formulario viejo: el servidor dice que el enlace ya no sirve y el formulario desaparece.
      await b.getByLabel("Nombre completo").fill(`Segunda ${Date.now()}`);
      await b.getByLabel("Contraseña", { exact: true }).fill(contrasena);
      await b.getByLabel("Repite la contraseña").fill(contrasena);
      await b.getByRole("button", { name: "Crear mi cuenta" }).click();
      await expect(alerta(b)).toHaveText("Este enlace ya se usó o venció. Pide otra invitación al equipo de Calibra.", ESPERA);
      await expect(b.locator('input[type="password"]')).toHaveCount(0);
      await expect(b.getByLabel("Nombre completo")).toHaveCount(0);
      await expect(b.getByRole("button", { name: "Crear mi cuenta" })).toHaveCount(0);
      await expect(b).not.toHaveURL("/admin");
    } finally {
      await primero.close();
      await segundo.close();
    }

    // Una sola cuenta de admin con ese correo.
    const { data: admins } = await cuentas.cliente.from("admin").select("id").eq("correo", correo);
    expect(admins).toHaveLength(1);
  });
});

test.describe("Criterios 5 y 14 · roles y rutas", () => {
  test("un monitor que abre /admin/equipo termina en /monitor y no ve el formulario; sin sesión, en /ingresar", async ({ page, browser, cuentas }) => {
    const monitor = await cuentas.crearMonitor();
    await page.goto(RUTA);
    await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(RUTA)}`, ESPERA);
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);
    await expect(page.getByLabel("Correo de la persona")).toHaveCount(0);

    // Sin ninguna sesión.
    const contexto = await browser.newContext();
    try {
      const anonima = await contexto.newPage();
      await anonima.goto(RUTA);
      await expect(anonima).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(RUTA)}`, ESPERA);
      await expect(anonima.getByLabel("Correo de la persona")).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });

  test("/admins/registro sin token o con un token inventado no tiene formulario, y /ingresar no ofrece crear una cuenta de admin", async ({ page }) => {
    for (const ruta of ["/admins/registro", "/admins/registro?token=basura-que-no-existe", `/admins/registro?token=${"a".repeat(64)}`]) {
      await page.goto(ruta);
      await expect(page.getByRole("heading", { name: TITULO_SIN_INVITACION })).toBeVisible(ESPERA);
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Crear mi cuenta" })).toHaveCount(0);
    }

    await page.goto("/ingresar");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible(ESPERA);
    await expect(page.locator('a[href*="/admins/registro"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: /crear.*cuenta|registr/i })).toHaveCount(0);
    await expect(page.locator('a[href*="/admins"]')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Criterio 18 · medidas. `html` y `body` llevan `overflow-x: hidden` (globals.css): `scrollWidth` del documento no delata
// un desborde, así que se mide cada elemento (la misma medida de resolver-reportes.spec.ts, copiada aquí porque extraerla
// tocaría un archivo ajeno).

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
    // Los enlaces dentro de una frase son texto corrido: quedan fuera. De la casilla cuenta su etiqueta, que también la marca.
    const tocables = controles
      .filter((el) => !(el.tagName === "A" && el.closest("label, p")))
      .map((el) => (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.labels?.[0] ?? el) : el));
    const ancho = window.innerWidth;
    const desbordados = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => visible(el) && !el.closest("nextjs-portal"))
      .flatMap((el) => {
        const caja = el.getBoundingClientRect();
        const fueraDeLaVentana = caja.right > ancho + 1 || caja.left < -1;
        const contenidoFueraDeSuCaja = el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
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

async function expectReglas(page: Page, donde: string): Promise<void> {
  const medidas = await medir(page);
  expect(medidas.desbordados, `${donde}: ningún elemento se sale de la pantalla`).toEqual([]);
  expect(medidas.menorTexto, `${donde}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
  expect(medidas.degradados, `${donde}: sin degradados`).toBe(0);
  expect(medidas.tactilesChicos, `${donde}: áreas táctiles de 44 px o más`).toEqual([]);
  expect(medidas.controlesSinNombre, `${donde}: todo control tiene nombre`).toEqual([]);
}

/** Abre todos los `<details>` de las tarjetas de la prueba para medir también lo que se ve al confirmar. */
async function abrir(...detalles: Locator[]): Promise<void> {
  for (const detalle of detalles) await detalle.locator("summary").click();
}

test.describe("Criterio 18 · medidas a 390 y 1280 px", () => {
  test("/admin/equipo con el formulario, una invitación de un correo largo y las confirmaciones abiertas cumple las reglas del producto", async ({ page, cuentas }) => {
    const yo = await cuentas.crearAdmin();
    const desactivado = await cuentas.crearAdmin();
    await cuentas.desactivar(desactivado.id);
    // Quien se registra por invitación escribe su nombre (hasta 120 caracteres) y puede ser una sola palabra: los botones
    // «Sí, reactivar a …» y «Sí, desactivar a …» lo repiten. 60 caracteres sin espacios ni guiones, uno desactivado y uno activo.
    const desactivadoLargo = await cuentas.crearAdmin();
    const activoLargo = await cuentas.crearAdmin();
    const nombreLargo = (marca: string) => `${marca}${randomUUID().replaceAll("-", "")}`.padEnd(60, "x");
    for (const [cuenta, marca] of [[desactivadoLargo, "Desactivada"], [activoLargo, "Activa"]] as const) {
      cuenta.nombre = nombreLargo(marca);
      const { error } = await cuentas.cliente.from("admin").update({ nombre: cuenta.nombre }).eq("id", cuenta.id);
      if (error) throw error;
      expect(cuenta.nombre).toHaveLength(60);
    }
    await cuentas.desactivar(desactivadoLargo.id);
    // Un correo de 80 caracteres, sin espacios ni guiones (el navegador parte una palabra después de un guion, así que
    // un uuid con guiones no probaría el corte): el que más fácil desborda una tarjeta de 390 px.
    const base = `e2e${randomUUID().replaceAll("-", "")}`;
    const largo = `${base}${"x".repeat(80 - base.length - "@calibra.test".length)}@calibra.test`;
    expect(largo).toHaveLength(80);
    await sembrarInvitacion(cuentas, yo.id, largo);
    await entrar(page, yo);

    const larga = invitacion(page, largo);
    await expect(larga).toBeVisible();
    await expect(larga).toContainText("Vigente · vence el");
    await abrir(
      larga.locator("details"),
      tarjeta(page, desactivado.nombre).locator("details"),
      tarjeta(page, desactivadoLargo.nombre).locator("details"),
      tarjeta(page, activoLargo.nombre).locator("details"),
    );
    await expect(larga.getByRole("button", { name: "Sí, cancelar la invitación" })).toBeVisible();
    await expect(tarjeta(page, desactivado.nombre).getByRole("button", { name: `Sí, reactivar a ${desactivado.nombre}` })).toBeVisible();
    await expect(tarjeta(page, desactivadoLargo.nombre).getByRole("button", { name: `Sí, reactivar a ${desactivadoLargo.nombre}` })).toBeVisible();
    await expect(tarjeta(page, activoLargo.nombre).getByRole("button", { name: `Sí, desactivar a ${activoLargo.nombre}` })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Entiendo que esta persona podrá ver datos personales/ })).toBeVisible();

    await expectReglas(page, "/admin/equipo");

    // Con un aviso de error arriba (la página vuelve con la alerta) también.
    await enviarInvitacion(page, { correo: largo, repetido: `otro-${largo}` });
    await expect(alerta(page)).toBeVisible(ESPERA);
    await expectReglas(page, "/admin/equipo con la alerta");
  });

  test("/admins/registro con una invitación vigente y sin ella cumple las reglas del producto", async ({ page, cuentas }) => {
    const yo = await cuentas.crearAdmin();
    // Un correo de 80 caracteres sin espacios ni guiones: el correo va como texto que se parte, no en un <input> que
    // desplaza su texto adentro a 390 px y corta justo el dominio (que es lo que confirma a qué correo se crea la cuenta).
    const base = `e2e${randomUUID().replaceAll("-", "")}`;
    const correo = `${base}${"x".repeat(80 - base.length - "@calibra.test".length)}@calibra.test`;
    expect(correo).toHaveLength(80);
    const token = await sembrarInvitacion(cuentas, yo.id, correo);

    await page.goto(`/admins/registro?token=${token}`);
    await expect(page.getByRole("heading", { name: "Crea tu cuenta de admin" })).toBeVisible(ESPERA);
    await expect(page.getByText(correo, { exact: true })).toBeVisible();
    await expectReglas(page, "/admins/registro");

    // La página sin invitación también.
    await page.goto("/admins/registro");
    await expect(page.getByRole("heading", { name: TITULO_SIN_INVITACION })).toBeVisible(ESPERA);
    await expectReglas(page, "/admins/registro sin invitación");
  });
});
