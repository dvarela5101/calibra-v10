"use client";

import { useActionState, useState } from "react";
import formulario from "@/components/formulario.module.css";
import { AVISO_DEL_CODIGO, AYUDA_DEL_CODIGO, GUARDAR_FALLO, normalizarCodigo } from "@/lib/materias/reglas";
import { crear, guardar, type EstadoMateria } from "./acciones";
import estilos from "./materias.module.css";
import { sinCaerse } from "./sinCaerse";

const estadoInicial: EstadoMateria = { errores: {}, error: null, exito: null, valores: {} };

/** Si la red falla, el error general y lo que la persona había escrito. */
const conLoEscrito = (datos: FormData): EstadoMateria => ({
  errores: {},
  error: GUARDAR_FALLO,
  exito: null,
  valores: { nombre: String(datos.get("nombre") ?? ""), codigo: String(datos.get("codigo") ?? "") },
});

const crearSinCaerse = sinCaerse(crear, (_anterior, datos) => conLoEscrito(datos));
const guardarSinCaerse = sinCaerse(guardar, (_anterior, datos) => conLoEscrito(datos));

type Props = { modo: "crear" } | { modo: "editar"; materia: { id: string; nombre: string; codigo: string } };

/**
 * HU-055: crear una materia (`/admin/materias`) o corregir su nombre y su código (`/admin/materias/[id]`), con el patrón
 * de `FormularioCertificar`. Al editar, en cuanto el código difiere del guardado avisa que los enlaces con el código
 * anterior dejarán de encontrar la materia (supuesto 9.S9: es un aviso, no un paso de confirmación).
 */
export function FormularioMateria(props: Props) {
  const materia = props.modo === "editar" ? props.materia : null;
  const [estado, accion, enviando] = useActionState(materia ? guardarSinCaerse : crearSinCaerse, estadoInicial);
  const nombre = estado.valores.nombre ?? materia?.nombre ?? "";
  const codigo = estado.valores.codigo ?? materia?.codigo ?? "";
  // La llave remonta los campos cuando cambian los valores devueltos (React vacía el formulario al enviar).
  // Solo los campos: el botón no se remonta, así no pierde el foco después de un error.
  const llave = JSON.stringify(estado.valores);
  const prefijo = materia ? "materia" : "nueva-materia";

  return (
    <form action={accion} className={formulario.formulario} noValidate>
      {materia && <input type="hidden" name="id" value={materia.id} />}
      <div key={llave} className={estilos.campos}>
        <div className={formulario.campo}>
          <label htmlFor={`${prefijo}-nombre`} className={formulario.etiqueta}>
            Nombre
          </label>
          <input
            id={`${prefijo}-nombre`}
            name="nombre"
            type="text"
            defaultValue={nombre}
            autoComplete="off"
            required
            aria-invalid={estado.errores.nombre ? true : undefined}
            aria-describedby={estado.errores.nombre ? `${prefijo}-nombre-error` : undefined}
            className={formulario.entrada}
          />
          {estado.errores.nombre && (
            <p id={`${prefijo}-nombre-error`} role="alert" className={formulario.error}>
              {estado.errores.nombre}
            </p>
          )}
        </div>

        <CampoDelCodigo prefijo={prefijo} inicial={codigo} guardado={materia?.codigo} error={estado.errores.codigo} />
      </div>

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
        {materia ? (enviando ? "Guardando…" : "Guardar cambios") : enviando ? "Creando…" : "Crear materia"}
      </button>
    </form>
  );
}

/** El campo del código. Recuerda lo que se va escribiendo para avisar, antes de guardar, que cambiar el código afecta los enlaces. */
export function CampoDelCodigo({ prefijo, inicial, guardado, error }: { prefijo: string; inicial: string; guardado: string | undefined; error: string | undefined }) {
  const [escrito, setEscrito] = useState(inicial);
  const cambia = guardado !== undefined && normalizarCodigo(escrito) !== normalizarCodigo(guardado);
  const descripcion = [`${prefijo}-codigo-ayuda`, error && `${prefijo}-codigo-error`, cambia && `${prefijo}-codigo-aviso`].filter(Boolean).join(" ");

  return (
    <div className={formulario.campo}>
      <label htmlFor={`${prefijo}-codigo`} className={formulario.etiqueta}>
        Código
      </label>
      <p id={`${prefijo}-codigo-ayuda`} className={formulario.ayuda}>
        {AYUDA_DEL_CODIGO}
      </p>
      <input
        id={`${prefijo}-codigo`}
        name="codigo"
        type="text"
        defaultValue={inicial}
        onChange={(evento) => setEscrito(evento.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={descripcion}
        className={formulario.entrada}
      />
      {error && (
        <p id={`${prefijo}-codigo-error`} role="alert" className={formulario.error}>
          {error}
        </p>
      )}
      {cambia && (
        <p id={`${prefijo}-codigo-aviso`} role="status" className={estilos.aviso}>
          {AVISO_DEL_CODIGO}
        </p>
      )}
    </div>
  );
}
