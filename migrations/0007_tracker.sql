-- Vendors F.I.R.M. uses most go first in the Send to list (Steve, 2026-10-26). Lower = higher; NULL = alphabetical after.
ALTER TABLE vendors ADD COLUMN sort_order INTEGER;
UPDATE vendors SET contact = 'Marcelo Moreno', email = 'mmoreno5353@gmail.com', sort_order = 1 WHERE name = 'Real Creative Maintenance';
UPDATE vendors SET sort_order = 2 WHERE name = 'Boss Handyman Services, LLC';
UPDATE vendors SET sort_order = 3, contact = 'Moe' WHERE name = 'Moe Heating and Air, LLC';

-- The work order tracker (modeled on Steve's Maintenance Worksheet): every job given to a vendor, from the app or
-- added by hand, with what F.I.R.M. pays the vendor (cost) and what the owner is charged (owner_price).
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER REFERENCES work_orders(id),  -- set when sent from the app's Work orders page
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  issued_on TEXT NOT NULL,        -- YYYY-MM-DD
  property TEXT NOT NULL,         -- free text: not every home is in Home Care
  work TEXT NOT NULL,
  cost REAL,                      -- what F.I.R.M. owes the vendor
  owner_price REAL,               -- what the owner is charged
  completed_on TEXT,
  vendor_paid_on TEXT,
  notes TEXT
);
CREATE INDEX jobs_vendor ON jobs(vendor_id, completed_on);

-- Rows from the Maintenance Worksheet, 10/26/2026 (Frank = Boss Handyman, Marcelo = Real Creative Maintenance, Moe = Moe Heating and Air).
INSERT INTO jobs (vendor_id, issued_on, property, work, cost, owner_price)
  SELECT id, '2026-08-19', '425 Westham Ridge', 'Fridge leaking', NULL, NULL FROM vendors WHERE name = 'Boss Handyman Services, LLC';
INSERT INTO jobs (vendor_id, issued_on, property, work, cost, owner_price)
  SELECT id, '2026-09-21', '2125 Strawberry Patch', 'Dishwasher and drain backup', NULL, NULL FROM vendors WHERE name = 'Boss Handyman Services, LLC';
INSERT INTO jobs (vendor_id, issued_on, property, work, cost, owner_price)
  SELECT id, '2026-09-15', '80 Todd', 'Basement vapor barrier, insulation, dehumid', 1500, 3800 FROM vendors WHERE name = 'Real Creative Maintenance';
INSERT INTO jobs (vendor_id, issued_on, property, work, cost, owner_price)
  SELECT id, '2026-09-01', '8955 Meadow Vista', 'Garage remote', NULL, NULL FROM vendors WHERE name = 'Real Creative Maintenance';
INSERT INTO jobs (vendor_id, issued_on, property, work, cost, owner_price)
  SELECT id, '2026-08-17', '12474 Stone Garden', 'AC condensate pan', NULL, NULL FROM vendors WHERE name = 'Moe Heating and Air, LLC';
INSERT INTO jobs (vendor_id, issued_on, property, work, cost, owner_price)
  SELECT id, '2026-09-22', '11312 Walland', 'Replacement', 7300, 8200 FROM vendors WHERE name = 'Moe Heating and Air, LLC';
