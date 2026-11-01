// Shared, pure view rules: HTTP replies can arrive after a newer live update.
export function acceptsSnapshot(current,next){return !current||Number(next.saveSeq||0)>=Number(current.saveSeq||0);}
export function visibleMessages(state,channel){
  return state.messages.filter(m=>channel==='all'||m.channel===channel||(['pm','engineer','ops'].includes(channel)&&m.workRole===channel)||(['pm','engineer','ops'].includes(channel)&&m.actor===channel&&['agents','group'].includes(m.channel)));
}
export function numberedAnswer(questions,id,answer,draft){
  const q=questions.find(q=>q.id===id);if(!q)return draft;
  const prefix=`${questions.indexOf(q)+1}. ${q.text}：`;
  const lines=draft.split('\n'),index=lines.findIndex(line=>line.startsWith(prefix));
  if(index>=0)lines[index]=prefix+answer;else lines.push(prefix+answer);
  const known=new Map(questions.map((q,i)=>[`${i+1}. ${q.text}：`,i]));
  const ranked=[],other=[];
  for(const line of lines){const item=[...known].find(([p])=>line.startsWith(p));if(item)ranked.push({rank:item[1],line});else if(line.trim())other.push(line);}
  return [...other,...ranked.sort((a,b)=>a.rank-b.rank).map(x=>x.line)].join('\n');
}
