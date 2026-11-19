export function initializeSchema(db, schema) {
  db.exec('PRAGMA busy_timeout = 5000;');
  const userTable = () => db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='users'").get();
  const needsClientRole = (table) => table && !table.sql.includes("'client'");
  const previous = userTable();
  if (!needsClientRole(previous)) {
    db.exec(schema);
    return false;
  }

  const userDefinition = schema.match(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\) STRICT;/)?.[0];
  if (!userDefinition) throw new Error('Chybí schéma účtů.');
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN IMMEDIATE;');
    try {
      if (needsClientRole(userTable())) {
        db.exec(userDefinition.replace('IF NOT EXISTS users', 'leadforce_users_new') + `
          INSERT INTO leadforce_users_new (id,workspace_id,email,name,password,role,enabled)
          SELECT id,workspace_id,email,name,password,role,enabled FROM users;
          DROP TABLE users;
          ALTER TABLE leadforce_users_new RENAME TO users;
        `);
      }
      db.exec(schema);
      if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Aktualizaci vazeb účtů se nepodařilo ověřit.');
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  return true;
}
