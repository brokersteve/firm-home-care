-- Copies of Rentec data, refreshed by the nightly sync. Rentec stays the source of truth.
CREATE TABLE properties (
  id TEXT PRIMARY KEY,            -- Rentec property ID
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}', -- JSON of the "HC ..." custom fields
  synced_at TEXT NOT NULL
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,            -- Rentec tenant (renter) ID
  property_id TEXT NOT NULL REFERENCES properties(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  move_in TEXT,                   -- YYYY-MM-DD
  move_out TEXT,                  -- YYYY-MM-DD, null while current
  insurance_expires TEXT,         -- YYYY-MM-DD, from Rentec when available
  active INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL
);
CREATE INDEX tenants_property ON tenants(property_id);

-- One row per reminder email sent, so nothing is sent twice.
CREATE TABLE reminders_sent (
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,             -- filter, detector_test, ...
  due_date TEXT NOT NULL,         -- YYYY-MM-DD the reminder was for
  sent_at TEXT NOT NULL,
  done_at TEXT,                   -- set when the tenant taps Done
  PRIMARY KEY (tenant_id, kind, due_date)
);

-- Every finished troubleshooting session: fixed, or turned into a work order.
CREATE TABLE guide_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  guide_id TEXT NOT NULL,
  outcome TEXT NOT NULL,          -- fixed | work_order | emergency
  steps TEXT NOT NULL,            -- JSON list of the answers the tenant gave
  work_order_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  properties INTEGER,
  tenants INTEGER,
  error TEXT
);
