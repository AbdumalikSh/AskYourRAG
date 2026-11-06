# Unicorn Finder created by Abdumalik

Ask questions about PDFs and get answers with page citations, such as `[report.pdf, p. 12]`. Unicorn Finder embeds PDF text locally, searches the selected files, and uses a chat model to write the answer. Use an API provider or run the model locally with Ollama.

Recent chats are saved in the browser tab's session storage, not a database.

## Requirements

- Python 3.10 or newer
- Node.js 18 or newer and npm
- Ollama for local answers, or an API key for an OpenAI-compatible provider

## 1. Install Python dependencies

Run from the project root:

```bash
python3 -m venv .venv
source .venv/bin/activate        # macOS/Linux
pip install -r requirements.txt
```

On Windows, activate with `.venv\Scripts\Activate.ps1`. If you do not already have `.env`, create it with `cp .env.example .env`.

## 2. Choose a chat model

### Ollama (local, no API credits)

Install and open [Ollama](https://ollama.com/download). Download the multilingual model:

```bash
ollama run qwen2.5:3b
```

The model is about 1.9 GB. After it downloads, you can exit its prompt with `/bye`; leave the Ollama app running while using Unicorn Finder. Set these values in `.env`:

```dotenv
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=qwen2.5:3b
```

`ollama` is a placeholder key; Ollama ignores it. To use Ollama again later, reopen the Ollama app.

### OpenAI-compatible API

Instead, put your provider's API key, URL, and model in `.env`:

```dotenv
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

Use the URL and model name supported by your provider.

## 3. Index PDFs

PDFs in `data/pdfs/` appear in the library. Index them before asking questions:

```bash
python -m backend.ingest
```

The first run downloads the local multilingual embedding model. Uploads from the website are indexed automatically. If you copy a PDF into `data/pdfs/`, run the indexing command again. Scanned PDFs need OCR before they can be searched.

## 4. Start the app

Start the backend in one terminal from the project root (with `.venv` activated):

```bash
uvicorn backend.main:app --reload --port 8000
```

Start the frontend in a second terminal:

```bash
cd frontend
npm install       # first time only
npm run dev
```

Open <http://localhost:5173>. Keep the backend running, and keep Ollama open if you chose it. API documentation is at <http://localhost:8000/docs>.

## Use it

Select which PDFs to search beside the question box, ask your question, and check the cited filename and page in the sources. Use the sidebar to start a new chat or return to a recent one; chat history lasts for the current browser tab session.

PDFs are read from `PDF_DIR` in `.env` (default: `data/pdfs/`). The Chroma index is stored in `data/chroma/`.
