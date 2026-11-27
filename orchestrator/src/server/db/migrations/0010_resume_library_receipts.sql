CREATE TABLE resume_library_receipts (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  library_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  PRIMARY KEY (job_id, operation_id)
);
