import type { Locator, Page } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Banco, Pregunta } from "../../scripts/contenido/modelo.mts";
import { dibujarTexto } from "../../src/components/contenido/dibujar";
import { TEXTOS } from "../../src/lib/diagnostico/vista-del-monitor";
import { borrarBancoDelProyecto, cargarBancoDelProyecto, type BancoCargado } from "../banco-del-proyecto";
import { abrirElDetalleDelResultado, esperarSesion } from "../utilidades";
import { abrirLaFecha, apartarYPagar, ESPERA, expect, expectReglasDelProducto, test as base, titulo } from "./escenario";

// HU-084 (F1, pasos 1 a 3): un visitante hace el diagnóstico desde la portada, deja su contacto debajo del resultado, vuelve a
// la portada y ve su último diagnóstico, agenda y paga con ese mismo Lead, y el monitor de la cita abre el diagnóstico desde su
// agenda. A 390 y a 1440 px, como los recorridos de HU-048 (`recorrido-movil` y `recorrido-escritorio`).
//
// - El banco es el de ejemplo, cargado con el cargador real con los códigos de su proyecto (`ZZDR-` y `ZZDS-`, ver
//   e2e/banco-del-proyecto.ts): solo `parcial-1` de la materia A queda activa. Por la base, con la llave secreta, solo se
//   certifica al monitor del recorrido en esa materia; lo demás pasa por las pantallas.
// - La prueba reconoce cada pregunta por su texto contra el banco leído del disco (las letras dependen de la semilla) y elige
//   la correcta en las preguntas pares y una trampa en las impares: sabe de antemano cuántas acertó y en qué.
// - Limpieza: el recorrido borra la monitoría, el pago, el Lead (con él, en cascada, el diagnóstico) y las cuentas; el banco se
//   borra al final del trabajador, después de todo eso (`diagnostico_evaluacion_fk` no cae en cascada).

const LARGA = { timeout: 45_000 };
const URL_RESULTADO = /\/diagnostico\/resultado\/([0-9a-f-]{36})$/;
const NOMBRE_DEL_LEAD = "Lead del recorrido";
const AUTORIZO = /^Autorizo a Calibra a tratar mis datos personales/;
const NIVELES = { lo_domina: "Lo dominas", en_proceso: "En proceso", no_lo_domina: "No lo dominas", sin_medir: "Sin medir" } as const;

const test = base.extend<object, { banco: BancoCargado }>({
  banco: [
    async ({}, entregar, workerInfo) => {
      const banco = await cargarBancoDelProyecto(workerInfo.project.name);
      try {
        await entregar(banco);
      } finally {
        try {
          await borrarBancoDelProyecto(banco.bd, banco.proyecto);
        } finally {
          await banco.bd.end();
        }
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
});

test.describe.configure({ mode: "default" });

// ---------------------------------------------------------------------------
// El banco, para reconocer la pregunta en pantalla
// ---------------------------------------------------------------------------

/** Lo que aparece en pantalla cuando un texto del banco pasa por `TextoDelBanco` (el mismo `dibujarTexto`). */
function plano(texto: string | null): string {
  const entidades: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };
  return renderToStaticMarkup(dibujarTexto(texto))
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entidad) => entidades[entidad])
    .replace(/\s+/g, " ")
    .trim();
}

const juntar = (texto: string) => texto.replace(/\s+/g, " ").trim();

type Opcion = { plano: string; correcta: boolean };
type Paso = { pregunta: Pregunta; acerto: boolean; elegida: Opcion; laCorrecta: Opcion };

/** Las preguntas revisadas de la materia del diagnóstico, por su enunciado tal como se ve. */
function indiceDe(banco: Banco, codigo: string) {
  const materia = banco.materias.find((m) => m.codigo === codigo);
  if (!materia) throw new Error(`El banco no tiene la materia ${codigo}.`);
  const preguntas = materia.temas.flatMap((t) => t.preguntas).filter((p) => p.estado === "revisada");
  const descripciones = new Map(materia.temas.flatMap((t) => t.habilidades).map((h) => [h.clave, plano(h.descripcion)]));
  return {
    descripciones,
    reconocer(enunciado: string, opciones: { letra: string; texto: string }[]) {
      const halladas = preguntas.filter((p) => plano(p.enunciado) === enunciado);
      if (halladas.length !== 1) throw new Error(`No reconozco la pregunta en pantalla (${halladas.length} coincidencias): ${enunciado.slice(0, 100)}`);
      const [pregunta] = halladas;
      const porLetra = opciones.map(({ letra, texto }) => {
        const opcion = pregunta.opciones.find((o) => plano(o.texto) === texto);
        if (!opcion) throw new Error(`No reconozco la opción ${letra} de ${pregunta.clave}: ${texto}`);
        return { letra, opcion: { plano: plano(opcion.texto), correcta: opcion.correcta } };
      });
      return { pregunta, porLetra };
    },
  };
}

