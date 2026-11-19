PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','marketing','agent','care','investor','client')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  UNIQUE (workspace_id,email), UNIQUE (workspace_id,id)
) STRICT;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expires INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS invitations (
  token_hash TEXT PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL COLLATE NOCASE, role TEXT NOT NULL,
  expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, lead_id INTEGER,
  FOREIGN KEY (workspace_id,lead_id) REFERENCES leads(workspace_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS invitations_workspace_email ON invitations(workspace_id,email);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE,
  project TEXT NOT NULL, source TEXT NOT NULL, campaign TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','qualified','handed','closed')),
  owner_id INTEGER, investor_id INTEGER, created_at TEXT NOT NULL, handed_at TEXT, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id,id), UNIQUE (workspace_id,email,source,campaign),
  FOREIGN KEY (workspace_id,owner_id) REFERENCES users(workspace_id,id),
  FOREIGN KEY (workspace_id,investor_id) REFERENCES users(workspace_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS leads_queue ON leads(workspace_id,stage,owner_id);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL, author_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id,lead_id) REFERENCES leads(workspace_id,id),
  FOREIGN KEY (workspace_id,author_id) REFERENCES users(workspace_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS notes_lead ON notes(workspace_id,lead_id,id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL, actor_id INTEGER NOT NULL, lead_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('assignment','note')),
  created_at TEXT NOT NULL, read_at TEXT,
  FOREIGN KEY (workspace_id,user_id) REFERENCES users(workspace_id,id),
  FOREIGN KEY (workspace_id,actor_id) REFERENCES users(workspace_id,id),
  FOREIGN KEY (workspace_id,lead_id) REFERENCES leads(workspace_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(workspace_id,user_id,id);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL, owner_id INTEGER NOT NULL, title TEXT NOT NULL, due TEXT NOT NULL,
  done_at TEXT,
  FOREIGN KEY (workspace_id,lead_id) REFERENCES leads(workspace_id,id),
  FOREIGN KEY (workspace_id,owner_id) REFERENCES users(workspace_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(workspace_id,owner_id,due);
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, investor_id INTEGER NOT NULL,
  project TEXT NOT NULL, principal_cents INTEGER NOT NULL CHECK (principal_cents >= 0),
  maturity TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','closed')),
  FOREIGN KEY (workspace_id,investor_id) REFERENCES users(workspace_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS positions_investor ON positions(workspace_id,investor_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, investor_id INTEGER NOT NULL, author_id INTEGER NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT, read_at TEXT,
  FOREIGN KEY (workspace_id,investor_id) REFERENCES users(workspace_id,id),
  FOREIGN KEY (workspace_id,author_id) REFERENCES users(workspace_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS messages_investor ON messages(workspace_id,investor_id,published_at);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, actor_id INTEGER NOT NULL,
  lead_id INTEGER, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id,actor_id) REFERENCES users(workspace_id,id),
  FOREIGN KEY (workspace_id,lead_id) REFERENCES leads(workspace_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS activity_feed ON activity(workspace_id,lead_id,id);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (workspace_id,id), UNIQUE (workspace_id,name)
) STRICT;
CREATE TABLE IF NOT EXISTS client_users (
  workspace_id INTEGER NOT NULL, user_id INTEGER NOT NULL PRIMARY KEY, client_id INTEGER NOT NULL,
  FOREIGN KEY (workspace_id,user_id) REFERENCES users(workspace_id,id),
  FOREIGN KEY (workspace_id,client_id) REFERENCES clients(workspace_id,id)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS invitations_tenant_token ON invitations(workspace_id,token_hash);
CREATE TABLE IF NOT EXISTS client_invitations (
  workspace_id INTEGER NOT NULL, token_hash TEXT NOT NULL PRIMARY KEY, client_id INTEGER NOT NULL,
  FOREIGN KEY (workspace_id,token_hash) REFERENCES invitations(workspace_id,token_hash) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,client_id) REFERENCES clients(workspace_id,id)
) STRICT;
CREATE TABLE IF NOT EXISTS client_campaigns (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, client_id INTEGER NOT NULL,
  name TEXT NOT NULL, project TEXT NOT NULL, source TEXT NOT NULL, code TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (workspace_id,id), UNIQUE (workspace_id,source,code),
  FOREIGN KEY (workspace_id,client_id) REFERENCES clients(workspace_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS client_campaigns_client ON client_campaigns(workspace_id,client_id,id);
CREATE TABLE IF NOT EXISTS client_campaign_costs (
  workspace_id INTEGER NOT NULL, campaign_id INTEGER NOT NULL, day TEXT NOT NULL,
  cost_cents INTEGER NOT NULL CHECK (cost_cents BETWEEN 0 AND 100000000000),
  PRIMARY KEY (workspace_id,campaign_id,day),
  FOREIGN KEY (workspace_id,campaign_id) REFERENCES client_campaigns(workspace_id,id)
) STRICT;
CREATE TABLE IF NOT EXISTS client_leads (
  workspace_id INTEGER NOT NULL, lead_id INTEGER NOT NULL, campaign_id INTEGER NOT NULL, handed_day TEXT,
  PRIMARY KEY (workspace_id,lead_id),
  FOREIGN KEY (workspace_id,lead_id) REFERENCES leads(workspace_id,id),
  FOREIGN KEY (workspace_id,campaign_id) REFERENCES client_campaigns(workspace_id,id)
) STRICT;
CREATE INDEX IF NOT EXISTS client_leads_reports ON client_leads(workspace_id,campaign_id,handed_day,lead_id);

CREATE TABLE IF NOT EXISTS google_ads_campaigns (
  workspace_id INTEGER NOT NULL, campaign_id INTEGER NOT NULL, customer_id TEXT NOT NULL, external_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, last_run TEXT,
  PRIMARY KEY (workspace_id,campaign_id),
  UNIQUE (workspace_id,customer_id,external_id),
  FOREIGN KEY (workspace_id,campaign_id) REFERENCES client_campaigns(workspace_id,id)
) STRICT;
CREATE TABLE IF NOT EXISTS google_ads_days (
  workspace_id INTEGER NOT NULL, campaign_id INTEGER NOT NULL, day TEXT NOT NULL,
  cost_micros TEXT, cost_cents INTEGER CHECK (cost_cents BETWEEN 0 AND 100000000000),
  missing INTEGER NOT NULL CHECK (missing IN (0,1)),
  PRIMARY KEY (workspace_id,campaign_id,day),
  FOREIGN KEY (workspace_id,campaign_id) REFERENCES google_ads_campaigns(workspace_id,campaign_id),
  CHECK ((cost_micros IS NULL) = (cost_cents IS NULL))
) STRICT;
CREATE VIEW IF NOT EXISTS client_report_costs AS
  SELECT manual.workspace_id,manual.campaign_id,manual.day,manual.cost_cents
  FROM client_campaign_costs manual
  WHERE NOT EXISTS (
    SELECT 1 FROM google_ads_days ads WHERE ads.workspace_id=manual.workspace_id AND ads.campaign_id=manual.campaign_id
      AND ads.day=manual.day AND ads.cost_cents IS NOT NULL
  )
  UNION ALL
  SELECT workspace_id,campaign_id,day,cost_cents FROM google_ads_days WHERE cost_cents IS NOT NULL;
