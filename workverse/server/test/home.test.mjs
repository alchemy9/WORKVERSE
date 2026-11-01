import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import WebSocket from 'ws';
import {Coordinator} from '../coordinator.mjs';
import {Store,initialState} from '../store.mjs';
import {createApp} from '../index.mjs';

test('首页：仅查看不调用AI，禁止首页发需求；进入退出保留草稿、消息、版本',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'workverse-home-'));let calls=0;
 const app=await createApp({port:0,dataDir:dir,provider:{configured:async()=>true,complete:async()=>{calls++;throw new Error('不应调用');}}});
 const boot=await(await fetch(app.origin+'/api/bootstrap')).json();const ws=new WebSocket(app.origin.replace('http','ws')+'/live?screen=home&session='+boot.session,{origin:app.origin});
 t.after(async()=>{ws.terminate();await app.close();await rm(dir,{recursive:true,force:true});});
 const [raw]=await once(ws,'message'),hello=JSON.parse(raw.toString());assert.equal(hello.screen,'home');assert.equal(app.c.online,false);
 const post=(action,body={})=>fetch(app.origin+'/api/'+action,{method:'POST',headers:{origin:app.origin,'content-type':'application/json','x-workverse-session':boot.session,'x-workverse-token':hello.token},body:JSON.stringify(body)});
 assert.equal((await post('message',{channel:'group',text:'不应发送'})).status,409);assert.equal(calls,0);
 assert.equal((await post('enter')).status,200);assert.equal(app.c.online,true);
 const response=await post('exit',{drafts:{pm:'尚未提交的私聊',group:'需求草稿'}});assert.equal(response.status,200);assert.equal((await response.json()).screen,'home');assert.equal(app.c.online,false);
 const disk=JSON.parse(await readFile(path.join(dir,'project.json'),'utf8'));assert.equal(disk.drafts.pm,'尚未提交的私聊');assert.equal(disk.exitState.status,'idle');
 assert.equal((await post('enter')).status,200);assert.equal(app.c.s.status,'idle');assert.equal(app.c.s.drafts.group,'需求草稿');assert.equal(calls,0);
});

test('退出：保存失败不得报告成功；保留原存档与输入，重试可保存',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'workverse-exit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new Store(dir),s=await store.load(),c=new Coordinator({state:s,store,provider:{configured:async()=>true}});c.online=true;await c.persist();
 const before=await readFile(store.file,'utf8'),save=store.save.bind(store);store.save=async()=>{throw new Error('磁盘写入失败');};
 await assert.rejects(c.exit({group:'需要保留的输入'}),/磁盘/);assert.equal(c.s.drafts.group,'需要保留的输入');assert.equal(c.online,false);assert.equal(await readFile(store.file,'utf8'),before);
 store.save=save;await c.exit({group:'需要保留的输入'});assert.equal(c.saveError,'');assert.equal((await store.readValid(store.file)).drafts.group,'需要保留的输入');
});

test('继续：只恢复因退出暂停的任务，保留主动暂停与已交付状态',async()=>{
 for(const status of ['analysis','paused','delivered']){
  const s={...initialState(),status,stage:'analysis',pauseReason:status==='paused'?'已手动暂停':''};
  const c=new Coordinator({state:s,store:{save:async()=>{}},provider:{configured:async()=>true}});let resumed=0;c.resume=async()=>{resumed++;};
  await c.exit({engineer:'草稿'});assert.equal(c.online,false);c.online=true;await c.enter();
  assert.equal(resumed,status==='analysis'?1:0);if(status!=='analysis')assert.equal(c.s.status,status);
 }
});

test('退出：作废未完成AI请求，迟到结果不能交付；重启仍保留恢复标记',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'workverse-exit-active-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new Store(dir),s=await store.load();s.status='analysis';s.stage='analysis';s.pending=['input'];s.messages=[{id:'input',actor:'player',channel:'group',text:'需求'}];
 let release,began;const start=new Promise(r=>began=r);
 const c=new Coordinator({state:s,store,provider:{complete:()=>new Promise(r=>{release=r;began();}),configured:async()=>true}});c.online=true;
 const work=c.run();await start;await c.exit({group:'未发出的新需求'});release({data:{message:'迟到回复'},raw:'迟到回复'});await work;
 assert.equal(c.s.versions.length,0);assert.equal(c.s.pending.length,1);assert.equal(c.s.status,'paused');
 const restored=await new Store(dir).load();assert.equal(restored.exitState.autoResume,true);assert.equal(restored.drafts.group,'未发出的新需求');
});
