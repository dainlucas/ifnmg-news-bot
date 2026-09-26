import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function testDatabase(through = '9999') {
  const sql=new DatabaseSync(':memory:');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter(f => f.endsWith('.sql') && f.slice(0,4) <= through).sort()) {
    sql.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  class Statement {
    constructor(public text:string,public params:any[]=[]) {}
    bind(...params:any[]) { return new Statement(this.text,params); }
    async first(column?:string) { const row=sql.prepare(this.text).get(...this.params) as any; return column?row?.[column]??null:row??null; }
    async all() { return {success:true,results:sql.prepare(this.text).all(...this.params),meta:{}}; }
    async run() { return {success:true,results:[],meta:sql.prepare(this.text).run(...this.params)}; }
  }
  const db={
    prepare:(text:string)=>new Statement(text),
    async batch(statements:Statement[]) {
      sql.exec('BEGIN');
      try { const result=[]; for(const s of statements) result.push(await s.all()); sql.exec('COMMIT');return result; }
      catch(e) { sql.exec('ROLLBACK');throw e; }
    },
  } as unknown as D1Database;
  return {db,sql};
}
