import { describe, expect, it } from "vitest";
import { entradaDeLaFila, VERSION_DEL_CONTEXTO, type FilaEnCurso } from "@/lib/diagnostico/entrada";
import { LETRAS, opcionDeLetra, opcionElegida, paraNavegador, type Letra } from "@/lib/diagnostico/motor";
import {
  aciertosDe,
  copiaDePaso,
  copiasDe,
  filaDeDiagnosticoConRespuestas,
  habilidadesSembradas,
  permutacionesDeLasLetras,
  planDeEjemplo,
  planDeLas96,
  preguntaEsperada,
  preguntasEsperadas,
  resultadoGuardadoSembrado,
  SEMILLA_SEMBRADA,
  textosDeErrorDeLasQueNoEligio,
  valoresInternos,
} from "./respuestas-sembradas";

// HU-022: las copias que fabrica `pruebas/respuestas-sembradas.ts` tienen la forma real que guarda HU-081 y lo que dicen que el
// monitor debe ver coincide con las funciones del motor. Si el fixture se apartara de la forma real, la integración y la e2e
// probarían otra cosa.

const MARCA = "m0022";

/** Una fila en curso mínima con esos pasos: lo que lee `entradaDeLaFila` de HU-081. */
function filaConPasos(pasos: unknown): FilaEnCurso {
  return {
    id: "fila-de-prueba",
    id_sesion: "sesion-de-prueba",
    id_evaluacion: "evaluacion-de-prueba",
    id_materia: "materia-de-prueba",
    semilla: 1,
    vistas_antes: [],
    repetido: false,
    candidatas: [],
    contexto: {
      version: VERSION_DEL_CONTEXTO,
      evaluacion: { id: "evaluacion-de-prueba", nombre: "Parcial de prueba" },
      materia: { id: "materia-de-prueba", codigo: "ZZ-0022", nombre: "Materia de prueba" },
      habilidades: [],
      misconcepciones: [],
      descripcionesDeHabilidad: {},
    },
    pasos,
    paso: Array.isArray(pasos) ? pasos.length : 0,
    iniciado_en: "2026-10-05T04:00:00.000Z",
    actualizado_en: "2026-10-05T04:30:00.000Z",
  };
}

describe("las copias tienen la forma que guarda HU-081", () => {
  it("las 8 y las 96 pasan por entradaDeLaFila (cuatro opciones, orden que es una permutación, letra de A a D) y salen iguales", () => {
    for (const plan of [planDeEjemplo(), planDeLas96()]) {
      const copias = copiasDe(plan, MARCA);
      const leida = entradaDeLaFila(filaConPasos(JSON.parse(JSON.stringify(copias))));
      expect(leida).not.toBeNull();
      expect(leida!.pasos).toEqual(copias);
    }
  });

  it("una copia sin cuatro opciones o con un orden que no es una permutación no pasaría: entradaDeLaFila lo rechaza", () => {
    const copia = copiaDePaso(planDeEjemplo()[0], MARCA);
    expect(() => entradaDeLaFila(filaConPasos([{ ...copia, orden: ["A", "A", "B", "C"] }]))).toThrow(/permutaci/);
    expect(() => entradaDeLaFila(filaConPasos([{ ...copia, opciones: copia.opciones.slice(0, 3) }]))).toThrow(/4 opciones/);
  });

  it("cada copia trae las cuatro opciones en el orden del banco, con una sola correcta y la misconcepción y el error solo en las incorrectas", () => {
    for (const p of planDeEjemplo()) {
      const copia = copiaDePaso(p, MARCA);
      expect(copia.opciones).toHaveLength(4);
      expect(copia.opciones.filter((o) => o.correcta)).toHaveLength(1);
      LETRAS.forEach((letra, i) => {
        const opcion = copia.opciones[i];
        expect(opcion.correcta).toBe(letra === p.correctaDelBanco);
        expect(opcion.misconcepcion === null).toBe(opcion.correcta);
        expect(opcion.error === null).toBe(opcion.correcta);
      });
      expect(new Set(copia.opciones.map((o) => o.texto)).size, "el texto de cada opción es distinto").toBe(4);
    }
  });
});

