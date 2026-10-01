"use client";

import { useActionState } from "react";
import { CasillasConsentimiento } from "@/components/CasillasConsentimiento";
import casillas from "@/components/casillas.module.css";
import formulario from "@/components/formulario.module.css";
import { CAMPO_MATERIAS, CAMPO_TRAMPA } from "@/lib/solicitudes/reglas";
import { enviarSolicitud, type EstadoSolicitud } from "./acciones";
import estilos from "./solicitud.module.css";

export type MateriaParaElegir = { id: string; nombre: string };

const estadoInicial: EstadoSolicitud = {
  error: null,
  enviada: false,
  valores: { nombre: "", correo: "", numero_telefono: "", materias: [], autorizado: false },
};

/** HU-062: nombre, teléfono, correo y una o varias materias, con la autorización de datos (RN-13). */
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
