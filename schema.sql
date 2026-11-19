PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','marketing','agent','care','investor')),
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