describe("lo que el monitor debe ver coincide con el motor", () => {
  it("para los dos planes, el texto en la letra elegida es opcionElegida del motor, el de la correcta es la opción correcta y las opciones salen como paraNavegador", () => {
    for (const plan of [planDeEjemplo(), planDeLas96()]) {
      const copias = copiasDe(plan, MARCA);
      const esperadas = preguntasEsperadas(plan, MARCA);
      plan.forEach((p, i) => {
        const copia = copias[i];
        const esperada = esperadas[i];
        const textoEn = (letra: Letra) => esperada.opciones.find((o) => o.letra === letra)!.texto;
        expect(textoEn(esperada.letraElegida), `elegida de la pregunta ${p.numero}`).toBe(opcionElegida(copia).texto);
        expect(textoEn(esperada.letraCorrecta), `correcta de la pregunta ${p.numero}`).toBe(copia.opciones.find((o) => o.correcta)!.texto);
        expect(esperada.opciones, `opciones de la pregunta ${p.numero}`).toEqual(paraNavegador(copia, copia.orden).opciones);
        expect(esperada.letraElegida).toBe(copia.letraElegida);
        expect(esperada.acerto).toBe(esperada.letraElegida === esperada.letraCorrecta);
        expect(esperada.solucion).toBe(copia.solucion);
        expect(esperada.enunciado).toBe(copia.enunciado);
        // La letra del banco de la que vio en cada posición es la del orden.
        LETRAS.forEach((letra, posicion) => expect(opcionDeLetra(copia.orden, letra)).toBe(copia.orden[posicion]));
      });
    }
  });
});

describe("planDeEjemplo: ocho preguntas, tres falladas", () => {
  const plan = planDeEjemplo();

  it("falla la 2, la 4 y la 6 y acierta las otras cinco; la correcta del banco nunca es la A", () => {
    expect(plan).toHaveLength(8);
    expect(aciertosDe(plan)).toBe(5);
    expect(preguntasEsperadas(plan, MARCA).flatMap((p, i) => (p.acerto ? [] : [i + 1]))).toEqual([2, 4, 6]);
    expect(plan.filter((p) => p.correctaDelBanco === "A")).toEqual([]);
  });

  it("trae un ciclo de 4 cuya inversa es otra permutación, uno de 3, la identidad y la 3 y la 7 sin solución", () => {
    const ordenes = plan.map((p) => p.orden.join(""));
    expect(ordenes).toContain("CADB");
    expect(ordenes).toContain("BCAD");
    expect(ordenes).toContain("ABCD");
    // La inversa de CADB es BDAC: con ella, la opción de las cuatro posiciones sería otra.
    const inversa = LETRAS.map((letra) => LETRAS[["C", "A", "D", "B"].indexOf(letra)]).join("");
    expect(inversa).toBe("BDAC");
    expect(plan.filter((p) => p.solucion === null).map((p) => p.numero)).toEqual([3, 7]);
    expect(preguntasEsperadas(plan, MARCA).map((p) => p.solucion === null)).toEqual([false, false, true, false, false, false, true, false]);
  });

  it("en la mayoría, la letra que vio no es la del banco: ignorar el orden o usar la inversa daría otra opción", () => {
    const copias = copiasDe(plan, MARCA);
    const sinOrden = copias.filter((c) => c.opciones[LETRAS.indexOf(c.letraElegida)].texto !== opcionElegida(c).texto).length;
    expect(sinOrden).toBeGreaterThanOrEqual(5);
  });
});

