from pathlib import Path
import hmac
import os
import tempfile
from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.concurrency import run_in_threadpool


from src.models import ChatRequest, ChatResponse, UploadResponse
from src.self_rag import run_self_rag
from src.ingestion import ingest_file, namespace, SUPPORTED
from src.db import init_db, save_audit, latest_audits, thread_history, recent_threads
from dotenv import load_dotenv

load_dotenv()  # Load environment variables from .env file

ROOT = Path(__file__).resolve().parent
UPLOADS = ROOT / "uploads"
UPLOADS.mkdir(exist_ok=True)


app = FastAPI(
    title="CloudOps Sentinel — Enterprise Incident Response Self-RAG Copilot",
    version="2.0.0",
    description="Self-RAG copilot for cloud operations, production troubleshooting, and incident-response runbooks.",
)
app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")
templates = Jinja2Templates(directory=str(ROOT / "templates"))


@app.middleware("http")
async def protect_knowledge_upload(request: Request, call_next):
    if request.url.path == "/api/upload" and request.method == "POST":
        expected = os.getenv("KNOWLEDGE_UPLOAD_TOKEN", "").strip()
        if len(expected) < 32:
            return JSONResponse(
                {"detail": "Knowledge-base uploads are disabled until an administrator configures a secure upload token."},
                status_code=503,
                headers={"Cache-Control": "no-store"},
            )
        authorization = request.headers.get("authorization", "")
        scheme, _, provided = authorization.partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(provided, expected):
            return JSONResponse(
                {"detail": "Administrator upload key is missing or invalid."},
                status_code=401,
                headers={"WWW-Authenticate": "Bearer", "Cache-Control": "no-store"},
            )
    return await call_next(request)



@app.on_event("startup")
def startup():
    init_db()


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={}
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "cloudops-sentinel-self-rag"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest):
    try:
        result = await run_in_threadpool(run_self_rag, payload.question.strip(), payload.thread_id.strip())
        await run_in_threadpool(save_audit, payload.question, result)
        return ChatResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload", response_model=UploadResponse)
async def upload(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED:
        raise HTTPException(status_code=400, detail="Supported: PDF, TXT, MD, DOCX")
    safe_name = Path(file.filename or "").name
    target = UPLOADS / safe_name
    if not safe_name or safe_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="A valid filename is required")
    max_bytes = 10 * 1024 * 1024
    size = 0
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=UPLOADS, prefix=".upload-", delete=False) as output:
            temporary = Path(output.name)
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail="Maximum document size is 10 MB")
                output.write(chunk)
        os.replace(temporary, target)
    except Exception:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise
    try:
        count = await run_in_threadpool(ingest_file, target)
        return UploadResponse(filename=safe_name, chunks_indexed=count, namespace=namespace())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/audits")
def audits(limit: int = 20, offset: int = 0):
    return latest_audits(min(max(limit, 1), 100), max(offset, 0))


@app.get("/api/threads")
def threads(limit: int = 30):
    return recent_threads(min(max(limit, 1), 100))


@app.get("/api/history")
def history(thread_id: str = Query(..., min_length=3, max_length=120)):
    return thread_history(thread_id)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8080, reload=True)
