"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown,
  CircleHelp, Command, Database, FileCheck2, FileText, GitBranch,
  Globe2, Layers3, Menu, MessageSquareText, Plus, Radio, RotateCcw,
  ShieldCheck, Sparkles, UploadCloud, X, Zap,
} from "lucide-react";

type Source = { type: "internal" | "web"; title: string; source: string; url?: string | null; page?: number | null };
type Result = { answer: string; route: string; used_web_search: boolean; support_status: string; usefulness: string; sources: Source[]; trace: string[]; thread_id: string; memory_turns: number };
type Turn = { id: string; question: string; result?: Result; error?: string };
type Audit = { id: number; question: string; answer: string; created_at: string; route: string; used_web_search: boolean; support_status: string; usefulness: string; sources: Source[]; trace: string[]; thread_id: string | null; memory_turns: number };
type ThreadSummary = { thread_id: string; title: string; last_at: string; turn_count: number };

const suggestions = [
  { category: "INCIDENT RESPONSE", title: "Investigate checkout 502s", question: "The checkout API is returning 502 errors. What should I check first?", icon: Activity },
  { category: "SERVICE HEALTH", title: "Diagnose high CPU", question: "Payments service CPU is running high. Walk me through the runbook.", icon: Zap },
  { category: "DEPLOYMENT", title: "Plan a safe rollback", question: "What is the production deployment rollback procedure?", icon: RotateCcw },
];

const flow = [
  { n: "01", label: "Understand", sub: "Context + memory", icon: MessageSquareText },
  { n: "02", label: "Retrieve", sub: "Internal knowledge", icon: Database },
  { n: "03", label: "Verify", sub: "Evidence grading", icon: ShieldCheck },
  { n: "04", label: "Respond", sub: "Grounded action", icon: Sparkles },
];

function newThread() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `incident-${Date.now()}`;
}

function readableTrace(line: string) {
  return line.replaceAll("_", " ");
}