/** Lee la pregunta en pantalla, elige la correcta o una trampa por el texto de la opción, responde y espera lo que sigue. */
async function responder(page: Page, indice: ReturnType<typeof indiceDe>, acertar: boolean): Promise<{ paso: Paso; terminado: boolean }> {
  const vista = await page.evaluate(() => ({
    avance: document.querySelector('main p[aria-live="polite"]')?.textContent ?? "",
    enunciado: document.getElementById("enunciado-de-la-pregunta")?.textContent ?? "",
    opciones: [...document.querySelectorAll<HTMLInputElement>('input[name="opcion"]')].map((radio) => ({
      letra: radio.value,
      texto: radio.closest("label")?.lastElementChild?.textContent ?? "",
    })),
  }));
  const { pregunta, porLetra } = indice.reconocer(
    juntar(vista.enunciado),
    vista.opciones.map((o) => ({ letra: o.letra, texto: juntar(o.texto) })),
  );
  const elegida = porLetra.find(({ opcion }) => opcion.correcta === acertar)!;
  const laCorrecta = porLetra.find(({ opcion }) => opcion.correcta)!.opcion;
  await page.locator(`input[name="opcion"][value="${elegida.letra}"]`).check();
  await page.getByRole("button", { name: "Responder", exact: true }).click();

  let terminado = false;
  await expect
    .poll(
      async () => {
        if (URL_RESULTADO.test(page.url())) return (terminado = true);
        const avance = await page
          .locator('main p[aria-live="polite"]')
          .textContent({ timeout: 1_000 })
          .catch(() => null);
        return avance !== null && avance.trim() !== "" && avance.trim() !== vista.avance.trim();
      },
      { message: "debía salir la pregunta que sigue o el resultado", timeout: 30_000 },
    )
    .toBe(true);
  return { paso: { pregunta, acerto: acertar, elegida: elegida.opcion, laCorrecta }, terminado };
}

/** Lo que la prueba sabe de antemano de cada habilidad: las respuestas y los aciertos de sus preguntas de una sola habilidad. */
function cifrasDeUnaSolaHabilidad(pasos: Paso[]): Map<string, { respuestas: number; aciertos: number; todas: boolean }> {
  const cifras = new Map<string, { respuestas: number; aciertos: number; todas: boolean }>();
  for (const paso of pasos) {
    for (const clave of paso.pregunta.habilidades) {
      const actual = cifras.get(clave) ?? { respuestas: 0, aciertos: 0, todas: true };
      // Una pregunta de varias habilidades se acredita según la regla 8 del motor (HU-060): un acierto a todas y un fallo a la
      // habilidad de la trampa. Las cifras de esas habilidades se leen de lo guardado y no se predicen aquí.
      if (paso.pregunta.habilidades.length > 1) actual.todas = false;
      else {
        actual.respuestas += 1;
        if (paso.acerto) actual.aciertos += 1;
      }
      cifras.set(clave, actual);
    }
  }
  return cifras;
}

type Guardado = { habilidades: { habilidad: string; nivel: keyof typeof NIVELES; respuestas: number; aciertos: number }[] };

const preguntaDelDetalle = (zona: Locator, i: number) => zona.locator(":scope > ol > li").nth(i);

// ---------------------------------------------------------------------------
// El recorrido
// ---------------------------------------------------------------------------

