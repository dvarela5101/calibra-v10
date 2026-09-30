"use client";

import { useActionState, useState } from "react";
import formulario from "@/components/formulario.module.css";
import { DIAS, horaDeFin, nombreDelDia } from "@/lib/franjas/reglas";
import { abrirFranja, editarFranja, type EstadoFranja } from "./acciones";
import estilos from "./franjas.module.css";

export type ValoresDeFranja = {
  dia: string;
  hora: string;
  duracion_min: string;
  precio: string;
  modalidad: "presencial" | "virtual";
  lugar: string;
  enlace: string;
};

const VACIA: ValoresDeFranja = { dia: "1", hora: "", duracion_min: "60", precio: "", modalidad: "presencial", lugar: "", enlace: "" };

type Props =
  | { modo: "abrir" }
  | {
      modo: "editar";
      id: string;
      iniciales: ValoresDeFranja;
      /** Con monitorías no se cambian día, hora ni duración (P-30). */
      horarioFijo: boolean;
      /** Con monitorías futuras no se cambia la modalidad. */
      modalidadFija: boolean;
    };

export function FormularioFranja(props: Props) {
  const accion = props.modo === "abrir" ? abrirFranja : editarFranja;
  const [estado, enviar, enviando] = useActionState<EstadoFranja, FormData>(accion, { error: null, exito: null, valores: {} });
  const iniciales = props.modo === "editar" ? props.iniciales : VACIA;
  // Tras un error se muestra lo que la persona escribió; si no, lo guardado.
  const valor = (campo: keyof ValoresDeFranja) => estado.valores[campo] ?? iniciales[campo];
  const [modalidad, setModalidad] = useState<"presencial" | "virtual">(iniciales.modalidad);
  const horarioFijo = props.modo === "editar" && props.horarioFijo;
  const modalidadFija = props.modo === "editar" && props.modalidadFija;
  // La llave remonta los campos cuando cambian los valores devueltos (React vacía el formulario al enviar).
  const llave = JSON.stringify(estado.valores);

  return (
    <form action={enviar} className={formulario.formulario} noValidate key={llave}>
      {props.modo === "editar" && <input type="hidden" name="id" value={props.id} />}

      {horarioFijo ? (
        <>
          <input type="hidden" name="dia" value={iniciales.dia} />
          <input type="hidden" name="hora" value={iniciales.hora} />
          <input type="hidden" name="duracion_min" value={iniciales.duracion_min} />
          <p className={formulario.ayuda}>
            {nombreDelDia(Number(iniciales.dia))}, de {iniciales.hora} a {horaDeFin(iniciales.hora, Number(iniciales.duracion_min))}.
            Como ya tiene monitorías, el día, la hora y la duración no se cambian: para otro horario, ciérrala y abre otra. Si el horario nuevo se cruza con el de esta franja, podrás abrirlo cuando esta ya esté cerrada.
          </p>
        </>
      ) : (
        <>
          <div className={formulario.campo}>
            <label htmlFor="dia" className={formulario.etiqueta}>
              Día de la semana
            </label>
            <select id="dia" name="dia" defaultValue={valor("dia")} className={formulario.entrada}>
              {DIAS.map((nombre, indice) => (
                <option key={nombre} value={indice + 1}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
          <div className={estilos.par}>
            <div className={formulario.campo}>
              <label htmlFor="hora" className={formulario.etiqueta}>
                Hora de inicio
              </label>
              <input id="hora" name="hora" type="time" step={300} defaultValue={valor("hora")} required className={formulario.entrada} />
            </div>
            <div className={formulario.campo}>
              <label htmlFor="duracion_min" className={formulario.etiqueta}>
                Duración (minutos)
              </label>
              <input
                id="duracion_min"
                name="duracion_min"
                type="number"
                inputMode="numeric"
                min={5}
                step={5}
                defaultValue={valor("duracion_min")}
                required
                className={formulario.entrada}
              />
            </div>
          </div>
        </>
      )}

      <div className={formulario.campo}>
        <label htmlFor="precio" className={formulario.etiqueta}>
          Precio por persona (pesos)
        </label>
        <p id="precio-ayuda" className={formulario.ayuda}>
          Sin decimales. Las monitorías que ya te agendaron conservan el precio que tenían.
        </p>
        <input
          id="precio"
          name="precio"
          type="text"
          inputMode="numeric"
          defaultValue={valor("precio")}
          aria-describedby="precio-ayuda"
          required
          className={formulario.entrada}
        />
      </div>

      {/* Fuera del fieldset: uno deshabilitado no envía sus campos, tampoco los ocultos. */}
      {modalidadFija && <input type="hidden" name="modalidad" value={iniciales.modalidad} />}
      <fieldset className={estilos.grupo} disabled={modalidadFija}>
        <legend className={formulario.etiqueta}>Modalidad</legend>
        {(["presencial", "virtual"] as const).map((opcion) => (
          <label key={opcion} className={estilos.opcion}>
            <input
              type="radio"
              name="modalidad"
              value={opcion}
              checked={modalidad === opcion}
              onChange={() => setModalidad(opcion)}
              className={estilos.radio}
            />
            {opcion === "presencial" ? "Presencial" : "Virtual"}
          </label>
        ))}
        {modalidadFija && (
          <p className={formulario.ayuda}>Tiene monitorías agendadas: la modalidad no cambia hasta que pasen.</p>
        )}
      </fieldset>

      {modalidad === "presencial" ? (
        <div className={formulario.campo}>
          <label htmlFor="lugar" className={formulario.etiqueta}>
            Lugar
          </label>
          <input
            id="lugar"
            name="lugar"
            type="text"
            placeholder="Edificio y salón"
            defaultValue={valor("lugar")}
            required
            className={formulario.entrada}
          />
        </div>
      ) : (
        <div className={formulario.campo}>
          <label htmlFor="enlace" className={formulario.etiqueta}>
            Enlace de la videollamada
          </label>
          <input
            id="enlace"
            name="enlace"
            type="url"
            inputMode="url"
            placeholder="https://"
            defaultValue={valor("enlace")}
            required
            className={formulario.entrada}
          />
        </div>
      )}

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}
      {estado.exito && (
        <p role="status" className={formulario.exito}>
          {estado.exito}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Guardando…" : props.modo === "abrir" ? "Abrir franja" : "Guardar cambios"}
      </button>
    </form>
  );
}
