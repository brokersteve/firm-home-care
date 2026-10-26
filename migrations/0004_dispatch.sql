-- Work orders sent on to maintenance or a vendor from the admin page.
ALTER TABLE tenants ADD COLUMN phone TEXT;

CREATE TABLE vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trade TEXT,                     -- e.g. Plumbing, HVAC, General
  email TEXT,
  phone TEXT,                     -- cell, for texts
  active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO vendors (name, trade) VALUES ('F.I.R.M. Maintenance', 'General');

-- Every work order a tenant submits through the app, as sent to Rentec.
CREATE TABLE work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rentec_id TEXT,
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  guide_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,      -- the full text filed in Rentec
  contact_phone TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  vendor_id INTEGER REFERENCES vendors(id),
  notes TEXT,                     -- F.I.R.M.'s notes added when sending
  sent_at TEXT
);
CREATE INDEX work_orders_created ON work_orders(created_at);

-- Texts waiting for 8am, because none go out between 9pm and 8am.
CREATE TABLE texts_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  to_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  send_after TEXT NOT NULL,       -- ISO time
  sent_at TEXT,
  error TEXT
);
