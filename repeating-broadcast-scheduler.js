const fs=require("node:fs");const path=require("node:path");const Database=require("better-sqlite3");

const DEFAULT_INTERVAL_MS=10*60*1000, RETRY_INTERVAL_MS=30*1000;

function createRepeatingBroadcastScheduler({dataDir,getOfficialGroupId,isReady,isStorageBlocked,isAllowedGroup,validateMessage,send,audit=()=>{},now=()=>Date.now(),intervalMs=DEFAULT_INTERVAL_MS}={}){

 if(!dataDir)throw new Error("dataDir is required");fs.mkdirSync(dataDir,{recursive:true});

 const db=new Database(path.join(dataDir,"repeating-broadcast.sqlite"));db.pragma("journal_mode=WAL");db.pragma("busy_timeout=5000");

 db.exec(`CREATE TABLE IF NOT EXISTS repeating_broadcasts(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,group_id TEXT,message TEXT,interval_ms INTEGER NOT NULL DEFAULT ${DEFAULT_INTERVAL_MS},next_run_at INTEGER,last_sent_at INTEGER,last_error TEXT,updated_at INTEGER NOT NULL)`);

 const read=()=>db.prepare("SELECT * FROM repeating_broadcasts WHERE id=1").get()||null;let timer=null,inFlight=false;

 const state=()=>{const r=read();if(!r)return{enabled:false,groupId:null,message:null,intervalMs,nextRunAt:null,lastSentAt:null,lastError:null};return{enabled:!!r.enabled,groupId:r.group_id||null,message:r.message||null,intervalMs:Number(r.interval_ms)||intervalMs,nextRunAt:r.next_run_at?new Date(Number(r.next_run_at)).toISOString():null,lastSentAt:r.last_sent_at?new Date(Number(r.last_sent_at)).toISOString():null,lastError:r.last_error||null};};

 async function tick(){if(inFlight)return;const r=read(),t=now();if(!r||!r.enabled||!r.next_run_at||Number(r.next_run_at)>t)return;inFlight=true;const retry=t+RETRY_INTERVAL_MS;db.prepare("UPDATE repeating_broadcasts SET next_run_at=?,last_error=NULL,updated_at=? WHERE id=1 AND enabled=1").run(retry,t);try{const official=String(getOfficialGroupId()||"").trim();if(!official||r.group_id!==official||!isAllowedGroup(r.group_id))throw new Error("official_group_mismatch");if(!isReady())throw new Error("whatsapp_not_ready");if(isStorageBlocked())throw new Error("whatsapp_storage_send_blocked");await send(r.group_id,r.message);const sent=now();db.prepare("UPDATE repeating_broadcasts SET next_run_at=?,last_sent_at=?,last_error=NULL,updated_at=? WHERE id=1 AND enabled=1").run(sent+(Number(r.interval_ms)||intervalMs),sent,sent);audit("owner.repeating_broadcast.sent","group",r.group_id,{messageLength:String(r.message||"").length});}catch(e){const detail=String(e?.message||e).slice(0,240);db.prepare("UPDATE repeating_broadcasts SET next_run_at=?,last_error=?,updated_at=? WHERE id=1 AND enabled=1").run(retry,detail,now());audit("owner.repeating_broadcast.failed","group",r.group_id,{error:detail});}finally{inFlight=false;}}

 function ensureTimer(){if(timer)return;timer=setInterval(()=>void tick(),Math.min(RETRY_INTERVAL_MS,60000));timer.unref?.();}

 return{start({groupId,message}){const g=String(groupId||"").trim(),m=String(message||"").trim(),official=String(getOfficialGroupId()||"").trim();if(!g||g!==official||!isAllowedGroup(g))throw new Error("official_group_mismatch");if(!m||m.length>2000||m.includes("\u0000")||(validateMessage&&!validateMessage(m)))throw new Error("message_not_allowed");const t=now();db.prepare(`INSERT INTO repeating_broadcasts(id,enabled,group_id,message,interval_ms,next_run_at,last_sent_at,last_error,updated_at) VALUES(1,1,?,?,?, ?,NULL,NULL,?) ON CONFLICT(id) DO UPDATE SET enabled=1,group_id=excluded.group_id,message=excluded.message,interval_ms=excluded.interval_ms,next_run_at=excluded.next_run_at,last_error=NULL,updated_at=excluded.updated_at`).run(g,m,intervalMs,t,t);ensureTimer();void tick();return state();},stop(){const t=now();db.prepare("UPDATE repeating_broadcasts SET enabled=0,next_run_at=NULL,last_error=NULL,updated_at=? WHERE id=1").run(t);return state();},status:state,startLoop(){ensureTimer();void tick();},close(){if(timer)clearInterval(timer);timer=null;if(db.open)db.close();}};}

module.exports={createRepeatingBroadcastScheduler,DEFAULT_INTERVAL_MS};

