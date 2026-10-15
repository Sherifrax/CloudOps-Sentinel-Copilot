import json
import sqlite3
from contextlib import closing, contextmanager
from datetime import datetime, timezone

from src.config import get_settings


def _database_url() -> str:
    return getattr(get_settings(), "database_url", "")


@contextmanager
def _connect():
    url = _database_url()
    if url:
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(url, row_factory=dict_row, prepare_threshold=None) as conn:
            yield conn
    else:
        path = get_settings().database_file
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as conn:
            conn.row_factory = sqlite3.Row
            yield conn
            conn.commit()


def _placeholder() -> str:
    return "%s" if _database_url() else "?"


def init_db() -> None:
    postgres = bool(_database_url())
    id_type = "BIGSERIAL PRIMARY KEY" if postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with _connect() as conn:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS rag_audit (
                id {id_type},
                created_at TEXT NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                route TEXT,
                used_web INTEGER DEFAULT 0,
                support_status TEXT,
                usefulness TEXT,
                trace_json TEXT,
                sources_json TEXT,
                thread_id TEXT,
                memory_turns INTEGER DEFAULT 0
            )
        """)
        if not postgres:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(rag_audit)")}
            if "thread_id" not in columns:
                conn.execute("ALTER TABLE rag_audit ADD COLUMN thread_id TEXT")
            if "memory_turns" not in columns:
                conn.execute("ALTER TABLE rag_audit ADD COLUMN memory_turns INTEGER DEFAULT 0")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_rag_audit_thread ON rag_audit(thread_id, id)")


def save_audit(question: str, result: dict) -> None:
    p = _placeholder()
    with _connect() as conn:
        conn.execute(
            """INSERT INTO rag_audit
            (created_at, question, answer, route, used_web, support_status, usefulness,
             trace_json, sources_json, thread_id, memory_turns)
            VALUES (""" + ", ".join([p] * 11) + ")",
            (
                datetime.now(timezone.utc).isoformat(),
                question,
                result.get("answer", ""),
                result.get("route", ""),
                int(bool(result.get("used_web_search"))),
                result.get("support_status", ""),
                result.get("usefulness", ""),
                json.dumps(result.get("trace", []), ensure_ascii=False),
                json.dumps(result.get("sources", []), ensure_ascii=False),
                result.get("thread_id", ""),
                result.get("memory_turns", 0),
            ),
        )


def _audit_record(row) -> dict:
    record = dict(row)
    record["trace"] = json.loads(record.pop("trace_json") or "[]")
    record["sources"] = json.loads(record.pop("sources_json") or "[]")
    record["used_web_search"] = bool(record.pop("used_web"))
    return record


def latest_audits(limit: int = 25, offset: int = 0):
    p = _placeholder()
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM rag_audit ORDER BY id DESC LIMIT {p} OFFSET {p}",
            (limit, offset),
        ).fetchall()
    return [_audit_record(row) for row in rows]


def thread_history(thread_id: str):
    p = _placeholder()
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM rag_audit WHERE thread_id = {p} ORDER BY id ASC",
            (thread_id,),
        ).fetchall()
    return [_audit_record(row) for row in rows]


def recent_threads(limit: int = 30):
    p = _placeholder()
    with _connect() as conn:
        rows = conn.execute(f"""
            SELECT a.thread_id, a.question AS title, latest.last_at, latest.turn_count
            FROM rag_audit AS a
            JOIN (
                SELECT thread_id, MIN(id) AS first_id, MAX(created_at) AS last_at,
                       COUNT(*) AS turn_count
                FROM rag_audit
                WHERE thread_id IS NOT NULL AND thread_id != ''
                GROUP BY thread_id
                ORDER BY last_at DESC
                LIMIT {p}
            ) AS latest ON a.id = latest.first_id
            ORDER BY latest.last_at DESC
        """, (limit,)).fetchall()
    return [dict(row) for row in rows]
