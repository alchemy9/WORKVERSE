import { initEngine,getCtx,getZoom,getSize,toScreen,setCam,setZoom,setClickHandler,smoothZoom } from '/src/engine.js';
import { drawDiamond } from '/src/renderer/primitives.js';
import { drawFurniture } from '/src/renderer/furniture.js';
import { drawAgent,setHoveredAgent } from '/src/renderer/agents.js';
import { drawBackWalls,drawFrontWalls,drawWallShadows } from '/src/renderer/walls.js';
import { placeRoom,getWalkable,addCorridor } from '/src/map.js';
import { initFloorPlan } from '/src/floorplan.js';
import { findPath } from '/src/pathfinding.js';
import { G } from '/src/game.js';

export function initOffice(onChat) {
  initEngine();initFloorPlan('wide');
  const room=placeRoom('engineering',10,14,14,10);room.constructionProgress=1;room.type={...room.type,name:'WORKVERSE',wallBase:[73,83,90],accent:'#b9956a'};
  room.furnitureList=[['desk',13,16],['monitor',13,16],['chair',13,17],['desk',19,16],['monitor',19,16],['chair',19,17],['table',17,21],['chair',16,21],['chair',18,21],['plant',11,15],['plant',22,15],['whiteboard',16,14],['shelf',21,14]].map(([type,x,y])=>({type,x,y,_room:room,screens:1}));
  const grid=getWalkable();
  for(let y=15;y<23;y++)for(let x=11;x<23;x++)grid[y][x]=true;
  for(const f of room.furnitureList)if(!['chair','plant'].includes(f.type))grid[f.y][f.x]=false;
  for(let x=12;x<22;x++)addCorridor(x,24);
  const agents=[];let teamKey='';
  const slots=[[12,16],[16,16],[20,16],[12,19],[16,19],[20,19],[11,22],[15,22],[21,22]];
  const meetingSpots=[[14,20],[18,20],[20,20],[12,20],[18,22],[21,21],[12,22],[16,23],[20,23]];
  const roleNames={pm:'产品经理',engineer:'程序员',ops:'运营'};
  function syncTeam(next){
    const team=next.business?.team||{pm:1,engineer:1,ops:0},signature=next.id+JSON.stringify(team)+(next.business?.officeLevel||0);if(signature===teamKey)return;teamKey=signature;agents.length=0;
    const furniture=[['table',17,21],['chair',16,21],['chair',18,21],['plant',11,15],['whiteboard',16,14],['shelf',21,14]];
    for(const [r,role] of ['pm','engineer','ops'].entries())for(let i=0;i<(team[role]||0);i++){
      const [x,y]=slots[i*3+r];furniture.push(['desk',x,y],['monitor',x,y],['chair',x,y+1]);
      agents.push({id:role+'-'+(i+1),actor:role,name:roleNames[role]+(i?' '+(i+1):''),x,y:y+1,role:{color:{pm:'#c59d6c',engineer:'#6c9eb6',ops:'#7ba68a'}[role],accessory:role==='engineer'?'glasses':'pen'},skinTone:'#d4b394',hairColor:'#35302b',hairStyle:i%2,home:{x,y:y+1},meeting:{x:meetingSpots[i*3+r][0],y:meetingSpots[i*3+r][1]},energy:1,mood:.9,frame:0,dir:2,bobY:0,state:'idle',speech:'',speechTimer:0,path:[],pathIdx:0});
    }
    if(next.business?.officeLevel>=1)furniture.push(['coffeemachine',22,18]);if(next.business?.officeLevel>=2)furniture.push(['server',22,21]);
    room.furnitureList=furniture.map(([type,x,y])=>({type,x,y,_room:room,screens:next.business?.officeLevel>=2?2:1}));
    for(let y=15;y<24;y++)for(let x=11;x<23;x++)grid[y][x]=true;
    for(const f of room.furnitureList)if(!['chair','plant'].includes(f.type))grid[f.y][f.x]=false;
    locations='';
  }
  let state={status:'idle'},last=performance.now(),lastMessage='',locations='';
  G.agents=agents;G.companyType='saas_startup';
  function center(){
    const side=document.querySelector('.workspace').getBoundingClientRect().width,left=innerWidth-side;
    const top=document.querySelector('.office-state').getBoundingClientRect().bottom+22,bottom=document.querySelector('.staff-row').getBoundingClientRect().top-24;
    const z=Math.max(.4,Math.min(1,(left-60)/768,Math.max(120,bottom-top)/420));setZoom(z);setCam(left/2+64*z,(top+bottom)/2-560*z);
  }
  center();window.addEventListener('resize',center);document.querySelector('#center-office').onclick=center;
  setClickHandler((x,y)=>{for(const a of agents){const s=toScreen(a.x,a.y);if(Math.abs(x-s.x)<24*getZoom()&&Math.abs(y-(s.y-18*getZoom()))<30*getZoom()){G.selectedAgent=a;onChat(a.actor);break;}}});
  function frame(now){
    const dt=Math.max(0,Math.min(2,(now-last)/16.67));last=now;smoothZoom();G.gameTick+=dt;
    const isMeeting=['discussion','review','launch-plan'].includes(state.status),key=isMeeting?'meeting':'home';
    if(key!==locations){locations=key;for(const a of agents){const target=a[key];a.path=findPath(grid,Math.round(a.x),Math.round(a.y),target.x,target.y)||[];a.pathIdx=0;}}
    for(const a of agents){
      a.frame+=dt;a.speechTimer=Math.max(0,a.speechTimer-dt);
      const p=a.path[a.pathIdx];
      if(p){const dx=p.x-a.x,dy=p.y-a.y,d=Math.hypot(dx,dy),speed=.045*dt;if(d<=speed||d<.001){a.x=p.x;a.y=p.y;a.pathIdx++;}else{a.x+=dx/d*speed;a.y+=dy/d*speed;}a.state='walking';a.bobY=Math.sin(a.frame*.4)*.6;}
      else{a.state=['analysis','review','discussion','generating','launch-plan','building','testing','market'].includes(state.status)?'working':'idle';a.bobY=0;}
      a.inMeeting=isMeeting;
    }
    const ctx=getCtx(),{W,H}=getSize(),z=getZoom();ctx.clearRect(0,0,W,H);ctx.fillStyle='#15191c';ctx.fillRect(0,0,W,H);
    for(let y=14;y<24;y++)for(let x=10;x<24;x++) {const s=toScreen(x,y);drawDiamond(s.x,s.y,64*z,32*z,(x+y)%2?'#303a40':'#333e44');}
    drawWallShadows();drawBackWalls();
    const objects=[...room.furnitureList.map(f=>({x:f.x,y:f.y,f})),...agents.map(a=>({x:a.x,y:a.y,a}))].sort((a,b)=>(a.x+a.y)-(b.x+b.y));
    for(const o of objects){if(o.a){const name=o.a.name,speech=o.a.speech;o.a.name='';o.a.speech='';drawAgent(o.a);o.a.name=name;o.a.speech=speech;const s=toScreen(o.a.x,o.a.y);ctx.font=`${Math.max(12,12*z)}px system-ui`;ctx.textAlign='center';const width=ctx.measureText(name).width;ctx.fillStyle='#151b20e8';ctx.beginPath();ctx.roundRect(s.x-width/2-6,s.y+9*z,width+12,21,4);ctx.fill();ctx.fillStyle='#e4e8df';ctx.fillText(name,s.x,s.y+24*z);}else drawFurniture(o.f);}
    drawFrontWalls();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return {update(next){state=next;const previousTeam=teamKey;syncTeam(next);if(previousTeam!==teamKey)center();const message=next.messages.filter(m=>['pm','engineer','ops'].includes(m.actor)&&!m.obsolete&&!m.rejected).at(-1);if(message&&message.id!==lastMessage){lastMessage=message.id;const a=agents.find(a=>a.actor===message.actor);if(!a)return;a.speech=message.text.slice(0,32);a.speechTimer=400;}},agents,grid};
}
