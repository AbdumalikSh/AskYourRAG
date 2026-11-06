"""PDF ingestion, vector retrieval, and cited answer generation."""
from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Any

import chromadb
from dotenv import load_dotenv
from openai import OpenAI
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
PDF_DIR = Path(os.getenv("PDF_DIR", str(ROOT / "data/pdfs")))
if not PDF_DIR.is_absolute():
    PDF_DIR = ROOT / PDF_DIR
CHROMA_PATH = Path(os.getenv("CHROMA_PATH", str(ROOT / "data/chroma")))
if not CHROMA_PATH.is_absolute():
    CHROMA_PATH = ROOT / CHROMA_PATH
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "900"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "160"))
TOP_K = int(os.getenv("TOP_K", "5"))
DEFAULT_EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MIN_RELEVANCE_SCORE = float(os.getenv("MIN_RELEVANCE_SCORE", "0.10"))

_model: SentenceTransformer | None = None
_client: chromadb.PersistentClient | None = None
_collection: Any = None


def model() -> SentenceTransformer:
    global _model
    if _model is None:
        # MPS acceleration is unstable with some PyTorch/macOS combinations and
        # can terminate the whole Python process. CPU is predictable for this
        # small local model; users can opt into another supported device.
        device = os.getenv("EMBEDDING_DEVICE", "cpu")
        _model = SentenceTransformer(
            os.getenv("EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL),
            device=device,
        )
    return _model


def collection():
    global _client, _collection
    if _collection is None:
        CHROMA_PATH.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=str(CHROMA_PATH))
        # Embeddings from different models are not comparable, even when their
        # vector dimensions match. Keep each configured model in its own index.
        embedding_model = os.getenv("EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)
        model_id = hashlib.sha1(embedding_model.encode()).hexdigest()[:10]
        collection_name = f"ask-your-pdfs-{model_id}"
        _collection = _client.get_or_create_collection(
            collection_name, metadata={"hnsw:space": "cosine"}
        )
    return _collection


def split_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text close to paragraph/sentence boundaries with a character overlap."""
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    if size < 1 or overlap < 0 or overlap >= size:
        raise ValueError("Chunk overlap must be non-negative and smaller than chunk size")
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            boundary = max(text.rfind(". ", start + size // 2, end), text.rfind("; ", start + size // 2, end))
            if boundary > start:
                end = boundary + 1
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(start + 1, end - overlap)
    return chunks


def ingest_files(files: list[Path]) -> dict[str, Any]:
    """Index the supplied PDFs, replacing any previously indexed version by filename."""
    col = collection()
    indexed: list[dict[str, Any]] = []
    for path in files:
        if path.suffix.lower() != ".pdf" or not path.is_file():
            continue
        # Re-ingestion replaces all chunks for this filename, including renamed uploads.
        existing = col.get(where={"filename": path.name}, include=[])
        if existing["ids"]:
            col.delete(ids=existing["ids"])
        reader = PdfReader(str(path))
        ids: list[str] = []
        docs: list[str] = []
        metas: list[dict[str, Any]] = []
        for page_no, page in enumerate(reader.pages, 1):
            page_text = page.extract_text() or ""
            for chunk_no, chunk in enumerate(split_text(page_text)):
                digest = hashlib.sha1(f"{path.name}:{page_no}:{chunk_no}:{chunk}".encode()).hexdigest()
                ids.append(digest)
                docs.append(chunk)
                metas.append({"filename": path.name, "page": page_no, "chunk": chunk_no})
        if docs:
            vectors = model().encode(
                docs, normalize_embeddings=True, show_progress_bar=True
            ).tolist()
            col.add(ids=ids, documents=docs, metadatas=metas, embeddings=vectors)
        indexed.append({"filename": path.name, "pages": len(reader.pages), "chunks": len(docs)})
    return {"files": indexed, "chunks": sum(item["chunks"] for item in indexed)}


def list_documents() -> list[dict[str, Any]]:
    """Return PDFs available on disk and their indexed chunk counts."""
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    result = []
    for path in sorted(PDF_DIR.glob("*.pdf")):
        try:
            pages = len(PdfReader(str(path)).pages)
        except Exception:
            pages = 0
        result.append({"filename": path.name, "pages": pages, "chunks": 0, "indexed": False})

    # Showing the files on disk should not depend on Chroma being available.
    # If the index is missing or recovering, the UI can still list every PDF
    # and mark it as needing indexing.
    try:
        indexed: dict[str, int] = {}
        col = collection()
        for offset in range(0, col.count(), 500):
            rows = col.get(include=["metadatas"], limit=500, offset=offset)
            for meta in rows["metadatas"] or []:
                indexed[meta["filename"]] = indexed.get(meta["filename"], 0) + 1
        for document in result:
            count = indexed.get(document["filename"], 0)
            document["chunks"] = count
            document["indexed"] = count > 0
    except Exception:
        pass
    return result


def retrieve(
    question: str,
    top_k: int = TOP_K,
    filenames: list[str] | None = None,
) -> list[dict[str, Any]]:
    col = collection()
    if col.count() == 0 or filenames == []:
        return []
    vector = model().encode([question], normalize_embeddings=True).tolist()
    query_args: dict[str, Any] = {
        "query_embeddings": vector,
        "n_results": min(top_k, col.count()),
        "include": ["documents", "metadatas", "distances"],
    }
    if filenames is not None:
        query_args["where"] = {"filename": {"$in": filenames}}
    result = col.query(**query_args)
    hits = []
    for doc, meta, distance in zip(result["documents"][0], result["metadatas"][0], result["distances"][0]):
        hits.append({"text": doc, "filename": meta["filename"], "page": meta["page"], "score": round(max(0.0, 1.0 - distance), 3)})
    return hits


def answer_question(
    question: str,
    top_k: int = TOP_K,
    filenames: list[str] | None = None,
) -> dict[str, Any]:
    question = question.strip()
    if not question:
        raise ValueError("Please enter a question.")
    if filenames == []:
        return {
            "answer": "I don’t know based on the provided documents. Select at least one PDF to search.",
            "sources": [],
        }
    sources = retrieve(question, top_k=max(1, min(top_k, 10)), filenames=filenames)
    if not sources:
        if filenames is not None:
            return {"answer": "I don’t know based on the provided documents. I couldn’t find a relevant passage in the selected PDFs.", "sources": []}
        return {"answer": "I don’t know based on the provided documents. Add and index PDFs to get started.", "sources": []}

    # Keep weaker but plausible matches; the generation prompt still requires
    # the model to abstain when the excerpts do not support an answer.
    sources = [source for source in sources if source["score"] >= MIN_RELEVANCE_SCORE]
    if not sources:
        return {"answer": "I don’t know based on the provided documents. I couldn’t find a relevant passage to answer this question.", "sources": []}

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Add your OpenAI API key to .env to generate answers. PDF indexing and retrieval remain available without it.")
    client = OpenAI(api_key=api_key, base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"))
    context = "\n\n".join(f"[Source {i}: {s['filename']}, p. {s['page']}]\n{s['text']}" for i, s in enumerate(sources, 1))
    response = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        temperature=0.1,
        messages=[
            {"role": "system", "content": (
                "Answer the user's question using only the provided document excerpts. "
                "Cite every factual claim with the exact citation form [filename, p. N]. "
                "Use only source filenames and page numbers shown in the excerpts. "
                "If the excerpts do not support an answer, say exactly: I don't know based on the provided documents. "
                "Be concise and do not invent facts or citations."
            )},
            {"role": "user", "content": f"Question: {question}\n\nDocument excerpts:\n{context}"},
        ],
    )
    answer = (response.choices[0].message.content or "").strip()
    if not answer:
        answer = "I don’t know based on the provided documents."
    return {"answer": answer, "sources": sources}
