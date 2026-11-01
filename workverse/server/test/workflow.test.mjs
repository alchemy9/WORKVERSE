import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store,initialState } from '../store.mjs';
import { Coordinator } from '../coordinator.mjs';
import { DeepSeek,CallError } from '../provider.mjs';

export const docText=()=> '# 个人记账产品需求文档\n'+Array.from({length:10},(_,i)=>`\n## ${i+1}. ${['产品概述与目标','用户场景与核心任务','功能范围','用户流程与页面职责','功能详细要求','异常与边界','技术评审建议','验收标准','已确认决定与待确认事项','版本信息与变更摘要'][i]}\n本节依据玩家已确认的个人记账需求：收入与支出必须保存，错误输入明确提示，保存后可以重新读取。验收检查输入和可观察的结果，不声明已实现或部署。\n`).join('');
export function smartReply({messages}) {
  const x=JSON.parse(messages[1].content),pending=x.messages.filter(m=>x.pendingMessageIds.includes(m.id));
  const data={message:x.stage==='generating'?'已整合当前需求并完成文档，覆盖功能、异常和验收。':x.stage==='review'?'技术评审：明确本地保存、输入边界与失败恢复，可按当前范围实施。':'已理解本次需求并整理范围，准备与同事确认边界。',processedMessageIds:pending.map(m=>m.id),updates:pending.map(m=>({sourceId:m.id,quote:m.text,text:m.text,kind:'request'})),questions:[],reviewPassed:x.stage==='review',ready:x.stage==='discussion',resolvedQuestionIds:[]};
  if(x.stage==='generating')data.document={revision:x.revision,markdown:docText(),summary:'覆盖当前需求，完善异常与验收标准',coveredRequirementIds:x.requirements.map(r=>r.id)};
  return {data,raw:JSON.stringify(data),usage:{prompt_tokens:30,completion_tokens:40}};
}
const until=(c,predicate,timeout=5000)=>new Promise((resolve,reject)=>{
  if(predicate())return resolve();
  const done=()=>{if(predicate()){clearTimeout(timer);c.off('change',done);resolve();}};
  const timer=setTimeout(()=>{c.off('change',done);reject(new Error('状态未达到预期：'+JSON.stringify({status:c.s.status,reason:c.s.pauseReason,count:c.s.replies})));},timeout);c.on('change',done);
});
async function fixture(t,complete=smartReply){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workverse-test-')),store=new Store(dir);const state=await store.load();
  const provider={configured:async()=>true,complete};const c=new Coordinator({state,store,provider,retryDelays:[0,0]});c.online=true;
  t.after(async()=>{c.online=false;c.invalidate();await c.queue;await fs.rm(dir,{recursive:true,force:true});});return {dir,store,c,provider};
}

