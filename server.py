from __future__ import annotations

import json
import logging
import mimetypes
import sqlite3
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
DATABASE_DIR = ROOT / "database"
LOGS_DIR = ROOT / "logs"
DATABASE_PATH = DATABASE_DIR / "smart_scb.db"
SCHEMA_PATH = DATABASE_DIR / "schema.sql"
SEED_PATH = DATABASE_DIR / "seed.sql"
HOST = "127.0.0.1"
PORT = 8080

DATABASE_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)

logger = logging.getLogger("smart_scb")
logger.setLevel(logging.INFO)
formatter = logging.Formatter(
    "%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

file_handler = RotatingFileHandler(
    LOGS_DIR / "smart_scb.log",
    maxBytes=1_000_000,
    backupCount=5,
    encoding="utf-8",
)
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def initialize_database() -> None:
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    seed = SEED_PATH.read_text(encoding="utf-8")
    with connect() as connection:
        connection.executescript(schema)
        connection.executescript(seed)
    logger.info("database initialized | path=%s", DATABASE_PATH)


class SmartScbHandler(BaseHTTPRequestHandler):
    server_version = "SmartSCB/1.0"

    def log_message(self, format_string: str, *args: object) -> None:
        logger.info(
            "http | client=%s | %s",
            self.client_address[0],
            format_string % args,
        )

    def send_json(self, payload: object, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Некорректный Content-Length") from error

        if length <= 0 or length > 1_000_000:
            raise ValueError("Тело запроса отсутствует или слишком велико")

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Ожидался корректный JSON") from error

        if not isinstance(payload, dict):
            raise ValueError("Корнем JSON должен быть объект")
        return payload

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            self.send_json(
                {
                    "status": "ok",
                    "database": DATABASE_PATH.name,
                    "time": utc_now(),
                }
            )
            return

        if parsed.path == "/api/devices":
            self.get_devices()
            return

        if parsed.path == "/api/events":
            self.get_events(parse_qs(parsed.query))
            return

        if parsed.path == "/api/tickets":
            self.get_tickets()
            return

        if parsed.path == "/api/telemetry":
            self.get_telemetry(parse_qs(parsed.query))
            return

        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            payload = self.read_json()

            if parsed.path == "/api/devices":
                self.save_devices(payload)
                return

            if parsed.path == "/api/events":
                self.create_event(payload)
                return

            if parsed.path == "/api/tickets":
                self.create_ticket(payload)
                return

            if parsed.path == "/api/telemetry":
                self.create_telemetry(payload)
                return

            self.send_json({"error": "Маршрут не найден"}, HTTPStatus.NOT_FOUND)
        except ValueError as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except sqlite3.Error:
            logger.exception("database error | method=POST | path=%s", parsed.path)
            self.send_json(
                {"error": "Ошибка базы данных"},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path != "/api/events":
            self.send_json({"error": "Маршрут не найден"}, HTTPStatus.NOT_FOUND)
            return

        try:
            with connect() as connection:
                deleted = connection.execute("DELETE FROM events").rowcount
            logger.info("events cleared | deleted=%s", deleted)
            self.send_json({"deleted": deleted})
        except sqlite3.Error:
            logger.exception("database error | method=DELETE | path=%s", parsed.path)
            self.send_json(
                {"error": "Ошибка базы данных"},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def get_devices(self) -> None:
        with connect() as connection:
            rows = connection.execute(
                """
                SELECT id, type, name, switch_time, current,
                       nominal_current, temperature, voltage, control,
                       cycles, failures, forced_bad, position,
                       occupied, lamp, updated_at
                FROM devices
                ORDER BY id
                """
            ).fetchall()
        self.send_json({"devices": [dict(row) for row in rows]})

    def save_devices(self, payload: dict) -> None:
        items = payload.get("devices")
        if not isinstance(items, list) or not items:
            raise ValueError("Поле devices должно содержать непустой массив")
        if len(items) > 100:
            raise ValueError("За один запрос принимается не более 100 устройств")

        records = []
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("Каждое устройство должно быть объектом")
            records.append(
                (
                    self.clean_text(item.get("id"), "id", 32),
                    self.clean_text(item.get("type"), "type", 32),
                    self.clean_text(item.get("name"), "name", 100),
                    self.optional_number(item.get("switch_time")),
                    self.number(item.get("current"), "current"),
                    self.number(
                        item.get("nominal_current"),
                        "nominal_current",
                    ),
                    self.number(item.get("temperature"), "temperature"),
                    self.number(item.get("voltage"), "voltage"),
                    int(bool(item.get("control", True))),
                    int(self.number(item.get("cycles", 0), "cycles")),
                    int(self.number(item.get("failures", 0), "failures")),
                    int(bool(item.get("forced_bad", False))),
                    self.clean_text(
                        item.get("position", "—"),
                        "position",
                        32,
                    ),
                    int(bool(item.get("occupied", False))),
                    int(bool(item.get("lamp", True))),
                )
            )

        with connect() as connection:
            connection.executemany(
                """
                INSERT INTO devices (
                    id, type, name, switch_time, current,
                    nominal_current, temperature, voltage, control,
                    cycles, failures, forced_bad, position,
                    occupied, lamp
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    type = excluded.type,
                    name = excluded.name,
                    switch_time = excluded.switch_time,
                    current = excluded.current,
                    nominal_current = excluded.nominal_current,
                    temperature = excluded.temperature,
                    voltage = excluded.voltage,
                    control = excluded.control,
                    cycles = excluded.cycles,
                    failures = excluded.failures,
                    forced_bad = excluded.forced_bad,
                    position = excluded.position,
                    occupied = excluded.occupied,
                    lamp = excluded.lamp,
                    updated_at = CURRENT_TIMESTAMP
                """,
                records,
            )

        logger.info("device parameters saved | devices=%s", len(records))
        self.send_json({"saved": len(records)}, HTTPStatus.CREATED)

    def get_events(self, query: dict[str, list[str]]) -> None:
        limit = self.parse_limit(query, default=100, maximum=500)
        with connect() as connection:
            rows = connection.execute(
                """
                SELECT id, model_time, device_id, message, level, created_at
                FROM events
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        self.send_json({"events": [dict(row) for row in rows]})

    def get_tickets(self) -> None:
        with connect() as connection:
            rows = connection.execute(
                """
                SELECT id, device_id, priority, reason, state,
                       created_model_time, created_at
                FROM tickets
                ORDER BY id DESC
                LIMIT 100
                """
            ).fetchall()
        self.send_json({"tickets": [dict(row) for row in rows]})

    def get_telemetry(self, query: dict[str, list[str]]) -> None:
        device_id = self.clean_text(
            query.get("device_id", [""])[0],
            "device_id",
            32,
            required=True,
        )
        limit = self.parse_limit(query, default=72, maximum=500)
        with connect() as connection:
            rows = connection.execute(
                """
                SELECT id, model_time, device_id, health, switch_time,
                       current, temperature, voltage, status, created_at
                FROM telemetry
                WHERE device_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (device_id, limit),
            ).fetchall()
        self.send_json(
            {"telemetry": [dict(row) for row in reversed(rows)]}
        )

    def create_event(self, payload: dict) -> None:
        model_time = self.clean_text(payload.get("model_time"), "model_time", 32)
        device_id = self.clean_text(payload.get("device_id"), "device_id", 32)
        message = self.clean_text(payload.get("message"), "message", 500)
        level = self.clean_level(payload.get("level"))

        with connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO events (model_time, device_id, message, level)
                VALUES (?, ?, ?, ?)
                """,
                (model_time, device_id, message, level),
            )
            event_id = cursor.lastrowid

        logger.info(
            "event | id=%s | model_time=%s | device=%s | level=%s | message=%s",
            event_id,
            model_time,
            device_id,
            level,
            message,
        )
        self.send_json({"id": event_id}, HTTPStatus.CREATED)

    def create_ticket(self, payload: dict) -> None:
        device_id = self.clean_text(payload.get("device_id"), "device_id", 32)
        priority = self.clean_text(payload.get("priority"), "priority", 32)
        reason = self.clean_text(payload.get("reason"), "reason", 300)
        state = self.clean_text(
            payload.get("state", "Открыта"),
            "state",
            32,
        )
        model_time = self.clean_text(
            payload.get("created_model_time"),
            "created_model_time",
            32,
        )

        with connect() as connection:
            existing = connection.execute(
                """
                SELECT id
                FROM tickets
                WHERE device_id = ? AND state = 'Открыта'
                LIMIT 1
                """,
                (device_id,),
            ).fetchone()

            if existing:
                self.send_json(
                    {
                        "id": existing["id"],
                        "message": "Открытая заявка уже существует",
                    }
                )
                return

            cursor = connection.execute(
                """
                INSERT INTO tickets (
                    device_id, priority, reason, state, created_model_time
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (device_id, priority, reason, state, model_time),
            )
            ticket_id = cursor.lastrowid

        logger.info(
            "ticket created | id=%s | device=%s | priority=%s | reason=%s",
            ticket_id,
            device_id,
            priority,
            reason,
        )
        self.send_json({"id": ticket_id}, HTTPStatus.CREATED)

    def create_telemetry(self, payload: dict) -> None:
        samples = payload.get("samples")
        if not isinstance(samples, list) or not samples:
            raise ValueError("Поле samples должно содержать непустой массив")
        if len(samples) > 100:
            raise ValueError("За один запрос принимается не более 100 записей")

        records = []
        for sample in samples:
            if not isinstance(sample, dict):
                raise ValueError("Каждая запись телеметрии должна быть объектом")

            records.append(
                (
                    self.clean_text(
                        sample.get("model_time"),
                        "model_time",
                        32,
                    ),
                    self.clean_text(
                        sample.get("device_id"),
                        "device_id",
                        32,
                    ),
                    self.number(sample.get("health"), "health"),
                    self.optional_number(sample.get("switch_time")),
                    self.number(sample.get("current"), "current"),
                    self.number(sample.get("temperature"), "temperature"),
                    self.number(sample.get("voltage"), "voltage"),
                    self.clean_text(sample.get("status"), "status", 16),
                )
            )

        with connect() as connection:
            connection.executemany(
                """
                INSERT INTO telemetry (
                    model_time, device_id, health, switch_time,
                    current, temperature, voltage, status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                records,
            )

        logger.info(
            "telemetry saved | model_time=%s | samples=%s",
            records[0][0],
            len(records),
        )
        self.send_json({"saved": len(records)}, HTTPStatus.CREATED)

    def serve_static(self, requested_path: str) -> None:
        relative_path = requested_path.lstrip("/") or "index.html"
        candidate = (PUBLIC_DIR / relative_path).resolve()

        try:
            candidate.relative_to(PUBLIC_DIR.resolve())
        except ValueError:
            self.send_error(HTTPStatus.FORBIDDEN)
            return

        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content = candidate.read_bytes()
        content_type = (
            mimetypes.guess_type(candidate.name)[0]
            or "application/octet-stream"
        )
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header(
            "Cache-Control",
            "no-cache" if candidate.suffix in {".html", ".js", ".css"} else "public, max-age=3600",
        )
        self.end_headers()
        self.wfile.write(content)

    @staticmethod
    def parse_limit(
        query: dict[str, list[str]],
        default: int,
        maximum: int,
    ) -> int:
        try:
            value = int(query.get("limit", [str(default)])[0])
        except ValueError:
            value = default
        return max(1, min(value, maximum))

    @staticmethod
    def clean_text(
        value: object,
        field: str,
        maximum: int,
        required: bool = True,
    ) -> str:
        text = "" if value is None else str(value).strip()
        if required and not text:
            raise ValueError(f"Поле {field} обязательно")
        if len(text) > maximum:
            raise ValueError(f"Поле {field} слишком длинное")
        return text

    @staticmethod
    def clean_level(value: object) -> str:
        level = str(value or "info").strip().lower()
        if level not in {"info", "warn", "bad"}:
            raise ValueError("Уровень должен быть info, warn или bad")
        return level

    @staticmethod
    def number(value: object, field: str) -> float:
        if isinstance(value, bool):
            raise ValueError(f"Поле {field} должно быть числом")
        try:
            return float(value)
        except (TypeError, ValueError) as error:
            raise ValueError(f"Поле {field} должно быть числом") from error

    @staticmethod
    def optional_number(value: object) -> float | None:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError) as error:
            raise ValueError("Некорректное числовое значение") from error


def run() -> None:
    initialize_database()
    server = ThreadingHTTPServer((HOST, PORT), SmartScbHandler)
    logger.info("server started | url=http://%s:%s", HOST, PORT)
    print(f"SMART SCB: http://{HOST}:{PORT}")
    print("Для остановки нажмите Ctrl+C")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен.")
    finally:
        server.server_close()
        logger.info("server stopped")


if __name__ == "__main__":
    run()
