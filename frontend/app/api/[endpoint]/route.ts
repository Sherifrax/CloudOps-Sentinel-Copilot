import { NextRequest, NextResponse } from "next/server";

const allowed = new Set(["chat", "upload", "health", "audits", "threads", "history"]);
const backend = process.env.CLOUDOPS_API_URL || "http://127.0.0.1:8080";

async function proxy(request: NextRequest, context: { params: Promise<{ endpoint: string }> }) {
  const { endpoint } = await context.params;
  if (!allowed.has(endpoint)) return NextResponse.json({ detail: "Unknown endpoint" }, { status: 404 });
  const authorization = request.headers.get("authorization") || "";
  if (endpoint === "upload" && request.method === "POST" && !/^Bearer [^\s]{32,}$/.test(authorization)) {
    return NextResponse.json({ detail: "Enter the administrator upload key before choosing a document." }, { status: 401 });
  }
  const url = `${backend.replace(/\/$/, "")}/api/${endpoint}${request.nextUrl.search}`;
  try {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    if (endpoint === "upload") headers.set("authorization", authorization);
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(endpoint === "chat" ? 180000 : endpoint === "upload" ? 120000 : 10000),
    });
    const result = await response.arrayBuffer();
    return new NextResponse(result, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ detail: "The CloudOps API is unavailable. Start the Python service on port 8080." }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
