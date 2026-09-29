#!/usr/bin/env python3
"""Backlog de Historias de Usuario (HU) basado en archivos markdown.

Cada HU vive en backlog/HU-XXX.md con frontmatter (estado, prioridad, dependencias).
Solo usa la biblioteca estandar de Python (3.8+).

Uso:
  python scripts/backlog.py new "Titulo de la HU" [-p P1] [-e M] [-d HU-001,HU-002]
  python scripts/backlog.py list [-s Lista] [--all]
  python scripts/backlog.py next            # muestra la siguiente HU elegible (no la inicia)
  python scripts/backlog.py take            # elige la siguiente y la pasa a "En progreso"
  python scripts/backlog.py show HU-003
  python scripts/backlog.py start HU-003
  python scripts/backlog.py review HU-003
  python scripts/backlog.py done HU-003 [-m "resumen de lo hecho"]
  python scripts/backlog.py block HU-003 -m "motivo"
  python scripts/backlog.py ready HU-003    # Backlog -> Lista
  python scripts/backlog.py log HU-003 "mensaje"
  python scripts/backlog.py index           # regenera BACKLOG.md
"""
import argparse
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HU_DIR = ROOT / "backlog"
INDEX = ROOT / "BACKLOG.md"
TEMPLATE = HU_DIR / "_plantilla.md"

ESTADOS = ["Backlog", "Lista", "En progreso", "En revision", "Bloqueada", "Hecha"]
PRIORIDADES = ["P0", "P1", "P2", "P3"]  # P0 = mas urgente
TALLAS = ["XS", "S", "M", "L", "XL"]

FM_RE = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.S)


def ahora():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def parse(path):
    text = path.read_text(encoding="utf-8")
    m = FM_RE.match(text)
    if not m:
        raise ValueError(f"{path.name}: falta frontmatter")
    meta = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        v = v.strip()
        if v.startswith("[") and v.endswith("]"):
            v = [x.strip() for x in v[1:-1].split(",") if x.strip()]
        meta[k.strip()] = v
    return meta, m.group(2)


def dump(path, meta, body):
    order = ["id", "titulo", "estado", "prioridad", "talla", "depende_de", "creada", "actualizada"]
    keys = [k for k in order if k in meta] + [k for k in meta if k not in order]
    lines = []
    for k in keys:
        v = meta[k]
        if isinstance(v, list):
            v = "[" + ", ".join(v) + "]"
        lines.append(f"{k}: {v}")
    path.write_text("---\n" + "\n".join(lines) + "\n---\n" + body, encoding="utf-8")


def todas():
    hus = []
    for p in sorted(HU_DIR.glob("HU-*.md")):
        meta, body = parse(p)
        hus.append((p, meta, body))
    return hus


def cargar(hu_id):
    hu_id = hu_id.upper()
    p = HU_DIR / f"{hu_id}.md"
    if not p.exists():
        sys.exit(f"No existe {hu_id}")
    meta, body = parse(p)
    return p, meta, body


def num(hu_id):
    return int(hu_id.split("-")[1])


def agregar_log(body, mensaje):
    linea = f"- {ahora()} — {mensaje}\n"
    if "## Registro" not in body:
        body = body.rstrip() + "\n\n## Registro\n"
    return body.rstrip("\n") + "\n" + linea


def cambiar_estado(hu_id, estado, mensaje=None):
    p, meta, body = cargar(hu_id)
    anterior = meta.get("estado")
    meta["estado"] = estado
    meta["actualizada"] = ahora()
    texto = f"Estado: {anterior} → {estado}"
    if mensaje:
        texto += f". {mensaje}"
    body = agregar_log(body, texto)
    dump(p, meta, body)
    reindexar()
    print(f"{meta['id']} → {estado}")


def eligible(hus):
    """HUs en estado Lista cuyas dependencias estan todas Hechas."""
    estado = {m["id"]: m["estado"] for _, m, _ in hus}
    out = []
    for p, m, b in hus:
        if m["estado"] != "Lista":
            continue
        deps = m.get("depende_de") or []
        if isinstance(deps, str):
            deps = [deps] if deps else []
        if all(estado.get(d) == "Hecha" for d in deps):
            out.append((p, m, b))
    out.sort(key=lambda t: (PRIORIDADES.index(t[1].get("prioridad", "P3")), num(t[1]["id"])))
    return out


def reindexar():
    hus = todas()
    lineas = ["# Backlog de HUs", "", f"_Generado automaticamente: {ahora()}. No editar a mano; usa `scripts/backlog.py`._", ""]
    lineas += ["| ID | Titulo | Estado | Prio | Talla | Depende de |", "|---|---|---|---|---|---|"]
    orden = sorted(
        hus,
        key=lambda t: (ESTADOS.index(t[1]["estado"]), PRIORIDADES.index(t[1].get("prioridad", "P3")), num(t[1]["id"])),
    )
    for p, m, _ in orden:
        deps = m.get("depende_de") or []
        deps = ", ".join(deps) if isinstance(deps, list) else deps
        lineas.append(
            f"| [{m['id']}](backlog/{p.name}) | {m['titulo']} | {m['estado']} | {m.get('prioridad','')} | {m.get('talla','')} | {deps} |"
        )
    INDEX.write_text("\n".join(lineas) + "\n", encoding="utf-8")


