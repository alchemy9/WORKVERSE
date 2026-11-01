export const JOBS={pm:{name:'产品经理',wage:350},engineer:{name:'程序员',wage:450},ops:{name:'运营',wage:300}};
export const BUSINESS_STAGES=new Set(['building','testing','market']);
export function newBusiness(){return {schema:1,initial:100000,cash:100000,day:0,limit:30,phase:'planning',started:false,finished:false,team:{pm:1,engineer:1,ops:1},plan:null,work:0,totalWork:0,testDays:0,quality:0,fit:0,users:0,revenue:0,costs:{wages:0,hosting:0,marketing:0,hiring:0},ledger:[],decisions:[],report:null};}
export const payroll=b=>Object.entries(b.team).reduce((n,[job,count])=>n+JOBS[job].wage*count,0);
export function validateBusiness(b){
 if(!b||b.schema!==1||!Number.isInteger(b.cash)||!Number.isInteger(b.day)||b.day<0||b.day>30||b.limit!==30||b.initial!==100000||!['planning','building','testing','market','ended'].includes(b.phase)||!b.team||Object.keys(JOBS).some(j=>!Number.isInteger(b.team[j])||b.team[j]<1||b.team[j]>3)||Object.values(b.team).reduce((a,c)=>a+c,0)>8||!Array.isArray(b.ledger)||!b.costs||!Array.isArray(b.decisions))throw new Error('经营存档格式无效');
 if(Object.keys(b.team).some(j=>!JOBS[j])||!Number.isInteger(b.revenue)||b.revenue<0||!Number.isInteger(b.users)||b.users<0||Object.keys(b.costs).some(k=>!['wages','hosting','marketing','hiring','upgrades','interest'].includes(k))||['wages','hosting','marketing','hiring'].some(k=>!Number.isInteger(b.costs[k])||b.costs[k]<0))throw new Error('经营财务字段无效');
 if(b.costs.upgrades!==undefined&&(!Number.isInteger(b.costs.upgrades)||b.costs.upgrades<0))throw new Error('升级费用无效');
 if(b.ceo&&(!Array.isArray(b.ceo.history)||typeof b.ceo.enabled!=='boolean'||!Number.isInteger(b.ceo.lastDecisionDay)))throw new Error('CEO存档格式无效');
 if(b.plan)readPlan(b.plan);
 if(b.financing!==undefined&&(!Number.isInteger(b.financing)||b.financing<0||b.debt!==b.financing))throw new Error('融资与负债不一致');
 if((b.debt!==undefined&&(!Number.isInteger(b.debt)||b.debt<0||b.debt!==(b.financing||0)))||(b.costs.interest!==undefined&&(!Number.isInteger(b.costs.interest)||b.costs.interest<0)))throw new Error('贷款或利息字段无效');
 if(b.ceo&&((b.ceo.loans!==undefined&&(!Number.isInteger(b.ceo.loans)||b.ceo.loans<0||b.ceo.loans>3))||(b.ceo.research!==undefined&&(!Array.isArray(b.ceo.research)||b.ceo.research.length>2||new Set(b.ceo.research).size!==b.ceo.research.length||b.ceo.research.some(t=>!['quality','growth','efficiency'].includes(t))))))throw new Error('CEO研究或借款记录无效');
 if(b.ceo?.loans!==undefined&&(b.financing||0)!==b.ceo.loans*5000)throw new Error('贷款本金与借款次数不一致');
 if(b.officeLevel!==undefined&&(!Number.isInteger(b.officeLevel)||b.officeLevel<0||b.officeLevel>2))throw new Error('办公升级等级无效');
 if(b.cash!==b.initial+b.revenue+(b.financing||0)-Object.values(b.costs).reduce((a,c)=>a+c,0))throw new Error('经营账本余额不一致');return b;
}
function expense(b,kind,amount,label){b.cash-=amount;b.costs[kind]=(b.costs[kind]||0)+amount;b.ledger.push({day:b.day,kind,amount:-amount,label,balance:b.cash});}
export function hire(b,job){
 if(!JOBS[job])throw new Error('没有这个岗位');
 if(b.finished)throw new Error('本轮经营已结束');
 if(b.team[job]>=3||Object.values(b.team).reduce((a,n)=>a+n,0)>=8)throw new Error('每岗位最多3人，团队最多8人');
 if(b.cash<3000+payroll(b)+JOBS[job].wage+150)throw new Error('资金不足以支付招聘及下一天基本运营费用');
 b.team[job]++;expense(b,'hiring',3000,`招聘${JOBS[job].name}，团队现有${b.team[job]}人`);
 b.decisions.push({day:b.day,text:`招聘${JOBS[job].name}，工资增加${JOBS[job].wage}/日`});
}
export function readPlan(raw){
 if(!raw||!Number.isInteger(raw.price)||raw.price<29||raw.price>199||!Number.isInteger(raw.marketing)||raw.marketing<0||raw.marketing>2000||!['quality','speed','growth'].includes(raw.focus))throw new Error('运营方案需要 price（29—199整数）、marketing（每日0—2000整数）、focus（quality/speed/growth）');
 const hires={};for(const job of Object.keys(JOBS)){const count=raw.hires?.[job]??0;if(!Number.isInteger(count)||count<0||count>2)throw new Error('每岗位本次最多建议招聘2人');hires[job]=count;}
 return {price:raw.price,marketing:raw.marketing,focus:raw.focus,hires};
}
export function launchPreparation(b,plan,requirements,disputes){
 b.plan=plan;b.totalWork=16+Math.min(24,requirements.filter(r=>!r.supersededBy).length*2);b.work=0;b.phase='building';
 b.quality=Math.min(95,62+b.team.engineer*7+(plan.focus==='quality'?12:0)-(plan.focus==='speed'?8:0));
 b.fit=Math.min(95,55+b.team.pm*10+Math.min(10,disputes.filter(d=>d.resolved).length*2));
 b.decisions.push({day:b.day,text:`定价${plan.price}元；推广${plan.marketing}元/日；策略${{quality:'质量优先',speed:'尽快上线',growth:'增长优先'}[plan.focus]}`});
}
export function finish(b,reason){
 if(b.finished)return;b.finished=true;b.phase='ended';
 const daysInMarket=b.ledger.filter(x=>x.kind==='sales').length;
 b.report={reason,day:b.day,cash:b.cash,profit:b.cash-b.initial-(b.debt||0),debt:b.debt||0,revenue:b.revenue,users:b.users,daysInMarket,costs:{...b.costs},decisions:b.decisions.slice(),lessons:[daysInMarket?'越早上线，可销售的天数越多；同时要留意质量和价格对转化的影响。':'本轮尚未进入销售期，筹备和开发消耗了资金与时间。',b.cash-(b.debt||0)<b.initial?'收入尚未覆盖全部成本，下轮可控制范围、缩短上线时间或调整定价推广。':'本轮收入覆盖了成本，可比较增加员工的工资与提早上线带来的收益。']};
}
function closeDay(b){if(b.cash<=0)finish(b,'资金耗尽');else if(b.day>=b.limit)finish(b,'30天经营周期结束');}
function beginDay(b){b.day++;expense(b,'wages',payroll(b),'团队当日工资');expense(b,'hosting',150,'当日基础运营');if(b.ceo?.loans)expense(b,'interest',50*b.ceo.loans,'虚拟应急贷款当日利息');}
export function planningDay(b){if(!b.started||b.finished)return;beginDay(b);closeDay(b);}
export function advanceBusiness(b){
 if(!b.started||b.finished||!BUSINESS_STAGES.has(b.phase))return null;
 if(b.day>=b.limit){finish(b,'30天经营周期结束');return {text:'30天经营周期结束。',channel:'group'};}
 const previous=b.phase;beginDay(b);
 // Bankruptcy ends before buying promotion or selling products for this day.
 if(b.cash<=0){closeDay(b);return {text:'当日基本成本支付后资金耗尽，停止经营。',channel:'group'};}
 let text,channel;
 if(previous==='building'){
  const capacity=4+2*(b.team.engineer-1)+(b.plan.focus==='speed'?2:0)+(b.ceo?.research?.includes('efficiency')?2:0);b.work=Math.min(b.totalWork,b.work+capacity);
  text=`第${b.day}天：程序员团队${b.team.engineer}人，完成${b.work}/${b.totalWork}开发工作量（今日产能${capacity}）。`;channel='engineer';
  if(b.work>=b.totalWork){b.phase='testing';text+=' 模拟开发完成，进入测试。';}
 }else if(previous==='testing'){
  b.testDays++;text=`第${b.day}天：团队检查边界、异常和上线条件，已完成${b.testDays}/2天测试。`;channel='engineer';
  if(b.testDays>=2){b.phase='market';text+=' 模拟产品上线，下一天开始销售。';}
 }else{
  const promotion=Math.min(b.plan.marketing,Math.max(0,b.cash));expense(b,'marketing',promotion,'执行运营推广预算');
  const visitors=200+Math.floor(promotion/2)+80*b.team.ops+(b.plan.focus==='growth'?100:0)+(b.ceo?.research?.includes('growth')?40:0);
  const conversion=Math.max(.015,Math.min(.20,.035+b.quality*.0005+b.fit*.0003-b.plan.price/10000));
  const buyers=Math.floor(visitors*conversion),income=buyers*b.plan.price;b.users+=buyers;b.revenue+=income;b.cash+=income;
  b.ledger.push({day:b.day,kind:'sales',amount:income,label:`${visitors}访客 × ${(conversion*100).toFixed(2)}%转化 → ${buyers}单 × ${b.plan.price}元`,balance:b.cash,visitors,buyers,conversion,price:b.plan.price});
  text=`第${b.day}天：推广${promotion}元，${visitors}名模拟访客，${buyers}人购买，收入${income}元。模拟用户反馈：${b.quality>=80?'体验稳定，质量获得认可':'希望进一步打磨细节与异常体验'}；${b.plan.price>129?'部分用户认为价格偏高':'价格接受度较好'}。`;channel='ops';
 }
 closeDay(b);return {text,channel};
}
