-- Messages between the tenant and the technician on each work order (Steve, 2026-11-17): chat, "On my way", and
-- visit times. Everything stays in Home Care: no texts, and neither side sees the other's number through it.
CREATE TABLE wo_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  sender TEXT NOT NULL,           -- tenant | tech | office
  sender_name TEXT NOT NULL,      -- as shown in the chat, e.g. "Marcelo (Real Creative Maintenance)"
  kind TEXT NOT NULL,             -- text | on_my_way | propose | confirm
  body TEXT NOT NULL,
  visit_day TEXT,                 -- propose/confirm: YYYY-MM-DD
  visit_start TEXT,               -- propose/confirm: HH:MM, start of a 2-hour window
  created_at TEXT NOT NULL
);
CREATE INDEX wo_messages_wo ON wo_messages(work_order_id, id);

-- The visit time as it stands: suggested by one side, or confirmed.
ALTER TABLE work_orders ADD COLUMN visit_day TEXT;
ALTER TABLE work_orders ADD COLUMN visit_start TEXT;
ALTER TABLE work_orders ADD COLUMN visit_status TEXT;   -- proposed | confirmed
ALTER TABLE work_orders ADD COLUMN visit_by TEXT;       -- tenant | tech | office: who suggested or set it
-- The newest message each side has seen, for "new message" marks and to avoid repeat emails.
ALTER TABLE work_orders ADD COLUMN tenant_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN tech_seen INTEGER NOT NULL DEFAULT 0;
