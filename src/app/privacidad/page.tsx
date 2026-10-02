import type { Metadata } from "next";
import { connection } from "next/server";
import { Pantalla } from "@/components/Pantalla";
import { formatearDia } from "@/lib/fechas";
import { AVISO_ACTUALIZADO, correoConsultasDatos } from "@/lib/privacidad/consentimiento";
import estilos from "./privacidad.module.css";

export const metadata: Metadata = { title: "Aviso de privacidad · Calibra" };

// Fuera del grupo (publico): leer el aviso no crea una sesión anónima.
// Texto de HU-008 con las decisiones R-1 y P-13 (29-sep-2026), lo que ven los estudiantes de un monitor (D-6, HU-069),
// las reseñas y Cloudflare Turnstile (D-31, HU-073).
// El texto legal final lo valida el equipo. Cada cambio del texto actualiza AVISO_ACTUALIZADO.
export default async function AvisoPrivacidad() {
  // El correo de consultas se lee al pedir la página: cambiarlo en Vercel no exige otro build.
  await connection();
  const correo = correoConsultasDatos();

  return (
    <Pantalla
      eyebrow="Ley 1581 de 2012"
      titulo="Aviso de privacidad"
      subtitulo="Cómo trata Calibra tus datos personales y qué puedes hacer con ellos."
    >
      <div className={estilos.aviso}>
        <p className={estilos.actualizado}>Última actualización: {formatearDia(AVISO_ACTUALIZADO)}.</p>

        <section aria-labelledby="responsable">
          <h2 id="responsable">Responsable del tratamiento</h2>
          <p>Calibra es la responsable del tratamiento de los datos personales que recoge en este sitio.</p>
        </section>

        <section aria-labelledby="datos">
          <h2 id="datos">Qué datos recogemos</h2>
          <ul>
            <li>Tus respuestas y el resultado de cada diagnóstico que tomes.</li>
            <li>Tu nombre, tu correo y, si quieres darlo, tu teléfono, cuando dejas tu contacto.</li>
            <li>El nombre y el contacto de quien paga una monitoría, y el comprobante de pago.</li>
            <li>
              Si quieres ser monitor: tu nombre, tu teléfono, tu correo y las materias en las que quieres certificarte.
            </li>
            <li>Si tienes cuenta de monitor: además, tu llave, para pagarte tus monitorías.</li>
            <li>La calificación y el comentario de cada monitoría que reseñes.</li>
          </ul>
        </section>

        <section aria-labelledby="finalidades">
          <h2 id="finalidades">Para qué los usamos</h2>
          <ul>
            <li>Mostrarte en qué subtema fallas y guardar tus diagnósticos.</li>
            <li>
              <strong>Compartir el resultado de tu diagnóstico con el monitor de tu monitoría</strong>, para que llegue a
              la sesión sabiendo por dónde empezar.
            </li>
            <li>Agendar tus monitorías, revisar tus pagos y tramitar reembolsos.</li>
            <li>Escribirte sobre tus citas, pagos y reembolsos.</li>
            <li>Si pediste ser monitor, contactarte para agendar y hacer tu evaluación presencial.</li>
            <li>
              Tu calificación y tu comentario de cada monitoría, para que otros escojan monitor y para mejorar el
              servicio.
            </li>
            <li>Enviarte novedades y ofertas, solo si lo autorizas aparte. Esa autorización es opcional.</li>
          </ul>
        </section>

        <section aria-labelledby="monitores">
          <h2 id="monitores">Si eres monitor</h2>
          <p>
            Cuando te certificas en una materia, tu nombre, tal como lo escribiste al crear tu cuenta, se muestra a
            estudiantes y visitantes en la lista de monitores de esa materia, junto con tus fechas libres y sus precios.
          </p>
          <p>Tu teléfono, tu correo y tu llave no se muestran a estudiantes ni a visitantes.</p>
        </section>

        <section aria-labelledby="seguridad">
          <h2 id="seguridad">Seguridad del sitio</h2>
          <p>
            Calibra usa Cloudflare Turnstile para verificar que quien visita el sitio es una persona y no un programa
            automático. Para eso, Cloudflare ve datos técnicos de tu navegador y de tu conexión.
          </p>
          <p>
            Cloudflare explica cómo trata esos datos en la{" "}
            <a
              href="https://www.cloudflare.com/turnstile-privacy-policy/"
              target="_blank"
              rel="noopener noreferrer"
              className={estilos.enlace}
            >
              adenda de privacidad de Cloudflare Turnstile (se abre en otra pestaña)
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="autorizacion">
          <h2 id="autorizacion">Tu autorización</h2>
          <p>
            Antes de dejar tu contacto te pedimos autorización expresa para tratar tus datos. Sin ella no guardamos tu
            contacto ni puedes agendar. Guardamos si autorizaste, la fecha en que lo hiciste y si aceptaste recibir
            novedades.
          </p>
        </section>

        <section aria-labelledby="derechos">
          <h2 id="derechos">Tus derechos</h2>
          <p>Como titular de tus datos puedes, en cualquier momento y sin costo:</p>
          <ul>
            <li>Conocer, actualizar y rectificar tus datos.</li>
            <li>Pedir prueba de la autorización que nos diste.</li>
            <li>Saber cómo hemos usado tus datos.</li>
            <li>Revocar tu autorización y pedir que borremos tus datos, cuando no haya un deber legal de conservarlos.</li>
            <li>Presentar quejas ante la Superintendencia de Industria y Comercio.</li>
          </ul>
        </section>

        <section aria-labelledby="consultas">
          <h2 id="consultas">Canal de consultas</h2>
          {correo ? (
            <p>
              Escríbenos a{" "}
              <a href={`mailto:${correo}`} className={estilos.enlace}>
                {correo}
              </a>
              . Respondemos las consultas en máximo 10 días hábiles y los reclamos en máximo 15 días hábiles.
            </p>
          ) : (
            <p>
              Pronto publicaremos aquí el correo para consultas sobre tus datos. Respondemos las consultas en máximo 10
              días hábiles y los reclamos en máximo 15 días hábiles.
            </p>
          )}
        </section>

        <section aria-labelledby="retencion">
          <h2 id="retencion">Cuánto tiempo los guardamos</h2>
          <ul>
            <li>Sesiones sin contacto: se borran a los 90 días sin actividad.</li>
            <li>
              Tu contacto: hasta que retires tu autorización o después de 24 meses sin actividad.
            </li>
            <li>Tu solicitud para ser monitor: igual que tu contacto, hasta que retires tu autorización o después de 24 meses sin actividad.</li>
            <li>Tus diagnósticos: se conservan mientras se conserve la sesión o el contacto al que pertenecen.</li>
            <li>Comprobantes de pago: 5 años.</li>
          </ul>
        </section>
      </div>
    </Pantalla>
  );
}
