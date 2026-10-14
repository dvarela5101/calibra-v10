import { lineaDeEstudios, parrafos, type DatosDelPerfil } from "@/lib/monitores/perfil";
import estilos from "./perfil.module.css";

/**
 * HU-049: lo que el monitor cuenta de sí en su tarjeta de `/monitores` y en la vista previa de su perfil. Todo va como
 * texto de React (nunca `dangerouslySetInnerHTML`): un `<script>` o un `<b>` se ven tal cual. Cada línea de la
 * presentación es un párrafo. Sin perfil no pinta nada.
 */
export function PerfilDelMonitor({ perfil }: { perfil: DatosDelPerfil | null | undefined }) {
  if (!perfil) return null;
  const estudios = lineaDeEstudios(perfil);
  const presentacion = parrafos(perfil.presentacion);
  if (!estudios && presentacion.length === 0) return null;
  return (
    <div className={estilos.perfil}>
      {estudios && <p className={estilos.estudios}>{estudios}</p>}
      {presentacion.map((parrafo, indice) => (
        <p key={indice} className={estilos.parrafo}>
          {parrafo}
        </p>
      ))}
    </div>
  );
}
