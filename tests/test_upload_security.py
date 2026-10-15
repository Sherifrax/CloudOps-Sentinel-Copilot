import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import app as app_module


class UploadSecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app_module.app)
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.upload_path = Path(self.temporary_directory.name)
        uploads_patch = patch.object(app_module, "UPLOADS", self.upload_path)
        uploads_patch.start()
        self.addCleanup(uploads_patch.stop)

    def upload(self, token=None, content=b"# Runbook"):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.post(
            "/api/upload",
            headers=headers,
            files={"file": ("runbook.md", content, "text/markdown")},
        )

    def test_upload_fails_closed_without_configured_token(self):
        with patch.dict(os.environ, {"KNOWLEDGE_UPLOAD_TOKEN": ""}):
            response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(list(self.upload_path.iterdir()), [])

    def test_missing_and_wrong_tokens_cannot_write(self):
        with patch.dict(os.environ, {"KNOWLEDGE_UPLOAD_TOKEN": "a" * 40}):
            self.assertEqual(self.upload().status_code, 401)
            self.assertEqual(self.upload("b" * 40).status_code, 401)
        self.assertEqual(list(self.upload_path.iterdir()), [])

    def test_authorized_upload_reaches_ingestion(self):
        with patch.dict(os.environ, {"KNOWLEDGE_UPLOAD_TOKEN": "a" * 40}), \
             patch.object(app_module, "ingest_file", return_value=2) as ingest, \
             patch.object(app_module, "namespace", return_value="test"):
            response = self.upload("a" * 40)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["chunks_indexed"], 2)
        self.assertEqual((self.upload_path / "runbook.md").read_bytes(), b"# Runbook")
        ingest.assert_called_once()

    def test_large_file_is_rejected_without_replacing_existing_document(self):
        existing = self.upload_path / "runbook.md"
        existing.write_bytes(b"original")
        with patch.dict(os.environ, {"KNOWLEDGE_UPLOAD_TOKEN": "a" * 40}):
            response = self.upload("a" * 40, b"x" * (10 * 1024 * 1024 + 1))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(existing.read_bytes(), b"original")
        self.assertEqual(list(self.upload_path.iterdir()), [existing])


if __name__ == "__main__":
    unittest.main()