test('A01 A03-A05 A25: 双角色交付与修订、版本历史持久化',async t=>{
  const {c,store}=await fixture(t);await c.send('group','做一个个人记账产品','first');await until(c,()=>c.s.status==='delivered');
  assert.equal(c.s.versions.length,1);assert.equal(c.s.versions[0].number,1);assert.ok(c.s.messages.some(m=>m.actor==='pm'));assert.ok(c.s.messages.some(m=>m.actor==='engineer'));
  const first=c.s.versions[0].markdown;await c.send('pm','增加每月预算提醒','second');await until(c,()=>c.s.versions.length===2);
  assert.equal(c.s.versions[0].markdown,first);assert.ok(c.s.versions[1].revision>c.s.versions[0].revision);
  const disk=await store.readValid(store.file);assert.equal(disk.versions.length,2);assert.ok(disk.messages.some(m=>m.clientId==='second'));
});
test('A02: 关键问题等待玩家，无关输入不得自动发布',async t=>{
  const {c}=await fixture(t,args=>{const out=smartReply(args),x=JSON.parse(args.messages[1].content);if(x.pendingMessageIds.length)out.data.questions=[{id:'platform',text:'第一版使用什么平台？',options:['网页','手机']}];return out;});
  await c.send('group','做一个工具','ask');await until(c,()=>c.s.status==='waiting');assert.equal(c.s.versions.length,0);
  await c.resume();assert.equal(c.s.status,'waiting');assert.equal(c.s.versions.length,0);
});
test('A07 A08 A33: 私聊关键需求有来源同步，普通私聊不泄露给另一角色',async t=>{
  const {c}=await fixture(t);c.s.messages.push({id:'private-note',seq:1,actor:'player',channel:'engineer',text:'只解释程序员的工作习惯',at:new Date().toISOString()});
  const pm=JSON.stringify(c.context('pm','discussion'));assert.equal(pm.includes('只解释程序员的工作习惯'),false);
  await c.send('engineer','第一版取消云同步','private-change');await until(c,()=>c.s.status==='delivered');
  const sync=c.s.messages.find(m=>m.sourceId&&m.channel==='group');assert.equal(sync.sourceChannel,'engineer');assert.ok(c.s.messages.some(m=>m.id===sync.sourceId&&m.actor==='player'));
});
test('A10 A11: 插话使迟到结果过时，不得交付旧文档',async t=>{
  let release,started;const began=new Promise(resolve=>{started=resolve;});let call=0;const {c}=await fixture(t,async args=>{call++;if(call===1)return new Promise(resolve=>{release=()=>resolve(smartReply(args));started();});return smartReply(args);});
  await c.send('group','做一个记账产品','old');await began;
  await c.send('group','改为只做个人使用的网页产品','new');release();await until(c,()=>c.s.status==='delivered');
  assert.equal(c.s.versions.length,1);assert.ok(c.s.requirements.some(r=>r.text.includes('只做个人使用')));assert.equal(c.s.versions[0].revision,c.s.revision);
  assert.ok(c.s.messages.some(m=>m.obsolete));
});
test('A09: 分歧三轮后交给产品经理收敛，不自动要求玩家决定',async t=>{
  const {c}=await fixture(t);c.s.requirements=[{id:'r',text:'个人使用'}];c.s.revision=1;c.s.reviewRevision=1;
  c.s.disputes=[{id:'storage',text:'同步方式',options:['本地','云端'],round:0,participants:[],agreements:[],resolved:false}];
  for(let round=0;round<3;round++)for(const role of ['pm','engineer']){
    c.applyResult({role,stage:'discussion',revision:1,messages:[{}, {content:'{}'}]},{data:{message:'基于数据成本与用户场景比较方案',disputeResponses:['storage']}});
  }
  assert.equal(c.s.disputes[0].round,3);assert.equal(c.s.status,'discussion');assert.equal(c.s.nextRole,'pm');assert.equal(c.s.questions.length,0);
  c.applyResult({role:'pm',stage:'discussion',revision:1,messages:[{}, {content:'{}'}]},{data:{message:'先本地保存，后续按需同步，以最小范围验证需求。',settleDisputes:[{id:'storage',decision:'首版先本地保存',rationale:'满足个人使用且降低首版复杂度'}]}});assert.equal(c.s.disputes[0].resolved,true);
});
test('A16 A17 A30 A31: 十二条上限与暂停恢复计数、文档计入',async t=>{
  const {c}=await fixture(t,()=>({data:{message:'继续核对范围与异常流程',ready:false},raw:'work'}));
  c.s.requirements=[{id:'r',text:'记账'}];c.s.revision=1;c.s.reviewRevision=1;c.s.status='discussion';c.s.stage='discussion';c.s.replies=11;c.kick();
  await until(c,()=>c.s.status==='paused');assert.equal(c.s.replies,12);assert.equal(c.s.versions.length,0);
  c.online=false;await c.pause();assert.equal(c.s.replies,12);
  c.online=true;await c.resume();await until(c,()=>c.s.replies===12&&c.s.status==='paused');assert.equal(c.s.segment,1);
});
test('A16 A32: 暂停时保存输入与草稿但不调用模型，消息重试去重',async t=>{
  let calls=0;const {c,store}=await fixture(t,args=>{calls++;return smartReply(args);});await c.pause();
  await c.draft('engineer','私聊草稿');await c.send('pm','先保存需求','same-id');await c.send('pm','先保存需求','same-id');
  assert.equal(calls,0);assert.equal(c.s.messages.filter(m=>m.clientId==='same-id').length,1);assert.equal(c.s.status,'paused');
  const disk=await store.readValid(store.file);assert.equal(disk.drafts.engineer,'私聊草稿');
});
test('A20: 临时故障仅额外重试两次，失败后暂停',async t=>{
  let attempts=0;const {c}=await fixture(t,()=>{attempts++;throw new CallError('服务暂时繁忙',{retryable:true});});
  await c.send('group','生成需求','retry');await until(c,()=>c.s.status==='error');assert.equal(attempts,3);assert.equal(c.s.replies,0);assert.equal(c.s.versions.length,0);
});
test('A08 A22: 伪造玩家决定与无效文档不得改变需求或交付',async t=>{
  const {c}=await fixture(t);c.s.requirements=[{id:'r',text:'不要登录'}];c.s.revision=1;
  assert.throws(()=>c.applyResult({role:'pm',stage:'analysis',messages:[{}, {content:'{}'}]}, {data:{message:'我决定增加登录',updates:[{sourceId:'fake',quote:'批准',text:'增加登录',kind:'decision'}]}}),/玩家来源/);
  assert.equal(c.s.requirements.length,1);assert.equal(c.s.versions.length,0);
});
test('A18 A23 A35: 重启保留计数，损坏项目不覆盖，备份须确认恢复',async t=>{
  const {c,store,dir}=await fixture(t);c.s.status='discussion';c.s.replies=7;await c.persist();await c.persist();
  const reloaded=new Store(dir);const s=await reloaded.load();assert.equal(s.status,'paused');assert.equal(s.replies,7);
  await fs.writeFile(store.file,'broken');const broken=new Store(dir);const blocked=await broken.load();assert.equal(broken.blocked,true);assert.ok(broken.recovery);assert.equal(blocked.status,'error');
  await assert.rejects(broken.save(initialState()));assert.equal(await fs.readFile(store.file,'utf8'),'broken');
  const restored=await broken.recover();assert.equal(restored.replies,7);assert.ok((await fs.readdir(dir)).some(n=>n.startsWith('damaged-')));
});
test('A23: 保存失败不破坏原件、不显示交付成功',async t=>{
  const {c,store}=await fixture(t);await c.persist();const original=await fs.readFile(store.file,'utf8');
  store.io=new Proxy(fs,{get(target,key){return key==='rename'?async()=>{throw new Error('模拟磁盘写入失败');}:target[key];}});
  await assert.rejects(c.persist());assert.equal(c.s.status,'error');assert.ok(c.saveError);assert.equal(await fs.readFile(store.file,'utf8'),original);
});
test('A21 A22 A37: 请求模式、token上限、错误分类和超时',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workverse-provider-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const keyFile=path.join(dir,'config.env');await fs.writeFile(keyFile,'DEEPSEEK_API_KEY=test-only-not-real');
  let captured;const provider=new DeepSeek({keyFile,fetchImpl:async(url,options)=>{captured=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'{"message":"工作回复"}'},finish_reason:'stop'}]}),{status:200});}});
  await provider.complete({messages:[],generating:true,signal:new AbortController().signal});assert.equal(captured.max_tokens,8192);assert.equal(captured.thinking.type,'disabled');assert.equal(captured.response_format.type,'json_object');assert.equal(captured.stream,false);
  for(const status of [400,401,402,422,429,500,503]){
    provider.fetch=async()=>new Response('untrusted error includes sensitive data',{status});
    await assert.rejects(provider.complete({messages:[],signal:new AbortController().signal}),e=>e.retryable===[429,500,503].includes(status)&&!e.message.includes('sensitive'));
  }
  provider.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:''}}]}));await assert.rejects(provider.complete({messages:[],signal:new AbortController().signal}),e=>e.retryable);
  provider.fetch=async()=>{const e=new Error('timeout');e.name='TimeoutError';throw e;};await assert.rejects(provider.complete({messages:[],signal:new AbortController().signal}),e=>e.message.includes('120 秒'));
  await assert.rejects(provider.complete({messages:[{role:'user',content:'x'.repeat(1048576)}],signal:new AbortController().signal}),/1 MiB/);
});

