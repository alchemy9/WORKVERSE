import test from 'node:test';
import assert from 'node:assert/strict';
import {Coordinator} from '../coordinator.mjs';
import {initialState} from '../store.mjs';
import {newBusiness,launchPreparation,readPlan,advanceBusiness,finish,validateBusiness,payroll} from '../business.mjs';
import {newCeo,runCeo,estimateDaily,chooseProject} from '../ceo.mjs';

test('CEO：可自主立项，准确标注AI来源；关闭不创建重复项目',async()=>{
 const s=initialState({business:true}),c=new Coordinator({state:s,store:{save:async()=>{}},provider:{configured:async()=>true}});c.online=false;
 await c.setCeo(true);assert.equal(s.business.started,true);assert.equal(s.requirements.length,1);assert.equal(s.requirements[0].decidedBy,'ceo');assert.equal(s.pending.length,0);assert.equal(s.messages.some(m=>m.actor==='player'),false);assert.ok(s.messages.some(m=>m.ceo));
 await c.setCeo(false);await c.setCeo(true);assert.equal(s.requirements.length,1);assert.equal(chooseProject(s.id),chooseProject(s.id));
});
test('CEO：未配置密钥或有草稿时不擅自启动；用户暂停状态保留',async()=>{
 const s=initialState({business:true}),provider={configured:async()=>false},c=new Coordinator({state:s,store:{save:async()=>{}},provider});
 await assert.rejects(c.setCeo(true),/密钥/);assert.equal(s.business.started,false);provider.configured=async()=>true;s.drafts.group='玩家草稿';await assert.rejects(c.setCeo(true),/草稿/);s.drafts.group='';s.status='paused';await c.setCeo(true);assert.equal(s.status,'paused');
});
const fixture=()=>{const b=newBusiness();b.started=true;b.ceo=newCeo();b.ceo.enabled=true;launchPreparation(b,readPlan({price:49,marketing:300,focus:'quality'}),Array.from({length:10},()=>({text:'需求'})),[]);return b;};
test('CEO：招聘与升级实际扣款，决策有间隔，关闭后不自动消费',()=>{
 const b=fixture(),start=b.cash;assert.match(runCeo(b),/程序员/);assert.equal(b.team.engineer,2);assert.equal(b.cash,start-3000);assert.equal(runCeo(b),null);b.ceo.enabled=false;b.day+=3;assert.equal(runCeo(b),null);assert.equal(b.cash,start-3000);validateBusiness(b);
});
test('CEO：自动调价推广依据同一销售规则，质量研究和设备有成本上限',()=>{
 const b=fixture();b.phase='market';const old=estimateDaily(b,b.plan.price,b.plan.marketing);assert.ok(runCeo(b));assert.ok(estimateDaily(b,b.plan.price,b.plan.marketing)>=old);assert.ok(b.plan.marketing<=1000);
 b.day+=2;assert.ok(runCeo(b));assert.equal(b.officeLevel,1);b.day+=2;runCeo(b);assert.equal(b.officeLevel,2);b.day+=2;runCeo(b);assert.equal(b.ceo.research.length,1);validateBusiness(b);
 const predicted=estimateDaily(b,b.plan.price,b.plan.marketing),cash=b.cash;advanceBusiness(b);assert.equal(b.cash-cash,predicted);
});
test('CEO：贷款有次数上限与每日利息，借款不记为收入或利润',()=>{
 const b=fixture();b.cash=1000;b.costs.wages=99000;
 assert.match(runCeo(b),/贷款/);assert.equal(b.cash,6000);assert.equal(b.revenue,0);assert.equal(b.debt,5000);advanceBusiness(b);assert.equal(b.costs.interest,50);finish(b,'检查复盘');assert.equal(b.report.profit,b.revenue-Object.values(b.costs).reduce((a,n)=>a+n,0));validateBusiness(b);
 const capped=fixture();capped.cash=100;capped.costs.wages=114900;capped.ceo.loans=3;capped.debt=15000;capped.financing=15000;assert.equal(runCeo(capped),null);assert.equal(capped.ceo.loans,3);validateBusiness(capped);
});
test('CEO：资金安全垫不足时不招聘、不升级；经营结束不再动作',()=>{
 const b=fixture();b.cash=payroll(b)*7;b.costs.wages=b.initial-b.cash;const cash=b.cash;assert.equal(runCeo(b),null);assert.equal(b.cash,cash);finish(b,'结束');assert.equal(runCeo(b),null);
});