describe("planDeLas96: las 24 permutaciones por las 4 letras", () => {
  const plan = planDeLas96();

  it("son 96 preguntas y 24 órdenes distintos, cada uno con las 4 letras vistas", () => {
    expect(permutacionesDeLasLetras()).toHaveLength(24);
    expect(plan).toHaveLength(96);
    expect(new Set(plan.map((p) => p.orden.join(""))).size).toBe(24);
    for (const orden of new Set(plan.map((p) => p.orden.join("")))) {
      const letras = plan.filter((p) => p.orden.join("") === orden).map((p) => preguntaEsperada(p, MARCA).letraElegida);
      expect(letras).toEqual(["A", "B", "C", "D"]);
    }
    expect(plan.map((p) => p.numero)).toEqual(Array.from({ length: 96 }, (_, i) => i + 1));
  });

  it("ignorar el orden cambia la opción elegida en 72 de los 96 casos y usar la permutación inversa, en 48 (hecho 24 del SPEC)", () => {
    const copias = copiasDe(plan, MARCA);
    const texto = (c: (typeof copias)[number], letraDelBanco: Letra) => c.opciones[LETRAS.indexOf(letraDelBanco)].texto;
    const cambiaSinOrden = copias.filter((c) => texto(c, c.letraElegida) !== opcionElegida(c).texto).length;
    const cambiaConLaInversa = copias.filter((c) => {
      const inversa = LETRAS.map((letra) => LETRAS[c.orden.indexOf(letra)]);
      return texto(c, inversa[LETRAS.indexOf(c.letraElegida)]) !== opcionElegida(c).texto;
    }).length;
    expect(cambiaSinOrden).toBe(72);
    expect(cambiaConLaInversa).toBe(48);
  });

  it("la correcta del banco recorre las cuatro letras, también la A", () => {
    expect(new Set(plan.map((p) => p.correctaDelBanco))).toEqual(new Set(LETRAS));
  });
});

describe("la fila de diagnostico", () => {
  const plan = planDeEjemplo();
  const resultado = resultadoGuardadoSembrado(MARCA);

  it("es completa: una copia por pregunta, semilla reconocible, aciertos, puntaje, repetido y marca de falta de material", () => {
    const fila = filaDeDiagnosticoConRespuestas({ idLead: "lead", idEvaluacion: "evaluacion", idMateria: "materia", plan, marca: MARCA, resultado });
    expect(fila).toMatchObject({
      id_lead: "lead",
      id_sesion_anonima: null,
      id_evaluacion: "evaluacion",
      id_materia: "materia",
      semilla: SEMILLA_SEMBRADA,
      aciertos: 5,
      puntaje: 62.5,
      repetido: false,
      fecha_realizacion: "2026-10-05T04:30:00.000Z",
    });
    expect(fila.respuestas).toHaveLength(8);
    expect(fila.resultado_por_habilidad).toBe(resultado);
    expect(fila.falta_material[0].motivos).toEqual(["sin_preguntas_sin_ver", "tope_una_respuesta"]);
    expect(SEMILLA_SEMBRADA).toBeLessThanOrEqual(4294967295);
  });

  it("necesita preguntas y un dueño (diagnostico_tiene_dueno), y lleva el repetido y la fecha que se le pida", () => {
    const base = { idEvaluacion: "e", idMateria: "m", marca: MARCA, resultado };
    expect(() => filaDeDiagnosticoConRespuestas({ ...base, idLead: "l", plan: [] })).toThrow(/al menos una pregunta/);
    expect(() => filaDeDiagnosticoConRespuestas({ ...base, plan })).toThrow(/sesión o un Lead/);
    const fila = filaDeDiagnosticoConRespuestas({ ...base, idSesionAnonima: "s", plan, repetido: true, fecha: "2026-10-06T10:00:00.000Z" });
    expect(fila).toMatchObject({ id_sesion_anonima: "s", id_lead: null, repetido: true, fecha_realizacion: "2026-10-06T10:00:00.000Z" });
  });

  it("el puntaje de 96 preguntas con 24 aciertos es 25, y el de una sola respuesta correcta, 100", () => {
    const base = { idLead: "l", idEvaluacion: "e", idMateria: "m", marca: MARCA, resultado };
    const todas = planDeLas96();
    expect(filaDeDiagnosticoConRespuestas({ ...base, plan: todas }).aciertos).toBe(aciertosDe(todas));
    expect(filaDeDiagnosticoConRespuestas({ ...base, plan: [planDeEjemplo()[0]] })).toMatchObject({ aciertos: 1, puntaje: 100 });
  });
});

