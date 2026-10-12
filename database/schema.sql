PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    switch_time REAL,
    current REAL NOT NULL,
    nominal_current REAL NOT NULL,
    temperature REAL NOT NULL,
    voltage REAL NOT NULL,
    control INTEGER NOT NULL DEFAULT 1,
    cycles INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    forced_bad INTEGER NOT NULL DEFAULT 0,
    position TEXT NOT NULL DEFAULT '—',
    occupied INTEGER NOT NULL DEFAULT 0,
    lamp INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_time TEXT NOT NULL,
    device_id TEXT NOT NULL,
    message TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'bad')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_device_id
    ON events (device_id);

CREATE INDEX IF NOT EXISTS idx_events_created_at
    ON events (created_at);

CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    priority TEXT NOT NULL,
    reason TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'Открыта',
    created_model_time TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tickets_state
    ON tickets (state);

CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_time TEXT NOT NULL,
    device_id TEXT NOT NULL,
    health REAL NOT NULL,
    switch_time REAL,
    current REAL NOT NULL,
    temperature REAL NOT NULL,
    voltage REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telemetry_device_id
    ON telemetry (device_id, id);
