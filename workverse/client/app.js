import {renderBusiness} from './business.js';
import {initOffice} from './office.js';
import {acceptsSnapshot,visibleMessages,numberedAnswer} from './conversation.js';
const $=s=>document.querySelector(s),names={pm:'产品经理',engineer:'程序员',ops:'运营',player:'你',system:'系统'},channels={all:'全部记录',group:'项目群聊',pm:'与产品经理私聊',engineer:'与程序员私聊',ops:'与运营私聊',agents:'AI 工作讨论'};
const labels={idle:'等待你的第一个需求',analysis:'正在分析需求',review:'正在进行技术评审',discussion:'团队正在讨论',waiting:'等待你的回答',generating:'正在整理需求文档',delivered:'本版需求文档已交付',paused:'协作已暂停',error:'等待处理异常','launch-plan':'运营正在制定方案',building:'团队正在模拟开发',testing:'团队正在模拟测试',market:'产品正在销售',ended:'经营周期已结束'};
let state,meta,session,token,ws,control=false,channel='all',selectedVersion=null,rendered='',autoScroll=true,draftTimer,toastTimer,sending=false,retryTimer,questionKey='',failedSubmission=null,saveListKey='';
let screen='home',navigating=false,draftWrite=Promise.resolve();
const office=initOffice(selectChannel);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
async function api(action,data={}) {
  if(!token)throw new Error('正在连接本机服务，请稍后');
  const response=await fetch('/api/'+action,{method:'POST',headers:{'content-type':'application/json','x-workverse-session':session,'x-workverse-token':token},body:JSON.stringify(data)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'本机操作失败');
  if(value.meta)meta=value.meta;if(value.screen)setScreen(value.screen);if(value.state)update(value.state);return value;
}
function fire(action,data){return api(action,data).catch(e=>toast(e.message));}
function selectChannel(next){
  if(!state)return;
  saveDraft();channel=next;autoScroll=true;rendered='';
  document.querySelectorAll('[data-channel]').forEach(b=>b.classList.toggle('selected',b.dataset.channel===next));
  $('#conversation-title').textContent=['pm','engineer','ops'].includes(next)?names[next]+' · 工作与私聊':channels[next];$('#composer').hidden=next==='agents'||!control;$('#readonly').hidden=next!=='agents'&&control;
  $('#recipient').textContent='发送到：'+(next==='pm'?'产品经理':next==='engineer'?'程序员':next==='ops'?'运营':'项目群');
  $('#message-input').value=state.drafts[recipient()]||'';renderMessages();renderQuestions();
}
function recipient(){return ['pm','engineer','ops'].includes(channel)?channel:'group';}
function saveDraft(){clearTimeout(draftTimer);if(!state||channel==='agents'||!control)return;const target=recipient(),value=$('#message-input').value;state.drafts[target]=value;draftWrite=draftWrite.catch(()=>{}).then(()=>api('draft',{channel:target,text:value}));draftWrite.catch(e=>toast(e.message));return draftWrite;}
function renderMessages(){
  const visible=visibleMessages(state,channel),key=JSON.stringify(visible.map(m=>[m.id,m.text,m.obsolete,m.rejected,m.reason]));
  if(key===rendered)return;rendered=key;
  const box=$('#messages'),old=box.scrollTop,follow=autoScroll||box.scrollHeight-box.scrollTop-box.clientHeight<80;
  if(!visible.length){box.innerHTML='<div class="empty"><div class="empty-mark">W</div><h3>'+ (channel==='all'?'从你的第一个想法开始':'这里还没有工作消息')+'</h3><p>描述你想做的软件产品，团队会澄清需求、讨论方案，并生成需求文档。</p></div>';return;}
  box.innerHTML=visible.map(m=>`<div class="message ${escape(m.actor)} ${m.obsolete||m.rejected?'obsolete':''}" id="message-${escape(m.id)}"><div class="message-head"><strong>${names[m.actor]||'员工'}</strong><span class="message-tag">${escape(channels[m.channel]||m.channel)}</span>${m.simulation?'<span class="message-tag">经营模拟</span>':''}${m.obsolete?'<span class="message-tag">已过时 · 未采纳</span>':m.rejected?'<span class="message-tag">待修订 · 未采纳</span>':''}<time>${new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div><div class="message-text">${escape(m.text)}</div>${m.reason?`<p class="subtle">${escape(m.reason)}</p>`:''}${m.sourceId?`<button class="source-link" data-source="${escape(m.sourceId)}">查看来源 · ${escape(channels[m.sourceChannel]||'原消息')}</button>`:''}</div>`).join('');
  if(follow){autoScroll=true;box.scrollTop=box.scrollHeight;$('#new-messages').hidden=true;}else{box.scrollTop=old;$('#new-messages').hidden=false;}
  box.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{selectChannel('all');const el=document.getElementById('message-'+b.dataset.source);el?.scrollIntoView({block:'center'});el?.classList.add('highlight');setTimeout(()=>el?.classList.remove('highlight'),2000);});
}
function setScreen(next){const changed=screen!==next;screen=next;document.body.dataset.screen=next;if(changed&&next==='game')$('#center-office').click();if(changed&&next==='home'){saveListKey='';$('#save-select').value=state?.id||'';}document.title=next==='home'?'WORKVERSE · 首页':'WORKVERSE · AI 协作办公室';}
function renderHome(){
  const hasSave=state.messages.some(m=>m.actor==='player')||state.versions.length||Object.values(state.drafts).some(Boolean);
  $('#home-save-label').textContent=hasSave?'本机存档':'准备开始';
  $('#home-project').textContent=hasSave?state.title:'你的第一间 AI 办公室';
  $('#home-stage').textContent=hasSave?((state.exitState?.autoResume?'离开时：':'')+(labels[state.exitState?.status||state.status]||'已保存进度')+(state.exitState?.autoResume?' · 当前已暂停':'')):'给团队一个想法，开始你的第一次产品协作。';
  $('#home-details').hidden=!hasSave;$('#home-saved').textContent=state.savedAt?new Date(state.savedAt).toLocaleString('zh-CN'):'尚未保存';$('#home-versions').textContent=state.versions.length+' 个版本';
  const saves=meta?.saves||[],select=$('#save-select'),key=JSON.stringify(saves);
  if(key!==saveListKey){const previous=select.value;saveListKey=key;select.innerHTML=saves.length?saves.map(s=>`<option value="${escape(s.id)}" ${s.invalid?'disabled':''}>${escape(s.title)}${s.invalid?'':` · ${s.versions}版文档 · ${s.savedAt?new Date(s.savedAt).toLocaleString('zh-CN'):'尚未保存'}`}</option>`).join(''):'<option value="">暂无存档</option>';select.value=saves.some(s=>s.id===previous&&!s.invalid)?previous:saves.some(s=>s.id===state.id)?state.id:saves.find(s=>!s.invalid)?.id||'';}
  const selected=saves.find(s=>s.id===select.value&&!s.invalid);
  if(selected){$('#home-save-label').textContent='本机存档';$('#home-project').textContent=selected.title;$('#home-stage').textContent=labels[selected.status]||'已保存进度';$('#home-details').hidden=false;$('#home-saved').textContent=selected.savedAt?new Date(selected.savedAt).toLocaleString('zh-CN'):'尚未保存';$('#home-versions').textContent=selected.versions+' 个版本'+(selected.business?` · 第${selected.business.day}/30天 · 资金${selected.business.cash.toLocaleString('zh-CN')}`:' · 需求协作存档');}
  $('#enter-button').textContent=navigating?'正在进入…':'读取存档 →';$('#enter-button').hidden=!saves.some(s=>!s.invalid);$('#enter-button').disabled=!selected||!control||!token||navigating||Boolean(state.recovery);
  $('#new-game-button').disabled=!control||!token||navigating||Boolean(state.recovery)||Boolean(state.saveError);$('#new-game-button').classList.toggle('primary',!saves.some(s=>!s.invalid));select.disabled=!control||navigating||!saves.length;
  $('#home-takeover').hidden=control;$('#home-notice').textContent=state.recovery?'存档需要恢复，请打开设置处理。':!control?'游戏正在其他页面使用，请接管后继续。':state.saveError?state.saveError:'';
}
async function exitGame(){
  if(navigating||sending||!control)return;
  navigating=true;clearTimeout(draftTimer);$('#exit-button').disabled=true;$('#exit-button').textContent='正在保存…';$('#message-input').disabled=true;
  const drafts={...state.drafts};if(channel!=='agents')drafts[recipient()]=$('#message-input').value;
  try{await draftWrite.catch(()=>{});await api('exit',{drafts});toast('进度已保存，已返回首页');}
  catch(e){toast('退出未完成，已保留当前内容：'+e.message);}
  finally{navigating=false;$('#exit-button').textContent='退出游戏';$('#exit-button').disabled=!control;$('#send-button').disabled=Boolean(state.business?.finished)||!control||Boolean(state.recovery)||Boolean(state.saveError);$('#message-input').disabled=Boolean(state.business?.finished)||!control||navigating||Boolean(state.recovery);renderHome();}
}
function update(next){
  if(!acceptsSnapshot(state,next))return;
  if(state&&state.id!==next.id){selectedVersion=null;rendered='';questionKey='';failedSubmission=null;channel='all';document.querySelectorAll('[data-channel]').forEach(b=>b.classList.toggle('selected',b.dataset.channel==='all'));$('#conversation-title').textContent='全部记录';$('#recipient').textContent='发送到：项目群';$('#message-input').value=next.drafts.group||'';}
  state=next;$('.office-heading h2').textContent=state.business?'你的 AI 创业团队。':'一个需求，两位同事。';$('#office-caption').textContent=state.business?'你定方向，团队自主推进。用30天验证项目能赚多少钱。':'把想法交给团队，一起把它变成清晰的需求文档。';renderBusiness(state,control&&screen==='game'&&!state.saveError,api);renderHome();$('#exit-button').disabled=!control||navigating||sending;office.update(state);$('#project-title').textContent=state.title;$('#stage-label').textContent=labels[state.status]||state.status;$('#reply-count').textContent=`${state.replies} / 12`;
  $('#save-state').textContent=state.saveError?'保存失败':state.savedAt?'已保存':'尚未提交需求';
  $('#model-state').textContent=meta?.configured?'DeepSeek 已配置':'待配置 DeepSeek';$('#version-count').textContent=state.versions.length;
  $('#business-button').classList.toggle('primary',Boolean(state.business?.finished));$('#business-button').textContent=state.business?.finished?'查看复盘':'经营';
  $('#settings-button').classList.toggle('primary',!meta?.configured);$('#resume-button').classList.toggle('primary',Boolean(meta?.configured));
  $('#pause-button').hidden=Boolean(state.business?.finished)||!['analysis','review','discussion','generating','waiting','launch-plan','building','testing','market'].includes(state.status);$('#resume-button').hidden=Boolean(state.business?.finished)||!['paused','error'].includes(state.status);$('#pause-button').disabled=!control;$('#resume-button').disabled=!control;
  for(const role of ['pm','engineer','ops'])$('#'+role+'-status').textContent=state.business?.finished?'经营结束':state.step?.role===role?(labels[state.step.stage]||'工作中'):state.status==='waiting'?'等待你的回答':state.status==='delivered'?'文档已交付':'待命';
  const notice=$('#notice');notice.replaceChildren();
  const reasons=[];if(!control)reasons.push('此页面只读，可到原页面操作，或接管控制权。');if(state.pauseReason)reasons.push(state.pauseReason);if(!meta?.configured)reasons.push('密钥尚未配置，需求可先保存；点击“设置”查看本机填写位置。');
  notice.hidden=!reasons.length;const p=document.createElement('div');p.textContent=reasons.join(' ');notice.append(p);
  if(!control){const b=document.createElement('button');b.textContent='接管此页面';b.onclick=()=>ws?.send(JSON.stringify({type:'takeover'}));notice.append(b);}
  if(state.recovery&&control){const b=document.createElement('button');b.textContent='确认恢复备份（可能缺少最新内容）';b.onclick=()=>{if(confirm('恢复有效备份？损坏原件将保留，可能缺少最后一次保存后的内容。'))fire('recover');};notice.append(b);}
  if(state.saveError&&control){const b=document.createElement('button');b.textContent='重试保存';b.onclick=()=>fire('save');notice.append(b);}
  renderQuestions();
  const paused=['paused','error'].includes(state.status);
  $('#resume-near-input').hidden=Boolean(state.business?.finished)||!paused||!control;
  $('#resume-near-input').disabled=!control||sending;
  if(!sending)$('#send-hint').textContent=state.business?.finished?'本轮经营已结束，点击「经营」查看复盘，或返回首页开始新游戏。':paused?'协作已暂停，发送仅保存；点击「继续协作」后处理。':state.pending.length?'消息已保存，团队正在处理。':'Enter 发送 · Shift + Enter 换行';
  const working=$('#working');working.hidden=!state.step;working.textContent=state.step?`${names[state.step.role]} · ${labels[state.step.stage]}${state.step.attempt?` · 自动重试 ${state.step.attempt}/2`:''}`:'';
  $('#composer').hidden=channel==='agents'||!control;$('#readonly').hidden=channel!=='agents'&&control;$('#send-button').disabled=Boolean(state.business?.finished)||!control||navigating||sending||Boolean(state.recovery)||Boolean(state.saveError);$('#message-input').disabled=Boolean(state.business?.finished)||!control||navigating||Boolean(state.recovery);
  renderMessages();if($('#document-dialog').open)renderDocument();
}
function renderQuestions(){
  const open=state.questions.filter(q=>!q.resolved&&(!q.submittedBy||state.messages.some(m=>m.id===q.submittedBy&&m.unsaved))),box=$('#questions');
  box.hidden=!open.length||!['all','group'].includes(channel)||!control;
  const draft=$('#message-input').value,key=JSON.stringify([open,control]);
  if(key!==questionKey){
    questionKey=key;
    box.innerHTML='<div class="questions-heading">需求澄清<span>选择会按题号汇总到下方</span></div>'+open.map((q,i)=>`<div class="question"><strong>${i+1}. ${escape(q.text)}</strong>${(q.options||[]).map(option=>`<button type="button" data-answer="${escape(option)}" data-question="${escape(q.id)}">${escape(option)}</button>`).join('')}<button type="button" data-question="${escape(q.id)}">自由回答</button></div>`).join('');
    box.querySelectorAll('button').forEach(b=>{b.disabled=!control;b.onclick=()=>{
      const input=$('#message-input');
      input.value=numberedAnswer(open,b.dataset.question,b.dataset.answer||'请在此填写',input.value);
      saveDraft();renderQuestions();input.focus();
      if(!b.dataset.answer){const at=input.value.indexOf('请在此填写');input.setSelectionRange(at,at+6);}
    };});
  }
  box.querySelectorAll('[data-answer]').forEach(b=>{
    const q=open.find(q=>q.id===b.dataset.question),i=open.indexOf(q);
    const selected=draft.split('\n').includes(`${i+1}. ${q?.text}：${b.dataset.answer}`);
    b.setAttribute('aria-pressed',String(selected));
  });
}
function markdown(raw){
  const lines=raw.split('\n');let html='',code=false,table=false;
  for(const line of lines){
    if(line.startsWith('```')){if(table){html+='</tbody></table>';table=false;}html+=code?'</code></pre>':'<pre><code>';code=!code;continue;}
    if(code){html+=escape(line)+'\n';continue;}
    if(/^\|/.test(line)){if(/^\|[\s:|-]+\|?$/.test(line))continue;if(!table){html+='<table><tbody>';table=true;}html+='<tr>'+line.replace(/^\||\|$/g,'').split('|').map(c=>'<td>'+escape(c.trim())+'</td>').join('')+'</tr>';continue;}
    if(table){html+='</tbody></table>';table=false;}
    const heading=line.match(/^(#{1,3})\s+(.+)/);if(heading){html+=`<h${heading[1].length}>${escape(heading[2])}</h${heading[1].length}>`;continue;}
    if(!line.trim()){html+='<br>';continue;}
    html+='<p>'+escape(line).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')+'</p>';
  }return html+(code?'</code></pre>':'')+(table?'</tbody></table>':'');
}
function renderDocument(){
  const versions=state.versions;if(selectedVersion===null&&versions.length)selectedVersion=versions.at(-1).number;
  const current=versions.find(v=>v.number===selectedVersion),latest=versions.at(-1);
  const select=$('#version-select');select.innerHTML=versions.length?versions.map(v=>`<option value="${v.number}" ${v.number===selectedVersion?'selected':''}>v${v.number}${v===latest?' · 最新版本':' · 历史版本'}</option>`).join(''):'<option>暂无正式版本</option>';
  $('#export-button').disabled=!current;$('#document-meta').textContent=current?`${current===latest?'最新版':'正在查看历史版本'} · 需求修订 ${current.revision} · ${new Date(current.at).toLocaleString('zh-CN')}`:'等待团队完成评审';
  const banner=$('#document-update'),messages=[];if(latest&&selectedVersion!==latest.number)messages.push(`已有 v${latest.number}，可在版本列表选择查看。`);if(latest&&latest.revision<state.revision)messages.push('需求已更新，文档待更新。');if(state.status==='generating')messages.push('正在整理新文档，上一正式版本仍可阅读。');banner.textContent=messages.join(' ');banner.hidden=!messages.length;
  const key=current?`${current.number}-${current.markdown.length}`:'empty';if($('#document-body').dataset.key!==key){$('#document-body').dataset.key=key;$('#document-body').innerHTML=current?`<p class="subtle">变更摘要：${escape(current.summary)}</p>`+markdown(current.markdown):'<h3>尚未生成需求文档</h3><p>关键问题解决并完成技术评审后，产品经理会自动生成。</p>';}
}
function settings(){
  $('#settings-content').innerHTML=`<p>模型：<strong>deepseek-flash</strong> · ${meta.configured?'已配置密钥':'尚未配置密钥'}</p><p class="subtle">请用本机文本编辑器打开以下文件，在 DEEPSEEK_API_KEY= 后填写密钥，保存后重新检查配置。</p><code>${escape(meta.keyFile)}</code><button id="open-config" ${control?'':'disabled'}>打开本机配置文件</button><p>项目与全部聊天保存在：</p><code>${escape(meta.dataDir)}</code><p class="subtle">关闭页面后协作暂停，重开后点击继续。意外断线最多 15 秒检测；每次模型回复最多等待 120 秒。</p>`;
  if(state.recovery&&control){const b=document.createElement('button');b.textContent='恢复有效备份';b.onclick=async()=>{if(confirm('恢复有效备份？损坏原件将保留，可能缺少最后一次保存后的内容。')){await fire('recover');settings();}};$('#settings-content').append(b);}
  $('#open-config').onclick=()=>fire('open-config').then(result=>{if(result)toast('已用本机文本编辑器打开，填写后保存即可');});
}
async function bootstrap(){
  try{const response=await fetch('/api/bootstrap');if(!response.ok)throw new Error('本机服务无法读取');const data=await response.json();session=data.session;meta=data.meta;state=data.state;
    ws=new WebSocket(location.origin.replace('http','ws')+'/live?screen=home&session='+encodeURIComponent(session));
    ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.token)token=message.token;control=message.control;if(message.screen)setScreen(message.screen);update(message.state);};
    ws.onclose=()=>{control=false;token=null;$('#enter-button').disabled=true;$('#new-game-button').disabled=true;$('#home-notice').textContent='本机连接中断，正在重新连接…';$('#save-state').textContent='本机连接中断';$('#notice').hidden=false;$('#notice').textContent='连接已中断，协作将暂停。正在重新连接，恢复后需点击继续。';$('#send-button').disabled=true;retryTimer=setTimeout(bootstrap,2000);};
    ws.onerror=()=>{};
    update(state);$('#message-input').value=state.drafts[recipient()]||'';
  }catch(e){toast('本机连接失败：'+e.message);retryTimer=setTimeout(bootstrap,3000);}
}
$('#messages').onscroll=()=>{const box=$('#messages');autoScroll=box.scrollHeight-box.scrollTop-box.clientHeight<80;if(autoScroll)$('#new-messages').hidden=true;};
$('#new-messages').onclick=()=>{autoScroll=true;$('#messages').scrollTop=$('#messages').scrollHeight;$('#new-messages').hidden=true;};
document.querySelectorAll('[data-channel]').forEach(b=>b.onclick=()=>selectChannel(b.dataset.channel));document.querySelectorAll('[data-chat]').forEach(b=>b.onclick=()=>selectChannel(b.dataset.chat));
$('#exit-button').onclick=exitGame;
$('.brand').onclick=e=>{e.preventDefault();if(screen==='game')exitGame();};
$('#save-select').onchange=renderHome;
$('#new-game-button').onclick=async()=>{if(navigating||!control)return;navigating=true;renderHome();try{await api('new-game');selectedVersion=null;rendered='';failedSubmission=null;$('#message-input').value='';selectChannel('all');toast('新游戏已开始，原进度已保留在存档中');}catch(e){toast('新游戏未能开始：'+e.message);}finally{navigating=false;update(state);}};
$('#home-takeover').onclick=()=>ws?.send(JSON.stringify({type:'takeover'}));
$('#enter-button').onclick=async()=>{if(navigating||!control)return;navigating=true;renderHome();try{await api('enter',{saveId:$('#save-select').value});$('#message-input').value=state.drafts[recipient()]||'';renderQuestions();}catch(e){toast(e.message);}finally{navigating=false;update(state);}};
$('#resume-near-input').onclick=()=>fire('resume');
$('#participate').onclick=()=>selectChannel('group');$('#pause-button').onclick=()=>fire('pause');$('#resume-button').onclick=()=>fire('resume');
$('#message-input').oninput=()=>{renderQuestions();clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,450);};
$('#message-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();$('#composer').requestSubmit();}};
$('#composer').onsubmit=async e=>{e.preventDefault();if(sending||navigating||!control)return;const input=$('#message-input'),value=input.value;if(!value.trim())return;clearTimeout(draftTimer);sending=true;$('#send-button').disabled=true;$('#send-hint').textContent='正在保存消息…';
  const target=recipient(),body=value;
  const submittedQuestionIds=target==='group'?state.questions.filter(q=>!q.resolved&&!q.submittedBy).map(q=>q.id):[];
  const clientId=failedSubmission?.channel===target&&failedSubmission?.text===body?failedSubmission.clientId:crypto.randomUUID();failedSubmission={channel:target,text:body,clientId,submittedQuestionIds};
  try{await api('message',failedSubmission);if(recipient()===target&&input.value===value)input.value='';failedSubmission=null;state.drafts[target]='';autoScroll=true;$('#messages').scrollTop=$('#messages').scrollHeight;$('#send-hint').textContent=['paused','error'].includes(state.status)?'需求已保存，协作仍暂停。点击旁边「继续协作」开始处理。':'消息已保存，团队正在处理。';}
  catch(error){toast(error.message);$('#send-hint').textContent='发送失败，原文已保留，可重试';}
  finally{sending=false;$('#exit-button').disabled=!control||navigating;$('#send-button').disabled=Boolean(state.business?.finished)||!control||Boolean(state.recovery)||Boolean(state.saveError);$('#resume-near-input').disabled=!control;renderQuestions();}
};
$('#business-button').onclick=()=>{if(!state)return;$('#business-error').textContent='';$('#business-dialog').showModal();renderBusiness(state,control&&screen==='game'&&!state.saveError,api);};$('#close-business').onclick=()=>$('#business-dialog').close();
$('#document-button').onclick=()=>{if(!state)return;renderDocument();$('#document-dialog').showModal();};$('#close-document').onclick=()=>$('#document-dialog').close();
$('#version-select').onchange=e=>{selectedVersion=Number(e.target.value);renderDocument();};
$('#export-button').onclick=async()=>{try{const response=await fetch('/api/export?version='+selectedVersion,{headers:{'x-workverse-session':session,'x-workverse-token':token}});if(!response.ok)throw new Error('文档导出失败');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;const header=response.headers.get('content-disposition');a.download=header?.includes("UTF-8''")?decodeURIComponent(header.split("UTF-8''")[1]):`PRD-v${selectedVersion}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出所选版本');}catch(e){toast(e.message);}};
$('#settings-button').onclick=()=>{settings();$('#settings-dialog').showModal();};$('#close-settings').onclick=()=>$('#settings-dialog').close();$('#refresh-config').onclick=async()=>{try{await api('config');settings();update(state);toast(meta.configured?'密钥已配置，点击继续协作即可':'文件中尚未填写密钥');}catch(e){toast(e.message);}};
window.addEventListener('pagehide',()=>{clearTimeout(retryTimer);ws?.close();});
bootstrap();