describe("el resultado guardado y lo interno", () => {
  it("con 8 habilidades trae los cuatro niveles en el orden de la materia, y con 18 sigue siendo ese orden y trae más de cada nivel", () => {
    const ocho = habilidadesSembradas(MARCA);
    expect(ocho.map((h) => h.nivel)).toEqual(["lo_domina", "en_proceso", "no_lo_domina", "sin_medir", "no_lo_domina", "lo_domina", "en_proceso", "lo_domina"]);
    const dieciocho = habilidadesSembradas(MARCA, 18);
    expect(dieciocho).toHaveLength(18);
    expect(dieciocho.slice(0, 8)).toEqual(ocho);
    expect(new Set(dieciocho.map((h) => h.habilidad)).size).toBe(18);
    expect(new Set(dieciocho.map((h) => h.nivel))).toEqual(new Set(["lo_domina", "en_proceso", "no_lo_domina", "sin_medir"]));
    for (const h of dieciocho) {
      expect(h.aciertos).toBeLessThanOrEqual(h.respuestas);
      if (h.nivel === "sin_medir") expect(h.respuestas).toBe(0);
    }
  });

  it("los errores traen una sospecha guardada antes que la confirmada, esta con detalle y una fórmula, sospechas sin y con detalle, una habilidad ajena y una descripción caída a la clave", () => {
    const { errores } = resultadoGuardadoSembrado(MARCA, { detalleDeLaElegida: "Texto de la elegida" });
    expect(errores.map((e) => e.estado)).toEqual(["sospecha", "confirmada", "sospecha", "sospecha"]);
    const confirmada = errores[1];
    expect(confirmada.detalles).toEqual(["Texto de la elegida"]);
    expect(confirmada.texto).toContain("$");
    expect(errores[0].detalles).toEqual([]);
    expect(errores[2].detalles).toHaveLength(2);
    expect(errores[3].descripcionHabilidad).toBe(errores[3].habilidad);
  });

  it("los prerrequisitos guardados son cinco y al leerlos quedan cuatro: uno repetido, la misma clave en dos materias y la misma descripción con dos claves", () => {
    const { prerrequisitos } = resultadoGuardadoSembrado(MARCA);
    expect(prerrequisitos).toHaveLength(5);
    const llaves = new Set(prerrequisitos.map((p) => JSON.stringify([p.materia, p.habilidad])));
    expect(llaves.size).toBe(4);
    // La misma clave en dos materias distintas...
    const claveEnDosMaterias = prerrequisitos.filter((p) => p.habilidad.endsWith("-2"));
    expect(claveEnDosMaterias.map((p) => p.materia)).toEqual(["Cálculo Diferencial", "Precálculo"]);
    // La de la otra materia lleva una fórmula, para que se vea que su descripción se dibuja como las demás.
    expect(claveEnDosMaterias[1].descripcion).toContain("$");
    // ...y dos claves con la misma descripción.
    const mismaDescripcion = prerrequisitos.filter((p) => p.materia === null && p.descripcion === "despeja una incógnita");
    expect(new Set(mismaDescripcion.map((p) => p.habilidad)).size).toBe(2);
  });

  it("lo interno lleva la marca y la semilla, y los textos de error de las no elegidas son 2 por pregunta fallada y 3 menos por acertada", () => {
    const plan = planDeEjemplo();
    const internos = valoresInternos(plan, MARCA);
    expect(internos).toContain(String(SEMILLA_SEMBRADA));
    expect(internos).toContain(`clave-secreta-${MARCA}-p1`);
    // Una acertada deja 3 incorrectas sin elegir; una fallada, 2.
    expect(textosDeErrorDeLasQueNoEligio(plan, MARCA)).toHaveLength(5 * 3 + 3 * 2);
    // Nada de lo interno puede estar dentro de un texto que se ve.
    const visibles = preguntasEsperadas(plan, MARCA).flatMap((p) => [p.enunciado, p.solucion ?? "", ...p.opciones.map((o) => o.texto)]).join("\n");
    for (const interno of [...internos, ...textosDeErrorDeLasQueNoEligio(plan, MARCA)]) expect(visibles.includes(interno), interno).toBe(false);
  });
});
