import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// HU-135: la tarjeta que se ve al pegar el enlace en WhatsApp, Instagram o X. Fondo liso --bg, texto --text, la marca en --marca.
// La fuente es la de por defecto de ImageResponse: solo admite ttf, otf y woff, y Inter vive en el repo como woff2.
export const alt = "Calibra: monitorías de ciclo básico que empiezan por tu error";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Imagen() {
  const logo = await readFile(join(process.cwd(), "public", "logo.svg"));
  const logoUrl = `data:image/svg+xml;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fffdf5",
          color: "#0b1b33",
          padding: "72px 84px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse no usa next/image */}
          <img src={logoUrl} width={96} height={96} alt="" />
          <div style={{ fontSize: 72, fontWeight: 700, color: "#0057ed" }}>Calibra</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>Monitorías de ciclo básico que empiezan por tu error.</div>
          <div style={{ fontSize: 34, lineHeight: 1.3 }}>Un diagnóstico corto, y un monitor certificado que lo lee antes de la sesión.</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
