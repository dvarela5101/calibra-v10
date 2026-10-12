"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Pantalla } from "@/components/Pantalla";
import type { Letra } from "@/lib/diagnostico/motor";
import {
  llamarSinCaerse,
  siguientePantalla,
  type EventoDelRecorrido,
  type MateriaConEvaluaciones,
  type PantallaDelRecorrido,
} from "@/lib/diagnostico/pantalla";
import { TEXTOS, textoDeAvance } from "@/lib/diagnostico/presentacion";
import { empezarDiagnostico, responderPregunta } from "./acciones";
import estilos from "./diagnostico.module.css";
import { ID_DEL_ENUNCIADO, Pregunta } from "./Pregunta";
import { SelectorDeMateria } from "./SelectorDeMateria";
import { SinPreguntasNuevas } from "./SinPreguntasNuevas";

type Props = {
  /** Lo que ve la persona al cargar: la pregunta pendiente si hay un diagnóstico en curso, y si no el selector. */
  inicial: PantallaDelRecorrido;
  materias: MateriaConEvaluaciones[];
};

/**
 * HU-009: guarda en qué pantalla va la persona (selector, pregunta o el mensaje de D-51) y llama a las dos Server Actions. El
 * servidor manda y este componente solo pinta: no elige, no califica y no guarda nada. Las transiciones son una función pura
 * (`siguientePantalla`).
 *
 * Una llamada a la vez: mientras hay una en curso, o ya se está yendo al resultado, los botones quedan deshabilitados. Un fallo
 * de la red es el mismo `error` que uno del servidor. Al llegar a una pantalla por una transición, el foco pasa al enunciado de
 * la pregunta o al título; al cargar o recargar la página no se mueve.
 */
export function Recorrido({ inicial, materias }: Props) {
  const router = useRouter();
  const [pantalla, setPantalla] = useState(inicial);
  const [pendiente, iniciarLlamada] = useTransition();
  // Con `terminado` se navega al resultado y los botones siguen deshabilitados hasta que la página cambie.
  const [navegando, setNavegando] = useState(false);
  const llamando = useRef(false);
  const raiz = useRef<HTMLDivElement>(null);
  const ocupado = pendiente || navegando;

  useEffect(() => {
    if (!pantalla.enfocar) return;
    if (pantalla.tipo === "pregunta") {
      raiz.current?.querySelector<HTMLElement>(`#${ID_DEL_ENUNCIADO}`)?.focus();
      return;
    }
    // `Pantalla` es compartida y no deja pasar `ref` ni `tabIndex` al h1: se le da el foco desde aquí, sin tocarla.
    const titulo = raiz.current?.querySelector("h1");
    titulo?.setAttribute("tabindex", "-1");
    titulo?.focus();
  }, [pantalla]);

  function aplicar(evento: EventoDelRecorrido) {
    setPantalla((actual) => siguientePantalla(actual, evento));
  }

  function empezar(idEvaluacion: string, volverATomar: boolean) {
    if (llamando.current) return;
    llamando.current = true;
    iniciarLlamada(async () => {
      const respuesta = await llamarSinCaerse(() => empezarDiagnostico({ idEvaluacion, volverATomar }), TEXTOS.errorAlEmpezar);
      llamando.current = false;
      aplicar({ tipo: "empezo", idEvaluacion, respuesta });
      // La lista de Evaluaciones que llegó con la página ya no vale: se pide de nuevo.
      if (respuesta.tipo === "no_disponible") router.refresh();
    });
  }

  function responder(enCurso: { idDiagnostico: string; paso: number }, letra: Letra) {
    if (llamando.current) return;
    llamando.current = true;
    iniciarLlamada(async () => {
      const respuesta = await llamarSinCaerse(
        () => responderPregunta({ idDiagnostico: enCurso.idDiagnostico, paso: enCurso.paso, letra }),
        TEXTOS.errorAlResponder,
      );
      if (respuesta.tipo === "terminado") {
        // `llamando` queda en alto a propósito: no se responde otra vez mientras se navega.
        setNavegando(true);
        router.push(respuesta.ruta);
        return;
      }
      llamando.current = false;
      aplicar({ tipo: "respondio", respuesta });
    });
  }

  if (pantalla.tipo === "pregunta") {
    const { enCurso } = pantalla;
    return (
      <div ref={raiz}>
        <Pantalla eyebrow={`${enCurso.materia.nombre} · ${enCurso.evaluacion.nombre}`} titulo={TEXTOS.tituloDeLaPregunta}>
          {/* La región viva va fuera de la parte que se remonta: es el mismo elemento en cada pregunta y solo cambia su texto. */}
          <p className={estilos.avance} aria-live="polite" aria-atomic="true">
            {textoDeAvance(enCurso.paso, enCurso.maximo)}
          </p>
          <Pregunta
            key={`${enCurso.idDiagnostico}:${enCurso.paso}`}
            enCurso={enCurso}
            mensaje={pantalla.mensaje}
            ocupado={ocupado}
            alResponder={(letra) => responder(enCurso, letra)}
            alCambiarDeMateria={() => aplicar({ tipo: "cambiar_materia" })}
          />
        </Pantalla>
      </div>
    );
  }

  if (pantalla.tipo === "sin_preguntas") {
    const { idEvaluacion, ultimo } = pantalla;
    return (
      <div ref={raiz}>
        <Pantalla eyebrow={ultimo?.materia.nombre ?? TEXTOS.eyebrow} titulo={TEXTOS.tituloSinPreguntas}>
          <SinPreguntasNuevas
            ultimo={ultimo}
            mensaje={pantalla.mensaje}
            pendiente={pendiente}
            ocupado={ocupado}
            alVolverATomar={() => empezar(idEvaluacion, true)}
            alNo={() => aplicar({ tipo: "no" })}
          />
        </Pantalla>
      </div>
    );
  }

  return (
    <div ref={raiz}>
      <Pantalla eyebrow={TEXTOS.eyebrow} titulo={TEXTOS.tituloDelSelector} subtitulo={TEXTOS.subtituloDelSelector}>
        <SelectorDeMateria
          materias={materias}
          enCurso={pantalla.enCurso}
          mensaje={pantalla.mensaje}
          pendiente={pendiente}
          ocupado={ocupado}
          alEmpezar={(idEvaluacion) => empezar(idEvaluacion, false)}
        />
      </Pantalla>
    </div>
  );
}