test("del diagnóstico en la portada al monitor que lo abre desde su agenda, con el mismo Lead y la misma cita", async ({ recorrido: r, banco }) => {
  test.setTimeout(240_000);
  const indice = indiceDe(banco.banco, banco.codigoA);
  const { error: errorDelCertificado } = await r.cliente
    .from("certificado")
    .insert({ id_monitor: r.monitor.id, id_materia: banco.idMateriaA, id_admin: r.admin.id });
  if (errorDelCertificado) throw new Error(`certificar al monitor en ${banco.codigoA}: ${errorDelCertificado.message}`);

  let page = r.visitante;
  const pasos: Paso[] = [];
  let idDiagnostico = "";

  await test.step("criterio 1: desde la portada empieza el diagnóstico, elige la materia y responde hasta el resultado", async () => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expectReglasDelProducto(page, "inicio");
    await page.getByRole("link", { name: "Hacer mi diagnóstico gratis", exact: true }).first().click();
    await expect(page).toHaveURL("/diagnostico", ESPERA);
    await expect(titulo(page, "Elige tu materia")).toBeVisible(ESPERA);
    await page.waitForLoadState("networkidle");
    r.anotarSesion((await esperarSesion(page.context())).id);
    await expectReglasDelProducto(page, "elegir la materia");
    await page.getByRole("radio", { name: banco.nombreA, exact: true }).check();
    // D-74 b: la única Evaluación también se elige.
    await page.getByRole("radiogroup", { name: "Evaluación", exact: true }).getByRole("radio").first().check();
    await page.getByRole("button", { name: "Empezar", exact: true }).click();
    await expect(titulo(page, "Tu diagnóstico")).toBeVisible(LARGA);
    await expectReglasDelProducto(page, "la primera pregunta");

    for (let numero = 0; numero < 40; numero++) {
      const { paso, terminado } = await responder(page, indice, numero % 2 === 0);
      pasos.push(paso);
      if (terminado) break;
    }
    await expect(page).toHaveURL(URL_RESULTADO, LARGA);
    idDiagnostico = URL_RESULTADO.exec(page.url())![1];
    await expect(titulo(page, "Tu resultado")).toBeVisible(LARGA);
    expect(pasos.some((p) => p.acerto) && pasos.some((p) => !p.acerto), "acertó unas y falló otras").toBe(true);
  });

  await test.step("criterio 4: ve el puntaje global, «Respondiste N preguntas» y el nivel y «Acertaste A de R» de cada habilidad", async () => {
    const principal = page.locator("main");
    const aciertos = pasos.filter((p) => p.acerto).length;
    await expect(principal).toContainText(`Respondiste ${pasos.length} preguntas`);
    await expect(principal).toContainText(`${Math.round((aciertos * 100) / pasos.length)} %`);
    await expect(principal).toContainText(`${aciertos} de ${pasos.length} correctas`);

    const { data, error } = await r.cliente.from("diagnostico").select("resultado_por_habilidad").eq("id", idDiagnostico).single();
    if (error) throw new Error(`leer el diagnóstico: ${error.message}`);
    const guardado = (data as { resultado_por_habilidad: Guardado }).resultado_por_habilidad;
    const sabidas = cifrasDeUnaSolaHabilidad(pasos);

    await abrirElDetalleDelResultado(page);
    const tarjetas = page.getByRole("region", { name: "Habilidades", exact: true }).getByRole("listitem");
    await expect(tarjetas).toHaveCount(guardado.habilidades.length);
    for (const h of guardado.habilidades) {
      const sabida = sabidas.get(h.habilidad);
      if (sabida?.todas) expect({ respuestas: h.respuestas, aciertos: h.aciertos }, `cifras de ${h.habilidad}`).toEqual({ respuestas: sabida.respuestas, aciertos: sabida.aciertos });
      const tarjeta = tarjetas.filter({ hasText: indice.descripciones.get(h.habilidad)! });
      await expect(tarjeta, `la habilidad ${h.habilidad}`).toHaveCount(1);
      await expect(tarjeta).toContainText(NIVELES[h.nivel]);
      if (h.respuestas > 0) await expect(tarjeta).toContainText(`Acertaste ${h.aciertos} de ${h.respuestas}`);
    }
    await expectReglasDelProducto(page, "el resultado con el formulario de contacto");
  });

  await test.step("criterio 2: deja nombre, correo y la autorización: queda un Lead nuevo con su diagnóstico ligado", async () => {
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Tu nombre", { exact: true }).fill(NOMBRE_DEL_LEAD);
    await page.getByLabel("Tu correo", { exact: true }).fill(r.correoDelLead);
    await page.getByLabel("Tu teléfono (opcional)", { exact: true }).fill(r.telefonoDelLead);
    await page.getByLabel(AUTORIZO).check();
    await page.getByRole("button", { name: "Guardar mis datos" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Ya tenemos tu contacto" })).toBeVisible(ESPERA);

    const lead = await r.una<{ id: string; estado: string; version_autorizacion: string }>("lead", "id, estado, version_autorizacion", {
      correo: r.correoDelLead,
    });
    // HU-087: con la autorización nueva (v2) el monitor verá las preguntas.
    expect(lead).toMatchObject({ estado: "nuevo", version_autorizacion: "v2" });
    expect(await r.una("diagnostico", "id_lead", { id: idDiagnostico })).toEqual({ id_lead: lead.id });
  });

  await test.step("criterio 3: cierra la página, vuelve a la portada en el mismo navegador y ve su último diagnóstico", async () => {
    const contexto = page.context();
    await page.close();
    page = await contexto.newPage();
    await page.goto("/");
    await expect(titulo(page, "Tu último diagnóstico")).toBeVisible(ESPERA);
    await expect(page.locator("main")).toContainText(`Respondiste ${pasos.length} preguntas`);
    await page.waitForLoadState("networkidle");
    await expectReglasDelProducto(page, "la portada al volver");
    const verMonitores = page.getByRole("link", { name: `Ver monitores de ${banco.nombreA}`, exact: true });
    await expect(verMonitores).toHaveAttribute("href", `/monitores?materia=${encodeURIComponent(banco.codigoA)}`);
    await verMonitores.click();
    await expect(page).toHaveURL(`/monitores?materia=${encodeURIComponent(banco.codigoA)}`, ESPERA);
  });

  let idMonitoria = "";
  await test.step("criterio 5: con ese Lead agenda y paga una fecha de la materia; la monitoría apunta a su diagnóstico", async () => {
    await abrirLaFecha(r, page, banco.codigoA);
    // Ya es Lead: la confirmación no le pide los datos otra vez.
    await expect(page.getByRole("link", { name: "Dejar mis datos y seguir" })).toHaveCount(0);
    idMonitoria = await apartarYPagar(r, page);
    expect(await r.una("monitoria", "id_diagnostico, id_materia", { id: idMonitoria })).toEqual({
      id_diagnostico: idDiagnostico,
      id_materia: banco.idMateriaA,
    });
  });

  await test.step("criterio 6: el monitor abre el diagnóstico desde su agenda: todas las preguntas, la elegida, la correcta y la solución", async () => {
    const monitor = await r.entrar(r.monitor, "/monitor/agenda");
    const tarjeta = monitor.getByRole("listitem").filter({ hasText: `Agendó: ${NOMBRE_DEL_LEAD}` });
    await expect(tarjeta).toHaveCount(1, ESPERA);
    await expectReglasDelProducto(monitor, "la agenda del monitor");
    await tarjeta.getByRole("link", { name: TEXTOS.verDiagnostico, exact: true }).click();
    await expect(monitor).toHaveURL(`/monitor/agenda/${idMonitoria}`, ESPERA);
    await expect(titulo(monitor, `Diagnóstico de ${NOMBRE_DEL_LEAD}`)).toBeVisible(ESPERA);
    await expect(monitor.getByText(TEXTOS.noAutorizo)).toHaveCount(0);

    const preguntas = monitor.getByRole("region", { name: TEXTOS.preguntas, exact: true });
    await expect(preguntas.locator(":scope > ol > li")).toHaveCount(pasos.length);
    for (const [i, paso] of pasos.entries()) {
      const pregunta = preguntaDelDetalle(preguntas, i);
      await expect(pregunta.getByRole("heading", { level: 3 }), `pregunta ${i + 1}`).toHaveText(
        `Pregunta ${i + 1} ${paso.acerto ? TEXTOS.acerto : TEXTOS.fallo}`,
      );
      await expect(pregunta.locator(":scope > div").first(), `enunciado de la pregunta ${i + 1}`).toHaveText(plano(paso.pregunta.enunciado));
      const filas = pregunta.locator(":scope > ul > li");
      await expect(filas.filter({ hasText: new RegExp(TEXTOS.eligio) }), `la elegida en la pregunta ${i + 1}`).toContainText(paso.elegida.plano);
      await expect(filas.filter({ hasText: new RegExp(TEXTOS.correcta) }), `la correcta en la pregunta ${i + 1}`).toContainText(paso.laCorrecta.plano);
      if (paso.pregunta.solucion) {
        await expect(pregunta.getByRole("heading", { level: 4, name: TEXTOS.solucion })).toHaveCount(1);
        await expect(pregunta.locator(":scope > div").nth(1), `solución de la pregunta ${i + 1}`).toContainText(plano(paso.pregunta.solucion));
      }
    }

    // P-37: ni el correo ni el teléfono del estudiante, en la pantalla ni en el HTML.
    for (const fuente of [await monitor.locator("body").innerText(), await monitor.content()]) {
      expect(fuente).not.toContain(r.correoDelLead);
      expect(fuente).not.toContain(r.telefonoDelLead);
    }
    await expectReglasDelProducto(monitor, "el diagnóstico en el hub del monitor");
  });
});
