import test from 'node:test';
import assert from 'node:assert/strict';
import {Coordinator} from '../coordinator.mjs';
import {initialState} from '../store.mjs';
import {acceptsSnapshot,visibleMessages,numberedAnswer} from '../../client/conversation.js';

const markdown=Array.from({length:10},(_,i)=>`## ${i+1}. 需求与验收\n本节覆盖已确定的产品需求、操作流程与异常情况，验收应观察明确的操作结果，避免数据丢失。`).join('\n');
function fixture(){
  const state={...initialState(),status:'generating',stage:'generating',revision:2,reviewRevision:2,pmReady:true,requirements:[{id:'r1',text:'网页记账'},{id:'r2',text:'预算提醒'}]};
  const c=new Coordinator({state,store:{save:async()=>{}},provider:{configured:async()=>true}});c.online=true;return c;
}
const task=c=>({role:'pm',stage:c.s.status,revision:c.s.revision,messages:c.context('pm',c.s.status)});
const output=ids=>({data:{message:'整理完成，请检查需求覆盖与验收。',document:{revision:2,markdown,summary:'本轮更新',coveredRequirementIds:ids}}});

test('UX-003: 跨题累积、依题序编号、同题更新且保留手写补充',()=>{
  const q=[{id:'a',text:'类型'},{id:'b',text:'角色'}];
  let draft=numberedAnswer(q,'b','NPC','另外：中文界面');draft=numberedAnswer(q,'a','冒险',draft);
  assert.equal(draft,'另外：中文界面\n1. 类型：冒险\n2. 角色：NPC');
  draft=numberedAnswer(q,'a','叙事',draft);assert.equal(draft,'另外：中文界面\n1. 类型：叙事\n2. 角色：NPC');
});
test('UX-005: 旧HTTP响应不能覆盖更新的实时状态，角色会话可见其工作',()=>{
  assert.equal(acceptsSnapshot({saveSeq:9},{saveSeq:8}),false);assert.equal(acceptsSnapshot({saveSeq:9},{saveSeq:9}),true);
  const s={messages:[{id:'1',actor:'pm',channel:'agents'},{id:'2',actor:'engineer',channel:'agents'},{id:'3',actor:'player',channel:'engineer'},{id:'4',actor:'pm',channel:'pm'}]};
  assert.deepEqual(visibleMessages(s,'pm').map(m=>m.id),['1','4']);assert.equal(visibleMessages(s,'all').length,4);
});
test('UX-004: 答案保存成功记录已提交问题，关键问题仍由AI确认解决',async()=>{
  const c=fixture();c.online=false;c.s.status='paused';c.s.questions=[{id:'q',text:'方向',resolved:false}];
  await c.send('group','1. 方向：记账','answer',['q']);assert.ok(c.s.questions[0].submittedBy);assert.equal(c.s.questions[0].resolved,false);assert.equal(c.s.status,'paused');
});
test('FLOW-001: AI决定有独立来源，不能替换玩家要求，用户可纠正AI决定',()=>{
  const c=fixture();c.s.status='analysis';c.s.requirements=[{id:'user',text:'中文界面',kind:'request'}];
  const data={message:'按最小网页产品确定首版范围。',aiDecisions:[{text:'默认网页端单用户',rationale:'以最小范围观察协作流程'}]};
  c.applyResult(task(c),{data});const ai=c.s.requirements.find(r=>r.kind==='ai-decision');assert.ok(ai);assert.equal(ai.decidedBy,'pm');assert.equal(ai.sourceId,undefined);assert.ok(c.s.messages.some(m=>m.decision&&m.actor==='pm'));
  assert.throws(()=>c.applyResult(task(c),{data:{message:'更改要求',aiDecisions:[{text:'英文界面',rationale:'默认值',supersedes:['user']}]}}),/玩家要求/);
  c.s.messages.push({id:'new',actor:'player',channel:'group',text:'改为手机端'});c.s.pending=['new'];
  c.applyResult(task(c),{data:{message:'按玩家意见修改',processedMessageIds:['new'],updates:[{sourceId:'new',quote:'改为手机端',text:'手机端',kind:'decision',supersedes:[ai.id]}]}});assert.ok(ai.supersededBy);
});
test('FLOW-002: 程序员评审后须由产品经理回应再交付',()=>{
  const c=fixture();c.s.status='review';c.s.reviewRevision=-1;c.s.pmReady=true;
  c.applyResult({...task(c),role:'engineer'},{data:{message:'建议限制预算分类数量以缩小首版范围。',reviewPassed:true}});
  assert.equal(c.s.status,'discussion');assert.equal(c.s.nextRole,'pm');assert.equal(c.s.pmReady,false);assert.equal(c.s.versions.length,0);
});
test('BUG-001: 缺失项传回修订上下文并留存失败原文，修正后交付',async()=>{
  const c=fixture();let calls=0,repair;
  c.provider.complete=async({messages})=>{calls++;if(calls===2)repair=JSON.parse(messages[1].content).repair;return output(calls===1?['r1']:['r1','r2']);};
  await c.run();assert.equal(calls,2);assert.equal(c.s.status,'delivered');assert.deepEqual(repair.missingRequirements,[{id:'r2',text:'预算提醒'}]);assert.ok(repair.previousDocument.markdown);assert.deepEqual(c.s.validationFailures[0].data.document.coveredRequirementIds,['r1']);assert.equal(c.view().validationFailures,undefined);
});
test('BUG-001: 同类内容错误三次后暂停，继续可明确重开修订',async()=>{
  const c=fixture();let calls=0;c.provider.complete=async()=>{calls++;return output(['r1']);};
  await c.run();assert.equal(calls,3);assert.equal(c.s.status,'paused');assert.equal(c.s.validationFailure.count,3);assert.equal(c.s.versions.length,0);
  c.provider.complete=async()=>output(['r1','r2']);await c.resume();
  // resume launches run asynchronously; wait on observable state rather than a delay.
  if(c.s.status!=='delivered')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('resume timeout')),1000);c.on('change',()=>{if(c.s.status==='delivered'){clearTimeout(timer);resolve();}});});
  assert.equal(c.s.versions.length,1);
});
test('BUG-001: 编号周围空白不导致误退回，但真实缺项不可自动补全',()=>{
  const c=fixture();c.applyResult(task(c),output([' r1 ','r2']));assert.equal(c.s.versions.length,1);
  const bad=fixture();assert.throws(()=>bad.applyResult(task(bad),output(['r1'])),/覆盖清单不完整/);assert.equal(bad.s.versions.length,0);
});

 test('FLOW-002: 程序员未通过评审也先交给产品经理回应，避免连续自说自话',()=>{
  const c=fixture();c.s.status='review';c.s.nextRole='engineer';c.s.reviewRevision=-1;
  c.applyResult({...task(c),role:'engineer'},{data:{message:'建议减少NPC数量，请产品经理确认取舍。',reviewPassed:false}});
  assert.equal(c.s.status,'discussion');assert.equal(c.s.nextRole,'pm');assert.equal(c.s.reviewRevision,-1);
 });
test('BUG-001: 交付阶段只有口头承诺不能视为完成一步有效交付',()=>{
  const c=fixture();assert.throws(()=>c.applyResult(task(c),{data:{message:'下一步将生成文档',ready:true}}),/完整文档/);assert.equal(c.s.versions.length,0);
});

test('BUG-001: 修订号错误明确反馈期望值，不能误报正文结构问题',()=>{
 const c=fixture(),out=output(['r1','r2']);out.data.document.revision=3;
 assert.throws(()=>c.applyResult(task(c),out),e=>e.code==='document-revision'&&e.details.expectedRevision===2);
});
