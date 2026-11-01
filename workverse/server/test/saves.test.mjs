import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../store.mjs';
import {Coordinator} from '../coordinator.mjs';

async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'workverse-saves-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new Store(dir),s=await store.load(),c=new Coordinator({state:s,store,provider:{configured:async()=>false}});
 s.title='旧项目';s.messages.push({id:'user-1',actor:'player',channel:'group',text:'原始需求'});s.requirements=[{id:'req-1',text:'原需求'}];s.drafts.pm='原私聊草稿';s.versions=[{number:1,revision:1,markdown:'# 原文档',summary:'原摘要'}];await c.persist();return {c,store,dir};
}
test('存档：新游戏保留完整旧进度，两局往返及重启恢复互不混入',async t=>{
 const {c,store,dir}=await fixture(t);const old=structuredClone(c.s);await c.selectSave(null,{newGame:true});const fresh=c.s.id;
 assert.notEqual(fresh,old.id);assert.equal(c.s.messages.length,0);assert.equal(c.s.versions.length,0);assert.equal(c.s.drafts.pm,'');assert.ok(c.s.saveSeq>old.saveSeq);
 c.s.title='新项目';c.s.messages.push({id:'user-2',actor:'player',channel:'group',text:'第二局需求'});c.s.drafts.engineer='新草稿';await c.persist();await c.selectSave(old.id);
 assert.deepEqual(c.s.messages,old.messages);assert.deepEqual(c.s.requirements,old.requirements);assert.deepEqual(c.s.versions,old.versions);assert.equal(c.s.drafts.pm,old.drafts.pm);
 assert.equal((await store.listSlots(c.s)).length,2);await c.selectSave(fresh);assert.equal(c.s.drafts.engineer,'新草稿');assert.equal(c.s.messages.length,1);
 const restarted=await new Store(dir).load();assert.equal(restarted.id,fresh);assert.equal((await new Store(dir).listSlots(restarted)).length,2);
});
test('存档：保存新局失败时不更换当前项目，不覆盖原文件',async t=>{
 const {c,store}=await fixture(t);const oldId=c.s.id,before=await readFile(store.file,'utf8'),save=store.save.bind(store);
 store.save=async()=>{throw new Error('模拟保存失败');};await assert.rejects(c.selectSave(null,{newGame:true}),/保存失败/);
 assert.equal(c.s.id,oldId);assert.equal(await readFile(store.file,'utf8'),before);assert.equal((await store.readSlot(oldId)).drafts.pm,'原私聊草稿');store.save=save;
});
test('存档：损坏存档保留并标记不可读，非法路径拒绝',async t=>{
 const {c,store,dir}=await fixture(t);const id=c.s.id;await c.selectSave(null,{newGame:true});const currentId=c.s.id;
 await writeFile(path.join(dir,'saves',id+'.json'),'broken');const slots=await store.listSlots(c.s);assert.equal(slots.find(s=>s.id===id).invalid,true);
 await assert.rejects(c.selectSave(id));assert.equal(c.s.id,currentId);await assert.rejects(store.readSlot('../../project'),/编号无效/);
});
test('存档：无进度空白局不生成多余存档；不可靠保存禁止切换',async t=>{
 const {c,store}=await fixture(t);await c.selectSave(null,{newGame:true});await c.selectSave(null,{newGame:true});assert.equal((await store.listSlots(c.s)).length,1);
 c.saveError='保存失败';await assert.rejects(c.selectSave(null,{newGame:true}),/可靠保存/);
});
