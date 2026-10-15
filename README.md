# CloudOps Sentinel

CloudOps Sentinel is an evidence-led incident response copilot. The Next.js frontend provides the command center; the existing FastAPI service runs the Self-RAG workflow, retrieval, uploads, and audit log.

## Run locally

1. Configure the Python service using `.env.example`, then install its dependencies from `requirements.txt`.
2. Start the API from the repository root: `uvicorn app:app --reload --port 8080`.
3. In another terminal, run `cd frontend && npm install && npm run dev`.
4. Open `http://localhost:3000`.

## Administrator document uploads

`POST /api/upload` requires a strong `KNOWLEDGE_UPLOAD_TOKEN` in the root `.env` (at least 32 characters). Without it, uploads are disabled. Generate one with `python -c 'import secrets; print(secrets.token_urlsafe(32))'`, place it in `.env`, and restart FastAPI. Enter the same key in the Knowledge base screen before selecting a document. The UI keeps it in memory for the current page only; it is not saved to browser storage. The Next.js proxy passes it only to the upload endpoint, and FastAPI checks it before processing a file. Keep the API and frontend behind HTTPS in production.

Only PDF, TXT, MD, and DOCX files up to 10 MB are accepted. Rotate the key in `.env` if it is shared or exposed.

The frontend proxies `/api/chat`, `/api/upload`, `/api/health`, and `/api/audits` to `http://127.0.0.1:8080`. Set `CLOUDOPS_API_URL` in `frontend/.env.local` if the Python service runs elsewhere. API credentials stay in the root `.env` and are never exposed to the browser.

## Interface

- Ask an incident question or choose a sample investigation.
- Expand the answer's decision trace and inspect its evidence sources.
- Start a new conversation session; the active thread ID is kept in the browser.
- Upload approved PDF, TXT, MD, or DOCX documents to the existing Pinecone knowledge base with the administrator key.
- View recent requests in the activity log.

The UI uses Next.js App Router, React, TypeScript, Tailwind CSS, Motion, and Lucide icons. Its topology scene is built with CSS depth and animation, so it remains lightweight and respects reduced-motion settings.
