import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

import app as app_module
from src import db


class ChatHistoryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.database = Path(directory.name) / "audit.db"
        settings_patch = patch.object(db, "get_settings", return_value=SimpleNamespace(database_file=self.database))
        settings_patch.start()
        self.addCleanup(settings_patch.stop)

    def test_migrates_old_audits_and_preserves_their_details(self):
        with closing(sqlite3.connect(self.database)) as conn:
            conn.execute("""CREATE TABLE rag_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
                question TEXT NOT NULL, answer TEXT NOT NULL, route TEXT,
                used_web INTEGER DEFAULT 0, support_status TEXT, usefulness TEXT,
                trace_json TEXT, sources_json TEXT
            )""")
            conn.execute("""INSERT INTO rag_audit
                (created_at, question, answer, route, used_web, support_status,
                 usefulness, trace_json, sources_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("2026-10-15T10:00:00+00:00", "old question", "full old answer",
                 "Private Runbooks", 0, "fully_supported", "useful",
                 '["retrieved", "verified"]', '[{"type":"internal","title":"runbook.md","source":"runbook.md"}]'))
            conn.commit()
        db.init_db()

        record = db.latest_audits()[0]
        self.assertEqual(record["answer"], "full old answer")
        self.assertEqual(record["trace"], ["retrieved", "verified"])
        self.assertEqual(record["sources"][0]["title"], "runbook.md")
        self.assertIsNone(record["thread_id"])
        self.assertEqual(record["memory_turns"], 0)

    def test_saved_turns_restore_in_order_with_sources_and_trace(self):
        db.init_db()
        first = {
            "answer": "inspect readiness probes", "route": "Private Runbooks",
            "used_web_search": False, "support_status": "fully_supported",
            "usefulness": "useful", "trace": ["retrieved", "verified"],
            "sources": [{"type": "internal", "title": "runbook.md", "source": "runbook.md"}],
            "thread_id": "thread-one", "memory_turns": 1,
        }
        db.save_audit("Why 502?", first)
        db.save_audit("What next?", {**first, "answer": "check logs", "memory_turns": 2})
        db.save_audit("Other incident", {**first, "thread_id": "thread-two"})

        history = db.thread_history("thread-one")
        self.assertEqual([item["question"] for item in history], ["Why 502?", "What next?"])
        self.assertEqual(history[0]["sources"][0]["title"], "runbook.md")
        self.assertEqual(history[1]["memory_turns"], 2)
        self.assertEqual({item["thread_id"] for item in db.recent_threads()}, {"thread-one", "thread-two"})

        client = TestClient(app_module.app)
        response = client.get("/api/history", params={"thread_id": "thread-one"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 2)
        self.assertEqual(client.get("/api/threads").status_code, 200)


if __name__ == "__main__":
    unittest.main()
