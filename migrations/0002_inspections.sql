-- Move-in, move-out and routine inspections, done by F.I.R.M. staff or (move-in) by the tenant.
CREATE TABLE inspections (
  id TEXT PRIMARY KEY,              -- random
  property_id TEXT NOT NULL REFERENCES properties(id),
  tenant_id TEXT,                   -- set for tenant move-in forms
  kind TEXT NOT NULL,               -- move_in | move_out | routine
  done_by TEXT NOT NULL,            -- staff | tenant
  status TEXT NOT NULL DEFAULT 'draft', -- draft | complete
  rooms TEXT NOT NULL,              -- JSON: [{name, items: [{name, condition, note, photos: [url]}]}]
  signed_name TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  report_key TEXT,                  -- R2 key of the PDF report
  uploaded_to_rentec INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX inspections_property ON inspections(property_id);
CREATE INDEX inspections_tenant ON inspections(tenant_id);
