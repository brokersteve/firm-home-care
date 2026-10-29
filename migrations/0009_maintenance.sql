-- The maintenance tracker (plan v2): triage, status the tenant can see, what each job is waiting on, owner approval
-- and close-out. Rentec's work order stays the record; these columns sit on top of it.
ALTER TABLE work_orders ADD COLUMN tier TEXT NOT NULL DEFAULT 'routine';  -- emergency | urgent | routine | tenant
ALTER TABLE work_orders ADD COLUMN category TEXT;
ALTER TABLE work_orders ADD COLUMN summary TEXT;
ALTER TABLE work_orders ADD COLUMN flags TEXT;                 -- comma list: accommodation, tenant_damage, pest_after_30, drain, lockout
ALTER TABLE work_orders ADD COLUMN started TEXT;               -- when the tenant says it started
-- What the tenant sees: received | vendor_contacted | scheduled | in_progress | completed
ALTER TABLE work_orders ADD COLUMN status TEXT NOT NULL DEFAULT 'received';
ALTER TABLE work_orders ADD COLUMN waiting_on TEXT;            -- vendor | owner | tenant | parts, or null
ALTER TABLE work_orders ADD COLUMN scheduled_on TEXT;          -- YYYY-MM-DD, set by staff only
ALTER TABLE work_orders ADD COLUMN scheduled_time TEXT;        -- e.g. "9am to noon"
ALTER TABLE work_orders ADD COLUMN estimate REAL;              -- expected cost, for the owner approval limit
ALTER TABLE work_orders ADD COLUMN owner_approved_at TEXT;
ALTER TABLE work_orders ADD COLUMN reviewed_at TEXT;           -- staff reviewed a flagged request
ALTER TABLE work_orders ADD COLUMN completed_at TEXT;
ALTER TABLE work_orders ADD COLUMN tenant_result TEXT;         -- fixed | still_broken
ALTER TABLE work_orders ADD COLUMN tenant_result_at TEXT;
ALTER TABLE work_orders ADD COLUMN rentec_status TEXT;         -- last status read from Rentec (OpenU, OpenA, Parts, Work, Finalized, Closed)
ALTER TABLE work_orders ADD COLUMN updated_at TEXT;            -- last change of any kind; 3 days without one is flagged
UPDATE work_orders SET updated_at = COALESCE(sent_at, created_at),
  status = CASE WHEN sent_at IS NULL THEN 'received' ELSE 'vendor_contacted' END;
CREATE INDEX work_orders_open ON work_orders(status, tier);
CREATE INDEX work_orders_tenant ON work_orders(tenant_id, created_at);

-- What happened, in order. Tenant-visible events are shown on the tenant's status page.
CREATE TABLE work_order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  at TEXT NOT NULL,
  kind TEXT NOT NULL,             -- created, sent, scheduled, in_progress, completed, reopened, approved, triage, note
  text TEXT NOT NULL,
  tenant_visible INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX work_order_events_wo ON work_order_events(work_order_id, at);

-- An owner's own approval limit when it differs from OWNER_APPROVAL_LIMIT.
ALTER TABLE properties ADD COLUMN approval_limit REAL;

-- Close-out: the vendor's invoice, and when the owner was billed.
ALTER TABLE jobs ADD COLUMN invoice_number TEXT;
ALTER TABLE jobs ADD COLUMN owner_billed_on TEXT;
