"""Link pre-history audit rows to their saved LangGraph conversations.

Run once with --apply after upgrading an existing installation. Rows are linked
only when their exact question and answer identify a single checkpoint turn.
"""

import argparse
import re
import sqlite3
import sys
from collections import defaultdict
from contextlib import closing
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.config import get_settings  # noqa: E402
from src.db import init_db  # noqa: E402


MEMORY_ENTRY = re.compile(r"\AUser: (.*?)\nAssistant \([^)]+\): (.*)\Z", re.DOTALL)


def checkpoint_matches(path: Path) -> dict[tuple[str, str], list[tuple[str, int]]]:
    matches: dict[tuple[str, str], list[tuple[str, int]]] = defaultdict(list)
    with closing(sqlite3.connect(path)) as conn:
        saver = SqliteSaver(conn)
        seen_threads = set()
        for item in saver.list(None):
            thread_id = item.config["configurable"]["thread_id"]
            if thread_id in seen_threads:
                continue
            seen_threads.add(thread_id)
            for turn_number, entry in enumerate(item.checkpoint["channel_values"].get("memory", []), 1):
                parsed = MEMORY_ENTRY.match(entry)
                if parsed:
                    matches[parsed.groups()].append((thread_id, turn_number))
    return matches


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write unambiguous links to the audit database")
    args = parser.parse_args()
    init_db()
    memory_path = ROOT / "data" / "langgraph_memory.sqlite"
    if not memory_path.exists():
        parser.error("No LangGraph checkpoint database exists")
    matches = checkpoint_matches(memory_path)
    with closing(sqlite3.connect(get_settings().database_file)) as conn:
        pending = conn.execute(
            "SELECT id, question, answer FROM rag_audit WHERE thread_id IS NULL OR thread_id = ''"
        ).fetchall()
        updates = []
        for audit_id, question, answer in pending:
            candidates = matches.get((question, answer), [])
            if len(candidates) == 1:
                thread_id, turn_number = candidates[0]
                updates.append((thread_id, turn_number, audit_id))
        if args.apply:
            conn.executemany(
                "UPDATE rag_audit SET thread_id = ?, memory_turns = ? WHERE id = ?",
                updates,
            )
            conn.commit()
    verb = "Linked" if args.apply else "Can link"
    print(f"{verb} {len(updates)} of {len(pending)} legacy audit rows to saved conversations.")
    if not args.apply:
        print("Run again with --apply to save these links.")


if __name__ == "__main__":
    main()
