import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {newBusiness,hire,readPlan,launchPreparation,advanceBusiness,planningDay,validateBusiness} from '../business.mjs';
import {Store,initialState,validateState} from '../store.mjs';
import {Coordinator} from '../coordinator.mjs';

const doc=Array.from({length:10},(_,i)=>`## ${i+1} 产品与验收\n面向个人用户提供收入支出记录、月度统计、金额校验，异常保留输入，保存后可重新读取。`).join('\n');
export function businessReply({messages}){
 const x=JSON.parse(messages[1].content),pending=x.messages.filter(m=>x.pendingMessageIds.includes(m.id));
 const data={message:x.role==='ops'?'先按99元定价和每日500元推广，以最小团队验证市场。':x.role==='engineer'?'建议先覆盖核心记录和异常恢复，控制开发范围。':'采纳范围建议，先完成最小需求与验收。',processedMessageIds:pending.map(m=>m.id),updates:pending.map(m=>({sourceId:m.id,quote:m.text,text:m.text,kind:'request'})),reviewPassed:x.stage==='review',ready:x.stage==='discussion'};
 if(x.stage==='generating')data.document={revision:x.revision,markdown:doc,summary:'首版',coveredRequirementIds:x.requirements.map(r=>r.id)};
 if(x.stage==='launch-plan')data.businessPlan={price:99,marketing:500,focus:'quality',hires:{pm:0,engineer:0,ops:0}};
 return {data,raw:JSON.stringify(data)};
}
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'workverse-business-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new Store(dir);await store.load();const state=initialState({business:true});await store.save(state);const c=new Coordinator({state,store,provider:{configured:async()=>true,complete:async args=>businessReply(args)}});c.online=true;return {c,store};}
const until=(c,p)=>p()?Promise.resolve():new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('未达到经营状态')),2000);c.on('change',()=>{if(p()){clearTimeout(timer);resolve();}});});

test('经营完整闭环：三角色协作→文档→运营方案→开发测试销售→30天复盘，账实一致',async t=>{
 const {c,store}=await fixture(t);await c.send('group','个人记账网页','business-first');await until(c,()=>c.s.status==='building');assert.equal(c.s.business.day,5);assert.ok(c.s.messages.some(m=>m.actor==='ops'));assert.equal(c.s.versions.length,1);
 while(!c.s.business.finished)await c.advanceDay();const b=c.s.business;assert.equal(b.day,30);assert.equal(c.s.status,'ended');assert.ok(b.revenue>0);assert.ok(b.users>0);assert.equal(b.cash,b.initial+b.revenue-Object.values(b.costs).reduce((a,n)=>a+n,0));
 assert.ok(c.s.messages.some(m=>m.simulation&&m.workRole==='ops'&&m.channel==='group'));assert.equal(b.report.profit,b.cash-100000);const cash=b.cash;await c.advanceDay();assert.equal(b.cash,cash);validateBusiness(b);await c.pause('断线');assert.equal(c.s.status,'ended');assert.equal((await store.readValid(store.file)).business.cash,cash);
 for(const row of b.ledger.filter(r=>r.kind==='sales'))assert.equal(row.amount,row.buyers*row.price);
});
test('经营：暂停、首页不结算；退出恢复与读档保留日数，不能重复发收入',async t=>{
 const {c,store}=await fixture(t);await c.send('group','最小产品','pause-first');await until(c,()=>c.s.status==='building');await c.advanceDay();const day=c.s.business.day;
 await c.pause();await c.advanceDay();assert.equal(c.s.business.day,day);await c.exit({group:'草稿'});await c.advanceDay();assert.equal(c.s.business.day,day);c.online=true;await c.enter();assert.equal(c.s.status,'paused');await c.resume();assert.equal(c.s.status,'building');await c.advanceDay();assert.equal(c.s.business.day,day+1);
 const loaded=await store.load();assert.equal(loaded.business.day,day+1);assert.equal(loaded.status,'paused');validateState(loaded);
});
test('经营：招聘限制、工资、产能及现金约束生效',()=>{
 const a=newBusiness(),b=newBusiness();a.started=b.started=true;hire(b,'engineer');assert.equal(b.cash,97000);const plan=readPlan({price:99,marketing:500,focus:'quality'});launchPreparation(a,plan,[],[]);launchPreparation(b,plan,[],[]);advanceBusiness(a);advanceBusiness(b);assert.ok(b.work>a.work);assert.equal(b.costs.wages-a.costs.wages,450);hire(b,'engineer');assert.throws(()=>hire(b,'engineer'),/最多/);
 const poor=newBusiness();poor.cash=2000;poor.costs.wages=98000;assert.throws(()=>hire(poor,'ops'),/资金不足/);assert.equal(poor.team.ops,1);
});
test('经营：资金耗尽停止、收益可复现，非法运营参数及坏账拒绝',()=>{
 const a=newBusiness();a.started=true;a.cash=100;a.costs.wages=99900;launchPreparation(a,readPlan({price:99,marketing:500,focus:'quality'}),[],[]);advanceBusiness(a);assert.equal(a.finished,true);assert.equal(a.report.reason,'资金耗尽');const day=a.day;advanceBusiness(a);assert.equal(a.day,day);
 const play=()=>{const b=newBusiness();b.started=true;launchPreparation(b,readPlan({price:99,marketing:500,focus:'growth'}),[],[]);while(!b.finished)advanceBusiness(b);return b;};assert.deepEqual(play(),play());assert.throws(()=>readPlan({price:9999,marketing:-1,focus:'hype'}));const bad=newBusiness();bad.cash++;assert.throws(()=>validateBusiness(bad),/余额/);
});
test('经营：保存失败隐藏未落盘的收入，重试后显示正确账本',async t=>{
 const {c,store}=await fixture(t);await c.send('group','项目','save-first');await until(c,()=>c.s.status==='building');const committedDay=c.s.business.day,save=store.save.bind(store);store.save=async()=>{throw new Error('模拟磁盘故障');};await assert.rejects(c.advanceDay());assert.equal(c.view().business.day,committedDay);assert.equal(c.s.status,'error');store.save=save;await c.exclusive(()=>c.persist());assert.equal(c.view().business.day,committedDay+1);validateBusiness(c.s.business);
});
test('经营：新游戏有资金与运营，旧存档保持兼容',()=>{assert.equal(initialState().business,undefined);const s=initialState({business:true});assert.equal(s.business.cash,100000);assert.equal(s.drafts.ops,'');validateState(s);});
