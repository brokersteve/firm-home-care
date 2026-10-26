-- Getting tenants onto the home screen: invites to current tenants, and "send me my link" requests from the start page.
ALTER TABLE tenants ADD COLUMN invited_at TEXT;

CREATE TABLE link_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  channel TEXT NOT NULL,          -- email or text
  created_at TEXT NOT NULL
);
CREATE INDEX link_requests_tenant ON link_requests(tenant_id, created_at);
