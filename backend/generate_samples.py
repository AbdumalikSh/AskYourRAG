"""Build the small, original demonstration PDFs with only Python's standard library."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/sample_sources"
OUTPUT = ROOT / "data/pdfs"
OUTPUT.mkdir(parents=True, exist_ok=True)


def escape_pdf(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(lines: list[str], output: Path) -> None:
    # Two pages, with page numbers embedded in the PDF content stream.
    pages = [lines[i:i + 44] for i in range(0, len(lines), 44)] or [[]]
    objects: list[bytes] = []
    page_ids = [4 + i * 2 for i in range(len(pages))]
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for index, page_lines in enumerate(pages):
        page_id, stream_id = 4 + index * 2, 5 + index * 2
        commands = ["BT", "/F1 9 Tf", "48 750 Td", "12 TL"]
        for line in page_lines:
            commands.extend([f"({escape_pdf(line)}) Tj", "T*"])
        commands.extend([f"0 -10 Td", f"(Page {index + 1}) Tj", "ET"])
        stream = "\n".join(commands).encode("latin-1", errors="replace")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {stream_id} 0 R >>".encode())
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    content = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(content))
        content.extend(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(content)
    content.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        content.extend(f"{offset:010d} 00000 n \n".encode())
    content.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    output.write_bytes(content)


def main() -> None:
    for source in sorted(SOURCE.glob("*.txt")):
        paragraphs = source.read_text(encoding="utf-8").splitlines()
        lines: list[str] = []
        for paragraph in paragraphs:
            if not paragraph.strip():
                lines.append("")
                continue
            lines.extend(re.findall(r".{1,96}(?:\s+|$)", paragraph.strip()))
        make_pdf(lines, OUTPUT / f"{source.stem}.pdf")
        print(f"Wrote {OUTPUT / (source.stem + '.pdf')}")


if __name__ == "__main__":
    main()
