#!/usr/bin/env python3
"""LAN coordination service for Legma document presence and save hashes."""

from __future__ import annotations

import argparse
import datetime as dt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sqlite3
from typing import Any


DEFAULT_PORT = 8714
DEFAULT_LEASE_SECONDS = 120
MAX_BODY_BYTES = 256 * 1024
DOCUMENT_KINDS = {"artifact", "reference", "prototype"}


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_time(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def connect_db(path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS document_save (
            project_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            document_key TEXT NOT NULL,
            path TEXT NOT NULL,
            content_hash TEXT,
            actor_id TEXT NOT NULL,
            user_name TEXT NOT NULL,
            saved_at TEXT NOT NULL,
            PRIMARY KEY (project_id, document_id)
        );

        CREATE TABLE IF NOT EXISTS editing_lease (
            project_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            document_key TEXT NOT NULL,
            path TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            user_name TEXT NOT NULL,
            session_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            PRIMARY KEY (project_id, document_id, actor_id, session_id)
        );

        CREATE INDEX IF NOT EXISTS editing_lease_expiry
        ON editing_lease (expires_at);
        """
    )
    conn.commit()


def required_text(value: object, field: str, maximum: int = 2048) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    cleaned = " ".join(value.strip().split()) if field.endswith("userName") else value.strip()
    if not cleaned:
        raise ValueError(f"{field} is required")
    if len(cleaned) > maximum:
        raise ValueError(f"{field} is too long")
    return cleaned


def project_id(payload: dict[str, Any]) -> str:
    return required_text(payload.get("projectId"), "projectId", 128)


def actor(payload: dict[str, Any]) -> tuple[str, str]:
    value = payload.get("actor")
    if not isinstance(value, dict):
        raise ValueError("actor is required")
    return (
        required_text(value.get("actorId"), "actor.actorId", 128),
        required_text(value.get("userName"), "actor.userName", 128),
    )


def document(value: object, field: str = "document") -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    kind = required_text(value.get("kind"), f"{field}.kind", 32)
    if kind not in DOCUMENT_KINDS:
        raise ValueError(f"{field}.kind is invalid")
    key = required_text(value.get("key"), f"{field}.key", 256)
    path = required_text(value.get("path"), f"{field}.path", 2048).replace("\\", "/")
    return {"id": f"{kind}:{key}", "kind": kind, "key": key, "path": path}


def documents(payload: dict[str, Any]) -> list[dict[str, str]]:
    values = payload.get("documents")
    if not isinstance(values, list) or len(values) > 256:
        raise ValueError("documents must be an array with at most 256 entries")
    parsed = [document(value, f"documents[{index}]") for index, value in enumerate(values)]
    if len({value["id"] for value in parsed}) != len(parsed):
        raise ValueError("documents must not contain duplicate identities")
    return parsed


def prune_expired(conn: sqlite3.Connection, now: dt.datetime) -> None:
    conn.execute("DELETE FROM editing_lease WHERE expires_at <= ?", (iso_time(now),))


def sync_presence(
    conn: sqlite3.Connection,
    payload: dict[str, Any],
    now: dt.datetime | None = None,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
) -> dict[str, object]:
    current = now or utc_now()
    project = project_id(payload)
    actor_id, user_name = actor(payload)
    session_id = required_text(payload.get("sessionId"), "sessionId", 128)
    active_documents = documents(payload)
    expires_at = iso_time(current + dt.timedelta(seconds=lease_seconds))
    seen_at = iso_time(current)
    prune_expired(conn, current)
    active_ids = {entry["id"] for entry in active_documents}
    for entry in active_documents:
        conn.execute(
            """
            INSERT INTO editing_lease (
                project_id, document_id, kind, document_key, path,
                actor_id, user_name, session_id, started_at, last_seen_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, document_id, actor_id, session_id) DO UPDATE SET
                kind=excluded.kind,
                document_key=excluded.document_key,
                path=excluded.path,
                user_name=excluded.user_name,
                last_seen_at=excluded.last_seen_at,
                expires_at=excluded.expires_at
            """,
            (
                project,
                entry["id"],
                entry["kind"],
                entry["key"],
                entry["path"],
                actor_id,
                user_name,
                session_id,
                seen_at,
                seen_at,
                expires_at,
            ),
        )
    rows = conn.execute(
        "SELECT document_id FROM editing_lease WHERE project_id=? AND actor_id=? AND session_id=?",
        (project, actor_id, session_id),
    ).fetchall()
    for row in rows:
        if row["document_id"] not in active_ids:
            conn.execute(
                "DELETE FROM editing_lease WHERE project_id=? AND document_id=? AND actor_id=? AND session_id=?",
                (project, row["document_id"], actor_id, session_id),
            )
    conn.commit()
    return {"ok": True, "expiresAt": expires_at}


def record_saves(conn: sqlite3.Connection, payload: dict[str, Any], now: dt.datetime | None = None) -> dict[str, object]:
    current = now or utc_now()
    project = project_id(payload)
    actor_id, user_name = actor(payload)
    saved_documents = documents(payload)
    raw_documents = payload["documents"]
    saved_at = iso_time(current)
    for index, entry in enumerate(saved_documents):
        content_hash = raw_documents[index].get("contentHash")
        if content_hash is not None:
            content_hash = required_text(content_hash, f"documents[{index}].contentHash", 128)
        conn.execute(
            """
            INSERT INTO document_save (
                project_id, document_id, kind, document_key, path,
                content_hash, actor_id, user_name, saved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, document_id) DO UPDATE SET
                kind=excluded.kind,
                document_key=excluded.document_key,
                path=excluded.path,
                content_hash=excluded.content_hash,
                actor_id=excluded.actor_id,
                user_name=excluded.user_name,
                saved_at=excluded.saved_at
            """,
            (
                project,
                entry["id"],
                entry["kind"],
                entry["key"],
                entry["path"],
                content_hash,
                actor_id,
                user_name,
                saved_at,
            ),
        )
    conn.commit()
    return {"ok": True, "savedAt": saved_at}


def query_status(conn: sqlite3.Connection, payload: dict[str, Any], now: dt.datetime | None = None) -> dict[str, object]:
    current = now or utc_now()
    project = project_id(payload)
    requested = documents(payload)
    prune_expired(conn, current)
    result: list[dict[str, object]] = []
    for entry in requested:
        editor_rows = conn.execute(
            """
            SELECT actor_id, user_name, session_id, started_at, last_seen_at
            FROM editing_lease
            WHERE project_id=? AND document_id=?
            ORDER BY started_at ASC, user_name ASC
            """,
            (project, entry["id"]),
        ).fetchall()
        save_row = conn.execute(
            """
            SELECT actor_id, user_name, path, content_hash, saved_at
            FROM document_save
            WHERE project_id=? AND document_id=?
            """,
            (project, entry["id"]),
        ).fetchone()
        result.append(
            {
                "document": {"kind": entry["kind"], "key": entry["key"], "path": entry["path"]},
                "editors": [
                    {
                        "actorId": row["actor_id"],
                        "userName": row["user_name"],
                        "sessionId": row["session_id"],
                        "startedAt": row["started_at"],
                        "lastSeenAt": row["last_seen_at"],
                    }
                    for row in editor_rows
                ],
                "latestSave": None
                if save_row is None
                else {
                    "actorId": save_row["actor_id"],
                    "userName": save_row["user_name"],
                    "path": save_row["path"],
                    "contentHash": save_row["content_hash"],
                    "savedAt": save_row["saved_at"],
                },
            }
        )
    conn.commit()
    return {"documents": result, "serverTime": iso_time(current)}


class CoordinationHandler(BaseHTTPRequestHandler):
    server_version = "LegmaCoordination/1.0"

    @property
    def db_path(self) -> str:
        return str(getattr(self.server, "db_path"))

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            self.send_json(200, {"ok": True})
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            payload = self.read_json()
            conn = connect_db(self.db_path)
            try:
                if self.path == "/api/status":
                    result = query_status(conn, payload)
                elif self.path == "/api/presence":
                    result = sync_presence(conn, payload)
                elif self.path == "/api/saves":
                    result = record_saves(conn, payload)
                else:
                    self.send_json(404, {"error": "not found"})
                    return
            finally:
                conn.close()
            self.send_json(200, result)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("request body size is invalid")
        value = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("request body must be an object")
        return value

    def send_json(self, status: int, value: object) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def run_server(host: str, port: int, db_path: str | Path) -> ThreadingHTTPServer:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect_db(path)
    try:
        init_db(conn)
    finally:
        conn.close()
    server = ThreadingHTTPServer((host, port), CoordinationHandler)
    server.db_path = str(path)  # type: ignore[attr-defined]
    return server


def main() -> int:
    parser = argparse.ArgumentParser(description="Legma LAN coordination service")
    parser.add_argument("--host", default=os.environ.get("LEGMA_COLLAB_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("LEGMA_COLLAB_PORT", DEFAULT_PORT)))
    parser.add_argument("--db", default=os.environ.get("LEGMA_COLLAB_DB", str(Path(__file__).with_name("legma_coordination.sqlite3"))))
    args = parser.parse_args()
    server = run_server(args.host, args.port, args.db)
    print(f"Legma coordination server listening on http://{args.host}:{server.server_port} db={args.db}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