def cmd_new(a):
    HU_DIR.mkdir(exist_ok=True)
    nums = [num(m["id"]) for _, m, _ in todas()]
    nuevo = f"HU-{(max(nums) + 1 if nums else 1):03d}"
    deps = [d.strip().upper() for d in a.depende.split(",") if d.strip()] if a.depende else []
    for d in deps:
        if not (HU_DIR / f"{d}.md").exists():
            sys.exit(f"La dependencia {d} no existe")
    meta = {
        "id": nuevo,
        "titulo": a.titulo,
        "estado": "Backlog",
        "prioridad": a.prioridad,
        "talla": a.talla,
        "depende_de": deps,
        "creada": ahora(),
        "actualizada": ahora(),
    }
    if TEMPLATE.exists():
        _, body = parse(TEMPLATE)
    else:
        body = "\n## Historia\nComo ___ quiero ___ para ___.\n\n## Criterios de aceptacion\n- [ ] \n\n## Notas tecnicas\n\n## Registro\n"
    body = agregar_log(body, "HU creada")
    dump(HU_DIR / f"{nuevo}.md", meta, body)
    reindexar()
    print(f"Creada {nuevo}: {a.titulo}")
    print(f"Edita backlog/{nuevo}.md para completar historia y criterios, luego: backlog.py ready {nuevo}")


def cmd_list(a):
    hus = todas()
    filas = []
    for _, m, _ in hus:
        if a.estado and m["estado"].lower() != a.estado.lower():
            continue
        if not a.estado and not a.all and m["estado"] == "Hecha":
            continue
        filas.append(m)
    filas.sort(key=lambda m: (ESTADOS.index(m["estado"]), PRIORIDADES.index(m.get("prioridad", "P3")), num(m["id"])))
    if not filas:
        print("(sin HUs)")
        return
    for m in filas:
        print(f"{m['id']}  [{m['estado']:<11}] {m.get('prioridad',''):<2} {m.get('talla',''):<2}  {m['titulo']}")


def cmd_show(a):
    p, _, _ = cargar(a.id)
    print(p.read_text(encoding="utf-8"))


def cmd_next(a):
    hus = todas()
    en_curso = [m["id"] for _, m, _ in hus if m["estado"] == "En progreso"]
    if en_curso:
        print(f"Aviso: ya hay HUs en progreso: {', '.join(en_curso)}", file=sys.stderr)
    el = eligible(hus)
    if not el:
        print("No hay HUs elegibles (estado 'Lista' con dependencias cumplidas).")
        sys.exit(1)
    p, m, _ = el[0]
    print(f"Siguiente: {m['id']} — {m['titulo']} ({m.get('prioridad')}, {m.get('talla')})")
    print(f"Archivo: backlog/{p.name}")


def cmd_take(a):
    hus = todas()
    el = eligible(hus)
    if not el:
        print("No hay HUs elegibles (estado 'Lista' con dependencias cumplidas).")
        sys.exit(1)
    _, m, _ = el[0]
    cambiar_estado(m["id"], "En progreso", "Tomada por Claude")
    _, _, _ = cargar(m["id"])
    print(f"Lee ahora backlog/{m['id']}.md y trabaja contra sus criterios de aceptacion.")


def cmd_simple(estado):
    def f(a):
        cambiar_estado(a.id, estado, getattr(a, "mensaje", None))
    return f


def cmd_log(a):
    p, meta, body = cargar(a.id)
    meta["actualizada"] = ahora()
    dump(p, meta, agregar_log(body, a.mensaje))
    print(f"Registro agregado a {meta['id']}")


def cmd_index(a):
    reindexar()
    print(f"Indice regenerado: {INDEX}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)

    s = sp.add_parser("new")
    s.add_argument("titulo")
    s.add_argument("-p", "--prioridad", default="P2", choices=PRIORIDADES)
    s.add_argument("-e", "--talla", default="M", choices=TALLAS)
    s.add_argument("-d", "--depende", default="")
    s.set_defaults(fn=cmd_new)

    s = sp.add_parser("list")
    s.add_argument("-s", "--estado")
    s.add_argument("--all", action="store_true")
    s.set_defaults(fn=cmd_list)

    sp.add_parser("next").set_defaults(fn=cmd_next)
    sp.add_parser("take").set_defaults(fn=cmd_take)
    sp.add_parser("index").set_defaults(fn=cmd_index)

    s = sp.add_parser("show")
    s.add_argument("id")
    s.set_defaults(fn=cmd_show)

    for nombre, estado in [
        ("ready", "Lista"),
        ("start", "En progreso"),
        ("review", "En revision"),
        ("done", "Hecha"),
        ("block", "Bloqueada"),
    ]:
        s = sp.add_parser(nombre)
        s.add_argument("id")
        s.add_argument("-m", "--mensaje")
        s.set_defaults(fn=cmd_simple(estado))

    s = sp.add_parser("log")
    s.add_argument("id")
    s.add_argument("mensaje")
    s.set_defaults(fn=cmd_log)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
