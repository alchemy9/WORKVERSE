import { promises as fs } from 'node:fs';
import path from 'node:path';
import {newBusiness,validateBusiness} from './business.mjs';
import { randomUUID } from 'node:crypto';

export const uid = () => randomUUID();
export function initialState({business=false}={}) {
  return { schemaVersion: 1, saveSeq: 0, id: uid(), title: '我的第一个项目', status: 'idle', stage: 'analysis',
    pauseReason: '', revision: 0, segment: 0, replies: 0, nextRole: 'pm', requirements: [], questions: [],
    disputes: [], messages: [], versions: [], drafts: { group: '', pm: '', engineer: '' }, pending: [],
    reviewRevision: -1, pmReady: false, usage: [], step: null, lastFailure: null,...(business?{business:newBusiness(),drafts:{group:'',pm:'',engineer:'',ops:''}}:{}) };
}
export function validateState(s) {
  if (!s || s.schemaVersion !== 1 || !Number.isInteger(s.saveSeq) || !s.id ||
    !['messages','versions','requirements','questions','disputes','pending','usage'].every(k => Array.isArray(s[k])) ||
    !Number.isInteger(s.replies) || s.replies < 0 || s.replies > 12 || !Number.isInteger(s.revision) ||
    !s.drafts || !['group','pm','engineer'].every(k => typeof s.drafts[k] === 'string') ||
    !s.messages.every(m => typeof m.id === 'string' && typeof m.text === 'string') ||
    !s.versions.every((v,i) => v.number === i+1 && typeof v.markdown === 'string')) throw new Error('项目文件格式无效或不兼容');
  if(s.business){validateBusiness(s.business);if(typeof s.drafts.ops!=='string')throw new Error('运营草稿格式无效');}
  return s;
}
export const hasProgress=s=>Boolean(s.business&&(s.business.day>0||Object.values(s.business.team).reduce((a,n)=>a+n,0)>3))||s.messages.some(m=>m.actor==='player')||s.versions.length>0||Object.values(s.drafts).some(Boolean);
const slotId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export const slotSummary=s=>({id:s.id,title:s.title,savedAt:s.savedAt||null,versions:s.versions.length,status:s.exitState?.status||s.status,business:s.business?{cash:s.business.cash,day:s.business.day,finished:s.business.finished}:null});
export class Store {
  constructor(dir, { io = fs } = {}) { this.dir = dir; this.io = io; this.file = path.join(dir,'project.json'); this.queue = Promise.resolve(); this.recovery = null; }
  async readValid(file) { return validateState(JSON.parse(await this.io.readFile(file,'utf8'))); }
  async load() {
    await this.io.mkdir(path.join(this.dir,'backups'),{recursive:true, mode:0o700});
    let s;
    try { s = await this.readValid(this.file); }
    catch (e) {
      if (e.code === 'ENOENT') {
        const entries = await this.io.readdir(path.join(this.dir,'backups'));
        if (!entries.length) return initialState();
      }
      const candidates = (await this.io.readdir(path.join(this.dir,'backups'))).filter(n=>n.endsWith('.json')).sort().reverse();
      for (const name of candidates) {
        try { const backup=await this.readValid(path.join(this.dir,'backups',name));
          this.recovery={name, saveSeq:backup.saveSeq, savedAt:backup.savedAt, state:backup}; break;
        } catch {}
      }
      this.blocked=true;
      return {...initialState(),status:'error',pauseReason:this.recovery?'当前文件损坏：发现可恢复备份，请确认恢复。':'项目文件损坏或不兼容：已保留原件，禁止覆盖。'};
    }
    await this.io.copyFile(this.file,path.join(this.dir,'backups',`startup-${Date.now()}-${uid()}.json`));
    const startups=(await this.io.readdir(path.join(this.dir,'backups'))).filter(n=>n.startsWith('startup-')).sort();
    for (const name of startups.slice(0,-7)) await this.io.unlink(path.join(this.dir,'backups',name));
    if (!['idle','delivered','ended'].includes(s.status)) {
      s.pauseReason=s.step?'上次调用状态未知；继续后将重新执行该步骤，原调用可能已计费。':(s.pauseReason||'已恢复上次进度，点击继续协作。');
      s.status='paused'; s.step=null;
    }
    return s;
  }
  save(state) {
    const snapshot=structuredClone(state);
    const run=async()=>{
      if(this.blocked) throw new Error('请先恢复项目文件，当前原件不会被覆盖');
      snapshot.saveSeq=state.saveSeq+1; snapshot.savedAt=new Date().toISOString(); validateState(snapshot);
      const temp=this.file+'.tmp-'+uid();
      try {
        const handle=await this.io.open(temp,'w',0o600);
        try { await handle.writeFile(JSON.stringify(snapshot,null,2)); await handle.sync(); } finally { await handle.close(); }
        try { await this.readValid(this.file); await this.io.copyFile(this.file,path.join(this.dir,'backups','previous.json')); }
        catch(e) { if(e.code !== 'ENOENT') throw e; }
        await this.io.rename(temp,this.file); state.saveSeq=snapshot.saveSeq; state.savedAt=snapshot.savedAt;
      } catch(e) { await this.io.unlink(temp).catch(()=>{}); throw e; }
    };
    const result=this.queue.then(run); this.queue=result.catch(()=>{}); return result;
  }
  async archive(state){
    if(this.blocked)throw new Error('请先恢复存档');
    if(!hasProgress(state))return;
    if(!slotId(state.id))throw new Error('存档编号无效');
    const dir=path.join(this.dir,'saves');await this.io.mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,state.id+'.json'),temp=file+'.tmp-'+uid();
    try{const h=await this.io.open(temp,'w',0o600);try{await h.writeFile(JSON.stringify(validateState(structuredClone(state)),null,2));await h.sync();}finally{await h.close();}await this.io.rename(temp,file);}catch(e){await this.io.unlink(temp).catch(()=>{});throw e;}
  }
  async readSlot(id){
    if(!slotId(id))throw new Error('存档编号无效');
    const s=await this.readValid(path.join(this.dir,'saves',id+'.json'));
    if(s.id!==id)throw new Error('存档编号不一致');return s;
  }
  async listSlots(current){
    const entries=new Map();let files=[];
    try{files=await this.io.readdir(path.join(this.dir,'saves'));}catch(e){if(e.code!=='ENOENT')throw e;}
    for(const file of files.filter(f=>f.endsWith('.json')&&slotId(f.slice(0,-5)))){
      const id=file.slice(0,-5);try{entries.set(id,slotSummary(await this.readSlot(id)));}catch{entries.set(id,{id,title:'无法读取的存档',invalid:true});}
    }
    if(hasProgress(current))entries.set(current.id,slotSummary(current));
    return [...entries.values()].sort((a,b)=>(b.savedAt||'').localeCompare(a.savedAt||''));
  }
  async recover() {
    if(!this.recovery) throw new Error('没有有效备份可恢复');
    await this.io.copyFile(this.file,path.join(this.dir,`damaged-${Date.now()}.json`)).catch(e=>{if(e.code!=='ENOENT')throw e;});
    const s=structuredClone(this.recovery.state); s.status='paused'; s.step=null; s.pauseReason='已恢复备份，可能缺少最后一次保存后的内容。点击继续。';
    const temp=this.file+'.recover'; await this.io.writeFile(temp,JSON.stringify(s,null,2),{mode:0o600});
    await this.io.rename(temp,this.file); this.blocked=false; this.recovery=null; return s;
  }
}
