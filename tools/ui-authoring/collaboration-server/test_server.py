import datetime as dt
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
import urllib.request


MODULE_PATH = Path(__file__).with_name("legma_coordination_server.py")
SPEC = importlib.util.spec_from_file_location("legma_coordination_server", MODULE_PATH)
assert SPEC and SPEC.loader
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


def document(content_hash: str | None = None) -> dict[str, object]:
    value: dict[str, object] = {
        "kind": "artifact",
        "key": "LoadingCanvas",
        "path": "LoadingCanvas/LoadingCanvas.ui.json",
    }
    if content_hash is not None:
        value["contentHash"] = content_hash
    return value


def payload(user_name: str = "Wen", actor_id: str = "wen-actor") -> dict[str, object]:
    return {
        "projectId": "long",
        "actor": {"actorId": actor_id, "userName": user_name},
        "sessionId": "tab-1",
        "documents": [document()],
    }


class CoordinationServerTests(unittest.TestCase):
    def test_presence_is_renewed_and_empty_sync_releases_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            conn = server.connect_db(Path(tmp) / "coordination.sqlite3")
            server.init_db(conn)
            first = dt.datetime(2026, 7, 29, 10, 0, tzinfo=dt.timezone.utc)
            server.sync_presence(conn, payload(), first)
            server.sync_presence(conn, payload(), first + dt.timedelta(seconds=30))
            result = server.query_status(conn, {"projectId": "long", "documents": [document()]}, first + dt.timedelta(seconds=31))
            self.assertEqual(len(result["documents"][0]["editors"]), 1)
            self.assertEqual(result["documents"][0]["editors"][0]["startedAt"], "2026-07-29T10:00:00.000Z")

            released = payload()
            released["documents"] = []
            server.sync_presence(conn, released, first + dt.timedelta(seconds=32))
            result = server.query_status(conn, {"projectId": "long", "documents": [document()]}, first + dt.timedelta(seconds=33))
            self.assertEqual(result["documents"][0]["editors"], [])
            conn.close()

    def test_expired_presence_is_not_returned(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            conn = server.connect_db(Path(tmp) / "coordination.sqlite3")
            server.init_db(conn)
            first = dt.datetime(2026, 7, 29, 10, 0, tzinfo=dt.timezone.utc)
            server.sync_presence(conn, payload(), first, lease_seconds=120)
            result = server.query_status(conn, {"projectId": "long", "documents": [document()]}, first + dt.timedelta(seconds=121))
            self.assertEqual(result["documents"][0]["editors"], [])
            conn.close()

    def test_latest_save_is_upserted_per_document(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            conn = server.connect_db(Path(tmp) / "coordination.sqlite3")
            server.init_db(conn)
            first = dt.datetime(2026, 7, 29, 10, 0, tzinfo=dt.timezone.utc)
            first_payload = payload()
            first_payload["documents"] = [document("hash-1")]
            server.record_saves(conn, first_payload, first)
            second_payload = payload("Lin", "lin-actor")
            second_payload["documents"] = [document("hash-2")]
            server.record_saves(conn, second_payload, first + dt.timedelta(minutes=1))
            result = server.query_status(conn, {"projectId": "long", "documents": [document()]}, first + dt.timedelta(minutes=2))
            latest = result["documents"][0]["latestSave"]
            self.assertEqual(latest["contentHash"], "hash-2")
            self.assertEqual(latest["userName"], "Lin")
            conn.close()

    def test_http_contract_exposes_health_presence_and_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            httpd = server.run_server("127.0.0.1", 0, Path(tmp) / "coordination.sqlite3")
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{httpd.server_port}"
            try:
                with urllib.request.urlopen(base + "/api/health", timeout=5) as response:
                    self.assertEqual(json.loads(response.read()), {"ok": True})
                request = urllib.request.Request(
                    base + "/api/presence",
                    data=json.dumps(payload()).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    self.assertTrue(json.loads(response.read())["ok"])
                status_request = urllib.request.Request(
                    base + "/api/status",
                    data=json.dumps({"projectId": "long", "documents": [document()]}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(status_request, timeout=5) as response:
                    self.assertEqual(json.loads(response.read())["documents"][0]["editors"][0]["userName"], "Wen")
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
