import {JOBS,payroll,hire} from './business.mjs';
export const newCeo=()=>({enabled:false,lastDecisionDay:-10,history:[],research:[],loans:0});
const PROJECTS=[
 '面向自由职业者的轻量客户跟进网页产品：客户记录、跟进提醒、简单统计；首版不做账号、云同步和支付接口。',
 '面向个人的记账网页产品：收入支出记录、分类、月度统计；本机保存，首版不做多币种和云同步。',
 '面向小团队的任务清单网页产品：任务创建、负责人、进度与到期提醒；首版单机使用，不做多人实时同步。'
];
export function chooseProject(id){return PROJECTS[[...id].reduce((n,c)=>n+c.charCodeAt(0),0)%PROJECTS.length];}
export function recordCeo(b,text){b.ceo ||=newCeo();const entry={day:b.day,text};b.ceo.history.push(entry);b.ceo.lastDecisionDay=b.day;b.decisions.push({...entry,text:'AI CEO：'+text});return text;}
export function estimateDaily(b,price,marketing){
 const visitors=200+Math.floor(marketing/2)+80*b.team.ops+(b.plan.focus==='growth'?100:0)+(b.ceo?.research?.includes('growth')?40:0);
 const conversion=Math.max(.015,Math.min(.20,.035+b.quality*.0005+b.fit*.0003-price/10000));
 return Math.floor(visitors*conversion)*price-marketing-payroll(b)-150-50*(b.ceo?.loans||0);
}
// Adapt the original AI CEO's priority rules to WORKVERSE's cash, staff and project model.
export function runCeo(b){
 if(!b.ceo?.enabled||b.finished||!b.started)return null;
 const remaining=30-b.day,reserve=(payroll(b)+150)*7;
 if(b.cash<payroll(b)+150+100&&remaining>=2&&(b.ceo.loans||0)<3){
  b.ceo.loans=(b.ceo.loans||0)+1;b.financing=(b.financing||0)+5000;b.debt=(b.debt||0)+5000;b.cash+=5000;
  b.ledger.push({day:b.day,kind:'loan',amount:5000,label:'CEO虚拟应急贷款，期末仍须计入负债',balance:b.cash});
  return recordCeo(b,'申请5000元虚拟应急贷款，以支付近期工资；每笔贷款每日利息50元，期末未还本金从利润中扣除，最多3次。');
 }

 if(b.day-b.ceo.lastDecisionDay<2)return null;
 if(b.phase==='building'&&b.team.engineer<3){
  const left=b.totalWork-b.work,capacity=4+2*(b.team.engineer-1)+(b.plan.focus==='speed'?2:0);
  const saved=Math.ceil(left/capacity)-Math.ceil(left/(capacity+2));
  if(saved>=2&&remaining>=8&&b.cash>reserve+3000+7*JOBS.engineer.wage){
   try{hire(b,'engineer');return recordCeo(b,`补充1名程序员，支付3000元，日薪增加450元；预计缩短开发${saved}天，保留约7天运营现金。`);}catch{}
  }
 }
 if(b.phase==='market'&&remaining>=2){
  const budget=Math.min(1000,Math.max(0,Math.floor((b.cash-reserve)/Math.max(remaining,1)/100)*100));
  const candidates=[...new Set([0,Math.min(300,budget),Math.min(500,budget),budget])];
  let best={price:b.plan.price,marketing:Math.min(b.plan.marketing,budget),net:-Infinity};
  for(const price of [49,79,99,129,159,199])for(const marketing of candidates){const net=estimateDaily(b,price,marketing);if(net>best.net)best={price,marketing,net};}
  const current=estimateDaily(b,b.plan.price,b.plan.marketing);
  if((best.price!==b.plan.price||best.marketing!==b.plan.marketing)&&(best.net>current||b.plan.marketing>budget)){
   const old=`${b.plan.price}元／推广${b.plan.marketing}元`;b.plan.price=best.price;b.plan.marketing=best.marketing;
   return recordCeo(b,`复核现金与销售，方案由${old}调整为${best.price}元／推广${best.marketing}元每日。按当前游戏规则试算日净收益约${best.net}元；预留7天基本运营费用。`);
  }
 }
 if(['building','testing','market'].includes(b.phase)&&remaining>=6&&(b.officeLevel||0)<2&&b.cash>reserve+12000){
  const cost=4000;b.cash-=cost;b.costs.upgrades=(b.costs.upgrades||0)+cost;b.officeLevel=(b.officeLevel||0)+1;b.quality=Math.min(95,b.quality+4);
  b.ledger.push({day:b.day,kind:'upgrades',amount:-cost,label:`工作环境与设备升级至${b.officeLevel}级`,balance:b.cash});
  return recordCeo(b,`升级工作环境与设备至${b.officeLevel}级，支付4000元，产品质量提升4点（上限95）；保留现金安全垫。`);
 }
 if(['building','testing','market'].includes(b.phase)&&remaining>=8&&(b.ceo.research||[]).length<2&&b.cash>reserve+20000){
  b.ceo.research ||= [];const preferred=b.phase==='building'?['efficiency','quality','growth']:['growth','quality','efficiency'];const tech=preferred.find(x=>!b.ceo.research.includes(x));
  if(tech){b.cash-=5000;b.costs.upgrades=(b.costs.upgrades||0)+5000;b.ceo.research.push(tech);if(tech==='quality')b.quality=Math.min(95,b.quality+5);
   const effects={efficiency:'每日开发产能+2',quality:'产品质量+5（上限95）',growth:'每日访客+40'};b.ledger.push({day:b.day,kind:'upgrades',amount:-5000,label:'科技研究：'+effects[tech],balance:b.cash});return recordCeo(b,'投入5000元研究，'+effects[tech]+'，按剩余周期选择回报方向。');}
 }
 return null;
}