export function CommandCenter() {
  const [threadId, setThreadId] = useState("");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [audits, setAudits] = useState<Audit[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState("");
  const [activeAuditId, setActiveAuditId] = useState<number | null>(null);
  const [hasMoreAudits, setHasMoreAudits] = useState(false);
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [uploadToken, setUploadToken] = useState("");
  const [activePanel, setActivePanel] = useState<"workspace" | "knowledge" | "activity">("workspace");
  const [mobileNav, setMobileNav] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const adminInputRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const historyRequestRef = useRef("");

  const loadAudits = useCallback(async (offset = 0) => {
    setLoadingAudits(true);
    try {
      const response = await fetch(`/api/audits?limit=20&offset=${offset}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Activity history is unavailable.");
      const records = await response.json() as Audit[];
      setAudits(current => offset === 0 ? records : [...current, ...records]);
      setHasMoreAudits(records.length === 20);
    } catch { /* The history view keeps its last loaded records if the API is offline. */ }
    finally { setLoadingAudits(false); }
  }, []);

  const loadThreads = useCallback(async (): Promise<ThreadSummary[]> => {
    const response = await fetch("/api/threads?limit=50", { cache: "no-store" });
    if (!response.ok) throw new Error("Saved sessions are unavailable.");
    const records = await response.json() as ThreadSummary[];
    setThreads(records);
    return records;
  }, []);

  const restoreThread = useCallback(async (id: string) => {
    historyRequestRef.current = id;
    localStorage.setItem("sentinel-thread-id", id);
    setThreadId(id);
    setTurns([]);
    setRestoring(true);
    setRestoreError("");
    try {
      const response = await fetch(`/api/history?thread_id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load this conversation.");
      const records = await response.json() as Audit[];
      if (historyRequestRef.current === id) {
        setTurns(records.map(record => ({
          id: `audit-${record.id}`,
          question: record.question,
          result: {
            answer: record.answer,
            route: record.route,
            used_web_search: record.used_web_search,
            support_status: record.support_status,
            usefulness: record.usefulness,
            sources: record.sources,
            trace: record.trace,
            thread_id: id,
            memory_turns: record.memory_turns,
          },
        })));
      }
    } catch {
      if (historyRequestRef.current === id) setRestoreError("Saved conversation could not be loaded. Check the API connection and retry.");
    } finally {
      if (historyRequestRef.current === id) setRestoring(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const saved = localStorage.getItem("sentinel-thread-id");
    void (async () => {
      let available: ThreadSummary[] = [];
      try { available = await loadThreads(); } catch { /* Retry remains available in the UI. */ }
      if (!active) return;
      const id = saved && available.some(item => item.thread_id === saved)
        ? saved : available[0]?.thread_id || saved || newThread();
      await restoreThread(id);
    })();
    fetch("/api/health", { cache: "no-store" })
      .then(response => setHealth(response.ok ? "online" : "offline"))
      .catch(() => setHealth("offline"));
    void loadAudits();
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => { active = false; window.removeEventListener("keydown", keydown); };
  }, [loadAudits, loadThreads, restoreThread]);

  useEffect(() => {
    if (turns.length) conversationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [turns.length]);

  async function ask(raw?: string) {
    const value = (raw ?? question).trim();
    if (!value || busy || restoring || !threadId) return;
    const id = newThread();
    setQuestion("");
    setActivePanel("workspace");
    setTurns(current => [...current, { id, question: value }]);
    setBusy(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: value, thread_id: threadId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "The request failed. Please retry.");
      setTurns(current => current.map(turn => turn.id === id ? { ...turn, result: data as Result } : turn));
      setExpandedTrace(id);
      void loadAudits();
      void loadThreads().catch(() => {});
    } catch (error) {
      setTurns(current => current.map(turn => turn.id === id ? { ...turn, error: error instanceof Error ? error.message : "The request failed." } : turn));
    } finally { setBusy(false); }
  }

  function startNew() {
    if (busy) return;
    const id = newThread();
    historyRequestRef.current = id;
    localStorage.setItem("sentinel-thread-id", id);
    setThreadId(id);
    setTurns([]);
    setRestoring(false);
    setRestoreError("");
    setQuestion("");
    setActivePanel("workspace");
    setMobileNav(false);
    inputRef.current?.focus();
  }

  function openThread(id: string) {
    if (busy) return;
    setActivePanel("workspace");
    setMobileNav(false);
    void restoreThread(id);
  }

  async function upload(file?: File) {
    if (!file) return;
    if (uploadToken.length < 32) {
      setUploadNote("Enter the administrator upload key first.");
      adminInputRef.current?.focus();
      return;
    }
    setUploading(true); setUploadNote("");
    const body = new FormData(); body.append("file", file);
    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${uploadToken}` },
        body,
      });
      const data = await response.json();
      if (response.status === 401) setUploadToken("");
      if (!response.ok) throw new Error(data.detail || "Upload failed.");
      setUploadNote(`${data.filename} indexed · ${data.chunks_indexed} knowledge chunks added`);
    } catch (error) {
      setUploadNote(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const nav = (panel: typeof activePanel) => { setActivePanel(panel); setMobileNav(false); };
  const latest = [...turns].reverse().find(turn => turn.result)?.result;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="sidebar-top">
        <button className="brand" onClick={() => nav("workspace")} aria-label="CloudOps Sentinel home">
          <span className="brand-mark"><Activity size={22} strokeWidth={2.6}/></span>
          <span className="brand-word">SENTINEL<span className="brand-dot">.</span><small>CLOUDOPS INTELLIGENCE</small></span>
        </button>
        <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={20}/></button>
      </div>
      <div className="sidebar-section-label">COMMAND CENTER</div>
      <nav className="side-nav" aria-label="Main navigation">
        <button className={activePanel === "workspace" ? "active" : ""} onClick={() => nav("workspace")}><Layers3 size={18}/> Overview <span className="nav-chevron">↗</span></button>
        <button className={activePanel === "knowledge" ? "active" : ""} onClick={() => nav("knowledge")}><BookOpen size={18}/> Knowledge base</button>
        <button className={activePanel === "activity" ? "active" : ""} onClick={() => nav("activity")}><GitBranch size={18}/> Activity log</button>
      </nav>
      <div className="sidebar-divider"/>
      <div className="sidebar-section-label">QUICK ACTIONS</div>
      <button className="side-action" onClick={startNew}><Plus size={17}/> New investigation <span>⌘ K</span></button>
      <button className="side-action" onClick={() => { nav("knowledge"); setTimeout(() => adminInputRef.current?.focus(), 150); }}><UploadCloud size={17}/> Add document</button>
      {threads.length > 0 && <>
        <div className="sidebar-divider"/>
        <div className="sidebar-section-label">SAVED SESSIONS</div>
        <div className="recent-session-list">{threads.slice(0, 8).map(item => <button key={item.thread_id} className={threadId === item.thread_id ? "selected" : ""} onClick={() => openThread(item.thread_id)} disabled={busy} title={item.title}><MessageSquareText size={14}/><span>{item.title}</span><small>{item.turn_count}</small></button>)}</div>
      </>}
      <div className="sidebar-spacer"/>
      <div className="system-card">
        <div className="system-card-head"><span className={`status-light ${health}`}/><span>SYSTEM STATUS</span><ArrowUpRight size={14}/></div>
        <strong>{health === "online" ? "All systems operational" : health === "checking" ? "Checking connection" : "Backend disconnected"}</strong>
        <p>{health === "online" ? "Ready to investigate incidents." : "Start the Python API on port 8080."}</p>
        <div className="system-card-foot"><span><Radio size={13}/> AI ENGINE</span><span>{health === "online" ? "CONNECTED" : "OFFLINE"}</span></div>
      </div>
      <div className="sidebar-footer"><span className="avatar">CO</span><span><strong>CloudOps Sentinel</strong><small>Incident intelligence platform</small></span><ChevronDown size={15}/></div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={21}/></button><span>PLATFORM</span><span className="crumb-slash">/</span><strong>{activePanel === "workspace" ? "Overview" : activePanel === "knowledge" ? "Knowledge base" : "Activity log"}</strong></div>
        <div className="topbar-right"><span className={`environment ${health === "offline" ? "offline" : ""}`}><span/> {health === "offline" ? "API OFFLINE" : health === "checking" ? "CONNECTING" : "LIVE ENVIRONMENT"}</span><span className="topbar-line"/><span className="topbar-version">SELF-RAG ENGINE <b>V2.0</b></span></div>
      </header>

      {activePanel === "workspace" && <>
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-ambient hero-ambient-one"/><div className="hero-ambient hero-ambient-two"/>
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line"/> THE FUTURE OF INCIDENT RESPONSE <span className="eyebrow-index">/ 001</span></div>
            <h1 id="hero-heading">When systems fail,<br/><em>clarity takes over.</em></h1>
            <p className="hero-description">Meet your AI incident copilot. It connects the dots across runbooks, verifies every answer, and helps you move from alert to action with confidence.</p>
            <div className="hero-actions"><button className="primary-button" onClick={() => inputRef.current?.focus()}>Start investigating <ArrowUpRight size={18}/></button><button className="text-button" onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}>Explore the engine <ArrowDownRight size={18}/></button></div>
            <div className="hero-proof"><span className="proof-icon"><ShieldCheck size={16}/></span><span>Evidence-led answers</span><i/><span>Human-first decisions</span></div>
          </div>
          <Topology/>
          <div className="hero-bottom"><span>SCROLL TO EXPLORE</span><span className="scroll-line"/><span>BUILT FOR THE CRITICAL MOMENTS</span></div>
        </section>

        <section className="metrics-bar" aria-label="Capabilities">
          <div><span className="metric-icon"><Database size={19}/></span><span><strong>Private knowledge</strong><small>Your runbooks, always in reach</small></span></div>
          <div><span className="metric-icon"><ShieldCheck size={19}/></span><span><strong>Verified answers</strong><small>Claims checked against evidence</small></span></div>
          <div><span className="metric-icon"><Globe2 size={19}/></span><span><strong>Intelligent fallback</strong><small>Web research when context runs out</small></span></div>
          <div><span className="metric-icon"><GitBranch size={19}/></span><span><strong>Visible reasoning</strong><small>Follow the path to every answer</small></span></div>
        </section>

        <section className="investigation-section" ref={conversationRef} id="workspace">
          <div className="section-heading"><div><span className="section-kicker"><span/> YOUR WORKSPACE</span><h2>Investigate with intent<span>.</span></h2><p>Ask about an incident, service, or procedure. Sentinel turns your operational knowledge into a clear next step.</p></div><button className="new-session" onClick={startNew}><Plus size={17}/> New session</button></div>
          <div className="workspace-grid">
            <div className="chat-panel">
              <div className="panel-toolbar"><span><span className="toolbar-pulse"/> LIVE INVESTIGATION</span><span className="thread-label">SESSION {threadId.slice(0, 8).toUpperCase() || "NEW"}</span></div>
              {restoreError && <div className="history-warning" role="alert"><CircleHelp size={16}/><span>{restoreError}</span><button onClick={() => restoreThread(threadId)}>Retry</button></div>}
              {restoring ? <div className="restoring-chat"><span className="thinking-dots"><i/><i/><i/></span> Restoring saved conversation...</div> : turns.length === 0 ? <div className="empty-chat">
                <div className="empty-symbol"><span><Command size={25}/></span><span className="empty-orbit"/></div>
                <h3>What are we solving today?</h3><p>Start with an incident symptom or choose a starting point below.</p>
                <div className="suggestion-grid">{suggestions.map(item => <button key={item.title} className="suggestion" onClick={() => ask(item.question)} disabled={busy || !!restoreError}><span className="suggestion-icon"><item.icon size={19}/></span><small>{item.category}</small><strong>{item.title}</strong><ArrowUpRight size={16} className="suggestion-arrow"/></button>)}</div>
              </div> : <div className="conversation" aria-live="polite">{turns.map(turn => <div className="turn" key={turn.id}>
                <div className="user-message"><span className="message-avatar">YOU</span><div><small>YOU ASKED</small><p>{turn.question}</p></div></div>
                {turn.result ? <div className="answer-card"><div className="answer-head"><span className="sentinel-avatar"><Activity size={17}/></span><div><strong>SENTINEL RESPONSE</strong><small>{turn.result.route === "web" ? "EXTERNAL RESEARCH" : turn.result.route === "direct" ? "GENERAL KNOWLEDGE" : "INTERNAL KNOWLEDGE"}</small></div><span className={`support-pill ${turn.result.support_status === "fully_supported" ? "supported" : ""}`}><ShieldCheck size={13}/>{turn.result.support_status ? turn.result.support_status.replaceAll("_", " ") : "response ready"}</span></div><div className="answer-text">{turn.result.answer}</div>
                  {!!turn.result.sources?.length && <div className="source-list"><span className="answer-meta-label">SOURCES · {turn.result.sources.length}</span><div>{turn.result.sources.map((source, index) => source.url ? <a key={`${source.source}-${index}`} href={source.url} target="_blank" rel="noreferrer"><Globe2 size={14}/>{source.title || source.source || `Source ${index + 1}`}<ArrowUpRight size={13}/></a> : <span key={`${source.source}-${index}`}><FileText size={14}/>{source.title || source.source || `Document ${index + 1}`}{source.page != null ? ` · p.${source.page}` : ""}</span>)}</div></div>}
                  {!!turn.result.trace?.length && <div className="trace-block"><button onClick={() => setExpandedTrace(expandedTrace === turn.id ? null : turn.id)} aria-expanded={expandedTrace === turn.id}><span><GitBranch size={15}/> DECISION TRACE <b>{turn.result.trace.length} STEPS</b></span><ChevronDown size={16}/></button><AnimatePresence>{expandedTrace === turn.id && <motion.ol initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .25 }}>{turn.result.trace.map((step, index) => <li key={index}><i/>{readableTrace(step)}</li>)}</motion.ol>}</AnimatePresence></div>}
                </div> : turn.error ? <div className="error-card"><CircleHelp size={19}/><span>{turn.error}</span><button onClick={() => ask(turn.question)}>Retry <ArrowRight size={14}/></button></div> : <div className="thinking-card"><span className="thinking-dots"><i/><i/><i/></span><span>Sentinel is tracing the evidence...</span></div>}
              </div>)}</div>}
              <form className="composer" onSubmit={event => { event.preventDefault(); ask(); }}><div className="composer-inner"><textarea ref={inputRef} value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(); } }} placeholder="Describe an incident or ask about your runbooks..." rows={2} maxLength={2000} aria-label="Your incident question"/><button type="submit" disabled={!question.trim() || busy || restoring || !!restoreError || !threadId} aria-label="Send question"><ArrowUpRight size={20}/></button></div><div className="composer-foot"><span><Sparkles size={13}/> Grounded in your operational knowledge</span><span>ENTER TO SEND <i/> SHIFT + ENTER FOR NEW LINE</span></div></form>
            </div>
            <aside className="insights-panel"><div className="insights-header"><span>INVESTIGATION LENS</span><span className="live-tag"><i/> LIVE</span></div><div className="insights-content"><div className="lens-graphic"><span className="lens-ring lens-ring-one"/><span className="lens-ring lens-ring-two"/><span className="lens-core"><Activity size={22}/></span><span className="lens-cross lens-cross-one"/><span className="lens-cross lens-cross-two"/></div><h3>{latest ? "Evidence, in focus." : "Signal over noise."}</h3><p>{latest ? "Your latest response is backed by an inspectable decision path." : "Every question moves through a deliberate process designed to find and verify the right context."}</p><div className="lens-stats"><div><span>KNOWLEDGE ROUTE</span><strong>{latest?.route ? latest.route.toUpperCase() : "STANDBY"}</strong></div><div><span>MEMORY TURNS</span><strong>{String(latest?.memory_turns ?? 0).padStart(2, "0")}</strong></div><div><span>EVIDENCE SOURCES</span><strong>{String(latest?.sources?.length ?? 0).padStart(2, "0")}</strong></div></div></div><button className="insight-bottom" onClick={() => nav("knowledge")}><span><BookOpen size={16}/> Manage knowledge base</span><ArrowUpRight size={16}/></button></aside>
          </div>
        </section>

        <section className="workflow-section" id="how-it-works"><div className="workflow-title"><span className="section-kicker"><span/> UNDER THE HOOD</span><h2>Intelligence you can inspect<span>.</span></h2><p>Not a black box. A purposeful chain from question to evidence to answer.</p></div><div className="flow-grid">{flow.map((step, index) => <div className="flow-step" key={step.n}><div className="flow-top"><span>{step.n} / 04</span><step.icon size={22}/></div><div className="flow-line"><i/></div><h3>{step.label}</h3><p>{step.sub}</p>{index < flow.length - 1 && <ArrowRight className="flow-arrow" size={17}/>}</div>)}</div><div className="workflow-footer"><span><ShieldCheck size={16}/> Built for evidence. Designed for action.</span><span>SELF-RAG ARCHITECTURE — 2026</span></div></section>
      </>}

      {activePanel === "knowledge" && <section className="subpage">
        <div className="subpage-eyebrow"><span/> THE SOURCE OF TRUTH</div>
        <div className="subpage-title"><div><h1>Knowledge base<span>.</span></h1><p>Give Sentinel the documentation it needs to answer with context. Upload runbooks, SOPs, and technical notes to the existing vector index.</p></div><Database size={47}/></div>
        <div className="knowledge-layout">
          <div className="upload-card">
            <div className="upload-icon"><UploadCloud size={29}/></div>
            <h2>Expand what Sentinel knows.</h2>
            <p>Only an administrator can add documents to the knowledge base.</p>
            <div className="admin-key-field">
              <label htmlFor="upload-admin-key"><ShieldCheck size={16}/> Administrator upload key</label>
              <input id="upload-admin-key" ref={adminInputRef} type="password" autoComplete="off" value={uploadToken} onChange={event => { setUploadToken(event.target.value); setUploadNote(""); }} placeholder="Enter your private upload key" spellCheck={false}/>
              <small>Used only for uploads. It is not saved in your browser.</small>
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.docx" hidden onChange={event => upload(event.target.files?.[0])}/>
            <button className="primary-button" onClick={() => fileRef.current?.click()} disabled={uploading || uploadToken.length < 32}>{uploading ? "Indexing document..." : "Choose a document"}<ArrowUpRight size={17}/></button>
            <small>PDF, TXT, MD, DOCX · Maximum 10 MB</small>
            {uploadNote && <div className="upload-feedback" role="status"><FileCheck2 size={17}/>{uploadNote}</div>}
          </div>
          <div className="knowledge-info"><div className="knowledge-info-top"><span>HOW IT WORKS</span><BookOpen size={20}/></div><div className="knowledge-row"><span>01</span><div><strong>Enter your admin key</strong><p>Authorization is checked by the API before an upload is processed.</p></div></div><div className="knowledge-row"><span>02</span><div><strong>Index its contents</strong><p>Sentinel chunks and embeds approved content into your knowledge base.</p></div></div><div className="knowledge-row"><span>03</span><div><strong>Ask with context</strong><p>Relevant passages are retrieved and checked before a response.</p></div></div></div>
        </div>
        <div className="knowledge-note"><ShieldCheck size={18}/><span>Answers from approved documents appear as internal evidence in the investigation workspace.</span></div>
      </section>}

      {activePanel === "activity" && <section className="subpage">
        <div className="subpage-eyebrow"><span/> THE AUDIT TRAIL</div>
        <div className="subpage-title"><div><h1>Activity log<span>.</span></h1><p>Open any investigation to read its complete answer, evidence, and decision trace.</p></div><GitBranch size={47}/></div>
        <div className="activity-card">
          <div className="activity-head"><span>RECENT INVESTIGATIONS</span><button onClick={() => loadAudits()} disabled={loadingAudits}><RotateCcw size={15}/> Refresh</button></div>
          {audits.length ? audits.map((audit, index) => <div className="activity-entry" key={audit.id}>
            <button className="activity-row" onClick={() => setActiveAuditId(activeAuditId === audit.id ? null : audit.id)} aria-expanded={activeAuditId === audit.id}>
              <span className="activity-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="activity-summary"><strong>{audit.question}</strong><span>{audit.answer?.slice(0, 170)}{audit.answer?.length > 170 ? "…" : ""}</span></span>
              <span className="activity-meta"><small>{audit.route || "internal"}</small>{new Date(audit.created_at).toLocaleDateString()}</span>
              <ChevronDown className="activity-chevron" size={17}/>
            </button>
            {activeAuditId === audit.id && <div className="activity-detail">
              <div className="activity-detail-title"><span>COMPLETE RESPONSE</span><span>{audit.support_status?.replaceAll("_", " ") || "Answer saved"}</span></div>
              <div className="activity-answer">{audit.answer}</div>
              {!!audit.sources?.length && <div className="activity-evidence"><strong>SOURCES · {audit.sources.length}</strong><div>{audit.sources.map((source, sourceIndex) => source.url ? <a key={sourceIndex} href={source.url} target="_blank" rel="noreferrer"><Globe2 size={14}/>{source.title || source.source || `Source ${sourceIndex + 1}`}<ArrowUpRight size={13}/></a> : <span key={sourceIndex}><FileText size={14}/>{source.title || source.source || `Document ${sourceIndex + 1}`}{source.page != null ? ` · p.${source.page}` : ""}</span>)}</div></div>}
              {!!audit.trace?.length && <div className="activity-trace"><strong>DECISION TRACE · {audit.trace.length} STEPS</strong><ol>{audit.trace.map((step, stepIndex) => <li key={stepIndex}>{readableTrace(step)}</li>)}</ol></div>}
              {audit.thread_id && <button className="open-session" onClick={() => openThread(audit.thread_id!)}>Open full conversation <ArrowRight size={15}/></button>}
            </div>}
          </div>) : <div className="activity-empty"><FileText size={28}/><h3>No investigations yet</h3><p>Completed requests will appear here when the API is connected.</p><button onClick={() => nav("workspace")}>Open workspace <ArrowRight size={15}/></button></div>}
          {hasMoreAudits && <div className="activity-more"><button onClick={() => loadAudits(audits.length)} disabled={loadingAudits}>{loadingAudits ? "Loading..." : "Load more investigations"}<ArrowDownRight size={15}/></button></div>}
        </div>
      </section>}
      <footer className="main-footer"><span>© 2026 CLOUDOPS SENTINEL</span><span>INTELLIGENCE FOR THE MOMENTS THAT MATTER <span className="footer-star">✳</span></span></footer>
    </main>
    {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="Close menu"/>}
  </div>;
}

function Topology() {
  return <div className="topology" aria-label="Visual diagram: an incident signal connects to runbook evidence, verification, and an actionable response" role="img"><div className="topology-grid"/><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="orbit orbit-c"/><div className="beam beam-one"/><div className="beam beam-two"/><div className="beam beam-three"/><div className="topology-core"><div className="core-halo"/><div className="core-inner"><Activity size={44} strokeWidth={1.4}/></div><span className="core-dot core-dot-a"/><span className="core-dot core-dot-b"/></div><div className="topo-node topo-node-alert"><span className="node-icon red"><Radio size={18}/></span><span><small>INCOMING SIGNAL</small><strong>Incident detected</strong></span><i/></div><div className="topo-node topo-node-knowledge"><span className="node-icon blue"><Database size={18}/></span><span><small>CONTEXT FOUND</small><strong>Runbooks retrieved</strong></span><Check size={15}/></div><div className="topo-node topo-node-verified"><span className="node-icon green"><ShieldCheck size={18}/></span><span><small>CLAIMS VERIFIED</small><strong>Actionable answer</strong></span><ArrowUpRight size={15}/></div><div className="topo-coord topo-coord-top">42° 18′ 07″ N</div><div className="topo-coord topo-coord-bottom">EVIDENCE NETWORK / ACTIVE</div><div className="topo-tiny topo-tiny-one">+</div><div className="topo-tiny topo-tiny-two">+</div></div>;
}
