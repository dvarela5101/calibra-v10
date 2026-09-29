import { cerrarSesion } from "@/lib/auth/acciones";
import formulario from "./formulario.module.css";

export function BotonSalir() {
  return (
    <form action={cerrarSesion} className={formulario.formulario}>
      <button type="submit" className={formulario.botonSecundario}>
        Cerrar sesión
      </button>
    </form>
  );
}
