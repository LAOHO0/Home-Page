import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createDefaultDocument, normalizeDocument } from '../public/model.js';

export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'navigation.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS site (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO site VALUES (1, 1, ?)').run(JSON.stringify(createDefaultDocument()));
  return {
    read() { const row = db.prepare('SELECT * FROM site WHERE id=1').get(); return { revision: row.revision, document: normalizeDocument(JSON.parse(row.document)) }; },
    write(document, revision) {
      const result = db.prepare('UPDATE site SET document=?, revision=revision+1 WHERE id=1 AND revision=?').run(JSON.stringify(document), revision);
      if (!result.changes) { const error = new Error('数据已在其他页面更新，请重新加载后再保存。'); error.status = 409; throw error; }
      return this.read();
    },
    admin() { return db.prepare('SELECT username,salt,hash FROM admin WHERE id=1').get(); },
    createAdmin(username, salt, hash) { return db.prepare('INSERT OR IGNORE INTO admin VALUES (1,?,?,?)').run(username, salt, hash).changes === 1; },
    session(hash, expires) { db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now()); db.prepare('INSERT INTO sessions VALUES (?,?)').run(hash, expires); },
    authenticated(hash) { return !!db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(hash, Date.now()); },
    logout(hash) { db.prepare('DELETE FROM sessions WHERE hash=?').run(hash); },
    close() { db.close(); },
  };
}
