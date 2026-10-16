'use strict';
const {DatabaseSync}=require('node:sqlite');const {sha}=require('./util.cjs');
class Store{constructor(file){this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS source_files(id TEXT PRIMARY KEY,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,original TEXT NOT NULL,format TEXT NOT NULL,normalised TEXT,content_hash TEXT NOT NULL,group_id TEXT,malformed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS occurrences(record_id TEXT NOT NULL,file_id TEXT NOT NULL,ordinal INTEGER NOT NULL,line_hash TEXT,PRIMARY KEY(record_id,file_id,ordinal));
CREATE INDEX IF NOT EXISTS occurrence_records ON occurrences(record_id);
CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,json TEXT NOT NULL);`);this.parent=new Map();this.keyOwner=new Map();this.best=new Map();
this.ins=this.db.prepare('INSERT OR IGNORE INTO records(id,original,format,normalised,content_hash,malformed) VALUES(?,?,?,?,?,?)');this.occ=this.db.prepare('INSERT OR IGNORE INTO occurrences VALUES(?,?,?,?)');}
find(x){let p=this.parent.get(x);if(!p){this.parent.set(x,x);return x;}if(p!==x){p=this.find(p);this.parent.set(x,p);}return p;}
union(a,b){a=this.find(a);b=this.find(b);if(a===b)return;this.parent.set(a<b?b:a,a<b?a:b);}
add(id,original,format,norm,source,ordinal,lineHash,malformed=false){const result=this.ins.run(id,original,format,norm?JSON.stringify(norm):null,sha(original),Number(malformed));this.occ.run(id,source.id,ordinal,lineHash||null);if(!result.changes&&norm){const prior=JSON.parse(this.db.prepare('SELECT normalised FROM records WHERE id=?').get(id).normalised||'{}');if((norm.projectionPriority||0)>(prior.projectionPriority||0))this.db.prepare('UPDATE records SET normalised=? WHERE id=?').run(JSON.stringify(norm),id);}if(!malformed){this.find(id);for(const key of norm.identityKeys){if(this.keyOwner.has(key))this.union(id,this.keyOwner.get(key));else this.keyOwner.set(key,id);}}return Number(result.changes);}
group(){const rank=k=>k.startsWith('procedure-uuid:')?0:k.startsWith('ec-procedure:')?1:k.startsWith('authority-reference:')?2:k.startsWith('procedure:')?3:k.startsWith('url:')?4:k.startsWith('ted-notice:')?5:6;for(const [key,id]of this.keyOwner){const root=this.find(id),old=this.best.get(root);if(!old||rank(key)<rank(old)||rank(key)===rank(old)&&key<old)this.best.set(root,key);}const put=this.db.prepare('UPDATE records SET group_id=? WHERE id=?');this.db.exec('BEGIN');for(const [id]of this.parent){const best=this.best.get(this.find(id));put.run('proc-'+sha(best),id);}this.db.exec('COMMIT; CREATE INDEX IF NOT EXISTS record_groups ON records(group_id)');}
close(){try{this.db.exec('ROLLBACK');}catch{}this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');this.db.close();}}
module.exports={Store};