test('A05 A11: 明确替换需求保留历史，旧范围不再进入当前模型上下文',async t=>{
  const {c}=await fixture(t);c.s.requirements=[{id:'old',text:'加入云同步'}];
  c.s.messages=[{id:'input',seq:1,actor:'player',channel:'pm',text:'取消云同步',at:new Date().toISOString()}];c.s.pending=['input'];
  c.applyResult({role:'pm',stage:'analysis',messages:[{}, {content:'input'}]}, {data:{message:'已取消云同步，并将要求同步给团队',processedMessageIds:['input'],updates:[{sourceId:'input',quote:'取消云同步',text:'第一版不做云同步',kind:'decision',supersedes:['old']}]}});
  assert.ok(c.s.requirements.find(r=>r.id==='old').supersededBy);assert.equal(c.s.reviewRevision,-1);
  const context=JSON.parse(c.context('engineer','review')[1].content);assert.equal(context.requirements.length,1);assert.equal(context.requirements[0].text,'第一版不做云同步');assert.ok(c.s.messages.some(m=>m.sourceId==='input'&&m.channel==='group'));
});
test('A04 A23: 文档保存失败不能出现在正式版本中，重试保存后才发布',async t=>{
  const {c,store}=await fixture(t);await c.persist();
  c.s.versions.push({number:1,revision:1,markdown:docText(),summary:'文档',at:new Date().toISOString()});c.s.status='delivered';
  const realIO=store.io;store.io=new Proxy(fs,{get(target,key){return key==='rename'?async()=>{throw new Error('模拟保存失败');}:target[key];}});
  await assert.rejects(c.persist());assert.equal(c.view().versions.length,0);assert.equal(c.view().status,'error');
  store.io=realIO;await c.persist();assert.equal(c.view().versions.length,1);assert.equal(c.s.status,'delivered');
});

