function rows(database, sql, params, first) {
  const statement = database.prepare(sql);
  try {
    statement.bind(params);
    if (first) return statement.step() ? statement.getAsObject() : undefined;
    const result = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally {
    statement.free();
  }
}

export function sqliteConnection(database) {
  return {
    exec: (sql) => database.exec(sql),
    close: () => database.close(),
    function(name, _options, callback) { database.create_function(name, callback); },
    prepare(sql) {
      return {
        get: (...params) => rows(database, sql, params, true),
        all: (...params) => rows(database, sql, params, false),
        run(...params) {
          try { database.run(sql, params); } catch (error) {
            if (String(error.message).startsWith('UNIQUE constraint failed:')) error.errcode = 2067;
            throw error;
          }
          return {
            changes: database.getRowsModified(),
            lastInsertRowid: database.exec('SELECT last_insert_rowid()')[0].values[0][0],
          };
        },
      };
    },
  };
}
