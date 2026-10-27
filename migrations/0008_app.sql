-- The FIRM phone app: one-time sign-in codes, and the phones that get reminders as push notifications.
CREATE TABLE app_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,        -- HMAC of the 6-digit code; the code itself is never stored
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX app_codes_tenant ON app_codes(tenant_id, expires_at);

CREATE TABLE push_devices (
  token TEXT PRIMARY KEY,         -- Firebase Cloud Messaging token, one per app install
  tenant_id TEXT NOT NULL,
  platform TEXT NOT NULL,         -- ios or android
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX push_devices_tenant ON push_devices(tenant_id);
