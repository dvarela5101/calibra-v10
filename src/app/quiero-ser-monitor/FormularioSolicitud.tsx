"use client";

import { useActionState, useState } from "react";
import { CasillasConsentimiento } from "@/components/CasillasConsentimiento";
import casillas from "@/components/casillas.module.css";
import formulario from "@/components/formulario.module.css";
import { CAMPO_MATERIAS, CAMPO_OTRA, CAMPO_OTRA_MATERIA, CAMPO_TRAMPA, LARGO_MAXIMO_OTRA_MATERIA } from "@/lib/solicitudes/reglas";
import { enviarSolicitud, type EstadoSolicitud } from "./acciones";
import estilos from "./solicitud.module.css";

export type MateriaParaElegir = { id: string; nombre: string };

const estadoInicial: EstadoSolicitud = {
  error: null,
  enviada: false,
  valores: { nombre: "", correo: "", numero_telefono: "", materias: [], otra: false, otra_materia: "", autorizado: false },
};

/** HU-062: nombre, teléfono, correo y una o varias materias, con la autorización de datos (RN-13). HU-111: o una «Otra» escrita. */
export function FormularioSolicitud({ materias }: { materias: MateriaParaElegir[] }) {
  const [estado, accion, enviando] = useActionState(enviarSolicitud, estadoInicial);
  const { valores } = estado;
  // La llave remonta los campos cuando cambian los valores devueltos (React vacía el formulario al enviar).
  const llave = JSON.stringify(valores);

  if (estado.enviada) {
    return (
      <section role="status" className={estilos.confirmacion} aria-labelledby="solicitud-recibida">
        <h2 id="solicitud-recibida" className={estilos.confirmacionTitulo}>
          Recibimos tu solicitud
        </h2>
        <p>
          Te vamos a contactar por teléfono o por correo para agendar tu evaluación presencial. Si la apruebas, te
          enviamos el enlace para crear tu cuenta de monitor.
        </p>
      </section>
    );
  }

  return (
    <form key={llave} action={accion} className={formulario.formulario} noValidate>
      <div className={formulario.campo}>
        <label htmlFor="nombre" className={formulario.etiqueta}>
          Tu nombre
        </label>
        <input id="nombre" name="nombre" autoComplete="name" defaultValue={valores.nombre} required className={formulario.entrada} />
      </div>

      <div className={formulario.campo}>
        <label htmlFor="numero_telefono" className={formulario.etiqueta}>
          Tu teléfono
        </label>
        <p id="telefono-ayuda" className={formulario.ayuda}>
          Con indicativo, por ejemplo +57 300 123 4567. Sin indicativo, se toma el de Colombia.
        </p>
        <input
          id="numero_telefono"
          name="numero_telefono"
          type="tel"
          autoComplete="tel"
          defaultValue={valores.numero_telefono}
          aria-describedby="telefono-ayuda"
          required
          className={formulario.entrada}
        />
      </div>

      <div className={formulario.campo}>
        <label htmlFor="correo" className={formulario.etiqueta}>
          Tu correo
        </label>
        <input
          id="correo"
          name="correo"
          type="email"
          autoComplete="email"
          defaultValue={valores.correo}
          required
          className={formulario.entrada}
        />
      </div>

      <fieldset className={casillas.grupo}>
        <legend className={casillas.leyenda}>Materias en las que quieres certificarte</legend>
        {materias.map((materia) => (
          <div key={materia.id} className={casillas.casilla}>
            <input
              id={`materia-${materia.id}`}
              name={CAMPO_MATERIAS}
              type="checkbox"
              value={materia.id}
              defaultChecked={valores.materias.includes(materia.id)}
              className={casillas.control}
            />
            <label htmlFor={`materia-${materia.id}`} className={casillas.texto}>
              {materia.nombre}
            </label>
          </div>
        ))}
        <OtraMateria marcada={valores.otra} texto={valores.otra_materia} />
      </fieldset>

      <CasillasConsentimiento variante="aspirante" tratamientoMarcado={valores.autorizado} />

      {/* Campo trampa: fuera de la vista, del teclado y de los lectores de pantalla. Solo lo llena un programa. */}
      <div className={estilos.trampa} aria-hidden="true">
        <label htmlFor={CAMPO_TRAMPA}>Sitio web</label>
        <input id={CAMPO_TRAMPA} name={CAMPO_TRAMPA} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      {estado.error && (
        <p role="alert" className={formulario.error}>
          {estado.error}
        </p>
      )}

      <button type="submit" className={formulario.boton} disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar solicitud"}
      </button>
    </form>
  );
}

/**
 * HU-111 (D-80): la casilla «Otra» y, al marcarla, el campo para escribir esa materia. Desmarcada, el campo no está
 * y no se envía. Vive dentro del formulario, así que se remonta con él y arranca con lo que la persona ya había escrito.
 */
function OtraMateria({ marcada, texto }: { marcada: boolean; texto: string }) {
  const [otra, setOtra] = useState(marcada);
  return (
    <>
      <div className={casillas.casilla}>
        <input
          id={CAMPO_OTRA}
          name={CAMPO_OTRA}
          type="checkbox"
          value="si"
          checked={otra}
          onChange={(evento) => setOtra(evento.target.checked)}
          aria-controls={otra ? CAMPO_OTRA_MATERIA : undefined}
          className={casillas.control}
        />
        <label htmlFor={CAMPO_OTRA} className={casillas.texto}>
          Otra
        </label>
      </div>
      {otra && (
        <div className={formulario.campo}>
          <label htmlFor={CAMPO_OTRA_MATERIA} className={formulario.etiqueta}>
            ¿Qué materia?
          </label>
          <p id="otra-materia-ayuda" className={formulario.ayuda}>
            Escribe el nombre como lo conoces en tu universidad.
          </p>
          <input
            id={CAMPO_OTRA_MATERIA}
            name={CAMPO_OTRA_MATERIA}
            defaultValue={texto}
            maxLength={LARGO_MAXIMO_OTRA_MATERIA}
            aria-describedby="otra-materia-ayuda"
            required
            className={formulario.entrada}
          />
        </div>
      )}
    </>
  );
}