test('A18 A30: 已交付后关闭再修改应开启新段，但保持暂停到手动继续',async t=>{
  const {c}=await fixture(t);await c.send('group','个人记账','v1');await until(c,()=>c.s.status==='delivered');assert.equal(c.s.replies,4);
  await c.pause('页面关闭');await c.send('engineer','增加预算提醒','v2');assert.equal(c.s.status,'paused');assert.equal(c.s.replies,0);
  await c.resume();await until(c,()=>c.s.versions.length===2);assert.equal(c.s.replies,5);
});

test('A16: 没有待办的暂停项目继续后回到待命，不凭空调用模型',async t=>{
  let calls=0;const {c}=await fixture(t,args=>{calls++;return smartReply(args);});await c.pause();await c.resume();assert.equal(c.s.status,'idle');assert.equal(calls,0);
});

test('A10 A20: 重复提交已收到的消息不得取消正在执行的工作',async t=>{
  let release,started,calls=0;const began=new Promise(r=>started=r);
  const {c}=await fixture(t,args=>{calls++;if(calls===1)return new Promise(resolve=>{release=()=>resolve(smartReply(args));started();});return smartReply(args);});
  await c.send('group','个人记账','deduplicate');await began;const epoch=c.epoch;
  await c.send('group','个人记账','deduplicate');assert.equal(c.epoch,epoch);release();await until(c,()=>c.s.status==='delivered');assert.equal(calls,4);assert.equal(c.s.messages.filter(m=>m.clientId==='deduplicate').length,1);
});
