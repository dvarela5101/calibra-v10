import { describe, expect, it } from "vitest";
import { entradaDeLaFila, VERSION_DEL_CONTEXTO, type FilaEnCurso } from "../src/lib/diagnostico/entrada";
import { LETRAS } from "../src/lib/diagnostico/motor";
import { CAMPOS_SIN_CENTINELA, centinelasDeLasRespuestas, respuestasConCentinelas } from "./respuestas-con-centinelas";

// Las copias con centinelas (HU-011) son datos de prueba que se siembran en `diagnostico.respuestas`: tienen que ser tan válidas
// como las que guarda `terminar_diagnostico` (HU-081) y cada campo que no puede llegar al navegador tiene que llevar un texto
// que solo aparece una vez, o la e2e no sabría de dónde salió una fuga.

const CANTIDAD = 8;

describe("respuestasConCentinelas", () => {
  it("cada copia pasa por la lectura de pasos de HU-081 (entradaDeLaFila)", () => {
    const fila: FilaEnCurso = {
      id: "d1a90000-0000-4000-8000-0000000000aa",
      id_sesion: "d1a90000-0000-4000-8000-0000000000bb",
      id_evaluacion: "d1a90000-0000-4000-8000-0000000000cc",
      id_materia: "d1a90000-0000-4000-8000-0000000000dd",
      semilla: 4242,
      vistas_antes: [],
      repetido: false,
      candidatas: [],
      contexto: {
        version: VERSION_DEL_CONTEXTO,
        evaluacion: { id: "e", nombre: "Parcial" },
        materia: { id: "m", codigo: "M-1", nombre: "Materia" },
        habilidades: [],
        misconcepciones: [],
        descripcionesDeHabilidad: {},
      },
      pasos: respuestasConCentinelas(CANTIDAD),
      paso: CANTIDAD,
      iniciado_en: "2026-10-05T03:00:00.000Z",
      actualizado_en: "2026-10-05T03:00:00.000Z",
    };
    const leida = entradaDeLaFila(fila);
    expect(leida?.pasos).toHaveLength(CANTIDAD);
    expect(leida?.pasos).toEqual(respuestasConCentinelas(CANTIDAD));
  });

  it("cada pregunta tiene cuatro opciones, una sola correcta, una dificultad de 1 a 3 y un orden que es una permutación de A a D", () => {
    for (const copia of respuestasConCentinelas(CANTIDAD)) {
      expect(copia.opciones).toHaveLength(4);
      expect(copia.opciones.filter((opcion) => opcion.correcta)).toHaveLength(1);
      expect([1, 2, 3]).toContain(copia.dificultad);
      expect([...copia.orden].sort()).toEqual([...LETRAS]);
      expect(LETRAS).toContain(copia.letraElegida);
      for (const opcion of copia.opciones) {
        // La correcta no lleva misconcepción ni texto de error; las demás, las dos.
        expect(opcion.misconcepcion === null).toBe(opcion.correcta);
        expect(opcion.error === null).toBe(opcion.correcta);
      }
    }
  });

  it("la opción correcta cambia de posición de una pregunta a otra", () => {
    const posiciones = respuestasConCentinelas(CANTIDAD).map((copia) => copia.opciones.findIndex((opcion) => opcion.correcta));
    expect(new Set(posiciones).size).toBe(4);
  });

  it("los centinelas son únicos: ninguno es parte de otro ni se repite", () => {
    const centinelas = centinelasDeLasRespuestas(CANTIDAD);
    expect(new Set(centinelas).size).toBe(centinelas.length);
    for (const [i, uno] of centinelas.entries()) {
      for (const [j, otro] of centinelas.entries()) {
        if (i !== j) expect(otro.includes(uno), `«${uno}» está dentro de «${otro}»`).toBe(false);
      }
    }
  });

  it("hay un centinela por campo: clave, tema, enunciado, habilidad, solución y, por opción, texto, misconcepción y error", () => {
    // Por pregunta: la clave, el tema, el enunciado, la habilidad y la solución (5), el texto de las 4 opciones, la misconcepción de las
    // 3 incorrectas y su texto de error: 5 + 4 + 3 + 3 = 15.
    expect(centinelasDeLasRespuestas(CANTIDAD)).toHaveLength(CANTIDAD * 15);
  });

  it("los campos sin texto único son la dificultad y cuál opción es la correcta", () => {
    expect([...CAMPOS_SIN_CENTINELA]).toEqual(["dificultad", "correcta"]);
  });
});
