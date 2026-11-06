"""FastAPI service for Ask Your PDFs."""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import RateLimitError
from pydantic import BaseModel, Field

from backend.rag import PDF_DIR, answer_question, ingest_files, list_documents

app = FastAPI(title="Unicorn Finder", description="Ask questions grounded in your PDF library.", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
PDF_DIR.mkdir(parents=True, exist_ok=True)


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=10)
    filenames: list[str] | None = None


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/documents")
def documents():
    try:
        return {"documents": list_documents()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/ingest")
async def ingest(files: list[UploadFile] = File(...)):
    saved: list[Path] = []
    for upload in files:
        name = Path(upload.filename or "document.pdf").name
        if Path(name).suffix.lower() != ".pdf":
            continue
        destination = PDF_DIR / name
        try:
            with destination.open("wb") as target:
                shutil.copyfileobj(upload.file, target)
            saved.append(destination)
        finally:
            await upload.close()
    if not saved:
        raise HTTPException(status_code=400, detail="Choose one or more PDF files.")
    try:
        return ingest_files(saved)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not index PDFs: {exc}") from exc


@app.post("/api/ask")
def ask(request: Question):
    try:
        return answer_question(request.question, request.top_k, request.filenames)
    except RateLimitError as exc:
        provider_code = str(getattr(exc, "code", "") or "").lower()
        provider_message = str(exc).lower()
        if provider_code in {"insufficient_quota", "credit_balance_exhausted"} or "no credits remaining" in provider_message:
            raise HTTPException(
                status_code=402,
                detail=(
                    "The configured LLM account has no API credits remaining. "
                    "Add credits or configure a different OpenAI-compatible provider in .env."
                ),
            ) from exc
        raise HTTPException(
            status_code=429,
            detail="The LLM provider is rate limiting requests. Wait a moment and try again.",
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not answer question: {exc}") from exc
