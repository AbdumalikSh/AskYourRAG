"""Index every PDF found in the configured PDF_DIR."""
from backend.rag import PDF_DIR, ingest_files


def main() -> None:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(PDF_DIR.glob("*.pdf"))
    if not files:
        print(f"No PDFs found in {PDF_DIR}")
        return
    result = ingest_files(files)
    for item in result["files"]:
        print(f"{item['filename']}: {item['pages']} pages, {item['chunks']} chunks")
    print(f"\nIndexed {result['chunks']} chunks.")


if __name__ == "__main__":
    main()
