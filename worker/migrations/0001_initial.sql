CREATE TABLE batteries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial TEXT NOT NULL UNIQUE,
  capacity_mah INTEGER NOT NULL,
  cell_count INTEGER NOT NULL,
  purchased_date TEXT NOT NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battery_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('charged', 'used')),
  final_avg_voltage REAL,
  notes TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (battery_id) REFERENCES batteries (id) ON DELETE CASCADE
);

CREATE INDEX idx_batteries_archived ON batteries (archived);
CREATE INDEX idx_usage_events_battery_time ON usage_events (battery_id, occurred_at DESC);
CREATE INDEX idx_usage_events_type ON usage_events (event_type);

