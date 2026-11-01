import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { Store } from './store.mjs';
import { DeepSeek } from './provider.mjs';
import { Coordinator } from './coordinator.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
// Preserve the original development workspace; independent clones use repository-local private storage.
export function storagePaths(root=repo){
  const workspace=path.resolve(root,'../..');
  const legacy=path.basename(path.dirname(root))==='outputs'&&existsSync(path.join(workspace,'outputs/workverse-data'));
  return {dataDir:legacy?path.join(workspace,'outputs/workverse-data'):path.join(root,'.workverse/data'),keyFile:legacy?path.join(workspace,'work/workverse-local/config.env'):path.join(root,'.workverse/config.env')};
}
export async function createApp({port=8010,dataDir=storagePaths().dataDir,keyFile=storagePaths().keyFile,provider,store:providedStore,heartbeatMs=5000,disconnectMs=15000,businessTickMs=5000}={}) {
  const store=providedStore||new Store(dataDir), state=await store.load();
  provider ||= new DeepSeek({keyFile});
  const c=new Coordinator({state,store,provider}), secret=randomBytes(32).toString('hex');
  const sessions=new Set();let owner=null, closing=false, origin;
  const clients=new Map();
  const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
  const metadata=async()=>({configured:await provider.configured(),model:'deepseek-flash',keyFile,dataDir,origin,saves:await store.listSlots(c.s)});
  const broadcast=()=>{for(const [ws,info] of clients)if(ws.readyState===1)ws.send(JSON.stringify({type:'state',state:c.view(),control:owner===info.id,screen:info.screen}));};
  c.on('change',broadcast);c.on('internalError',()=>{ /* Details stay out of browser logs and credentials. */ });
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.headers.host!==new URL(origin).host) return json(res,403,{error:'只允许本机地址访问'});
      const url=new URL(req.url,origin), pathname=decodeURIComponent(url.pathname);
      if(pathname.startsWith('/api/')) {
        if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'不允许其他网站访问本机项目'});
        if(req.method==='GET'&&pathname==='/api/bootstrap') {
          const id=randomBytes(24).toString('hex');sessions.add(id);if(sessions.size>200)sessions.delete(sessions.values().next().value);
          return json(res,200,{session:id,state:c.view(),meta:await metadata()});
        }
        const id=req.headers['x-workverse-session'];
        if(!sessions.has(id)||(req.method!=='GET'&&req.headers.origin!==origin)||req.headers['x-workverse-token']!==secret)return json(res,403,{error:'页面会话已失效，请重新打开'});
        if(req.method==='GET'&&pathname==='/api/export') {
          const v=c.s.versions.find(v=>v.number===Number(url.searchParams.get('version')));
          if(!v)return json(res,404,{error:'没有该正式版本'});
          const date=new Date(v.at).toLocaleDateString('sv-SE'),name=`${c.s.title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_')}-PRD-v${v.number}-${date}.md`;
          res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'cache-control':'no-store'});return res.end(v.markdown);
        }
        if(req.method!=='POST')return json(res,405,{error:'不支持此操作'});
        if(![...clients.values()].some(info=>info.id===owner&&info.session===id))return json(res,409,{error:'此页面只读，请先接管控制权'});
        if(req.headers['content-type']!=='application/json')return json(res,415,{error:'请求格式错误'});
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1048576)return json(res,413,{error:'输入过大'});}
        let input;try{input=JSON.parse(body||'{}');}catch{return json(res,400,{error:'请求不是有效 JSON'});}
        const ownerInfo=[...clients.values()].find(info=>info.id===owner);
        if(ownerInfo.screen==='home'&&!['/api/new-game','/api/enter','/api/config','/api/open-config','/api/recover','/api/save'].includes(pathname))return json(res,409,{error:'请先从首页进入游戏'});
        switch(pathname) {
          case '/api/new-game':
            if(ownerInfo.screen!=='home')throw new Error('请先退出游戏回到首页');
            await c.selectSave(null,{newGame:true});c.online=true;
            try{await c.enter();ownerInfo.screen='game';broadcast();}catch(e){c.online=false;throw e;}break;
          case '/api/enter':
            if(input.saveId&&ownerInfo.screen!=='home')throw new Error('请先退出游戏再选择存档');
            if(input.saveId)await c.selectSave(input.saveId);
            c.online=true;
            try{await c.enter();ownerInfo.screen='game';broadcast();}catch(e){c.online=ownerInfo.screen==='game';throw e;}break;
          case '/api/exit':
            await c.exit(input.drafts||{});ownerInfo.screen='home';broadcast();break;
          case '/api/ceo':await c.setCeo(input.enabled);break;
          case '/api/hire':await c.hireStaff(input.job);break;
          case '/api/message': await c.send(input.channel,input.text,input.clientId,input.submittedQuestionIds);break;
          case '/api/draft':await c.draft(input.channel,input.text);break;
          case '/api/pause':await c.pause();break;
          case '/api/resume':c.online=true;await c.resume();break;
          case '/api/recover':await c.recover();break;
          case '/api/save':await c.exclusive(()=>c.persist());break;
          case '/api/config':return json(res,200,{meta:await metadata()});
          case '/api/open-config':
            if(process.platform!=='darwin')throw new Error('请使用本机文本编辑器打开设置中显示的文件');
            await fs.mkdir(path.dirname(keyFile),{recursive:true,mode:0o700});
            try{await fs.writeFile(keyFile,'# 只在本机填写，不要发到聊天中。\nDEEPSEEK_API_KEY=\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
            await new Promise((resolve,reject)=>execFile('/usr/bin/open',['-a','TextEdit',keyFile],e=>e?reject(new Error('无法打开编辑器，请手动打开配置文件')):resolve()));
            return json(res,200,{opened:true});
          default:return json(res,404,{error:'没有此接口'});
        }
        return json(res,200,{state:c.view(),meta:await metadata(),screen:ownerInfo.screen});
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'只读资源'});
      if(pathname==='/'){res.writeHead(302,{location:'/workverse/'});return res.end();}
      if(pathname.includes('..')||pathname.includes('\\')||pathname.includes('\0'))return json(res,404,{error:'资源不存在'});
      let file;
      if(pathname==='/workverse/'||pathname==='/workverse/index.html')file=path.join(repo,'workverse/index.html');
      else if(/^\/workverse\/client\/[a-z0-9-]+\.(js|css)$/.test(pathname))file=path.join(repo,pathname);
      else if(/^\/src\/[a-zA-Z0-9/_-]+\.js$/.test(pathname)||/^\/assets\/[a-zA-Z0-9/_. -]+\.(webp|png|jpg|mp3)$/.test(pathname))file=path.join(repo,pathname);
      else return json(res,404,{error:'资源不存在'});
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.mp3':'audio/mpeg'};
      const data=await fs.readFile(file);
      res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",'referrer-policy':'no-referrer'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch(e) { json(res,e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'资源不存在':e.message}); }
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:16384});
  server.on('upgrade',(req,socket,head)=>{
    const url=new URL(req.url,origin),session=url.searchParams.get('session');
    if(url.pathname!=='/live'||req.headers.origin!==origin||req.headers.host!==new URL(origin).host||!sessions.has(session)){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,session));
  });
  wss.on('connection',(ws,req,session)=>{
    const info={id:randomBytes(12).toString('hex'),session,screen:new URL(req.url,origin).searchParams.get('screen')==='game'?'game':'home',lastPong:Date.now()};clients.set(ws,info);
    if(!owner){owner=info.id;c.online=info.screen==='game';}
    ws.send(JSON.stringify({type:'hello',token:secret,control:owner===info.id,screen:info.screen,state:c.view()}));
    ws.on('pong',()=>{info.lastPong=Date.now();});
    ws.on('error',()=>{});
    ws.on('message',async raw=>{
      try {const m=JSON.parse(raw.toString());if(m.type==='takeover'){
        if(owner!==info.id)await c.pause('控制权已切换，点击继续恢复。');
        owner=info.id;c.online=info.screen==='game';broadcast();
      }}catch{}
    });
    ws.on('close',()=>{
      clients.delete(ws);
      if(owner===info.id){owner=null;c.online=false;if(!closing&&info.screen==='game')c.pause('页面连接已断开，重新打开后点击继续。').catch(()=>{});}
      broadcast();
    });
  });
  let ticking=false;const businessTimer=setInterval(()=>{if(ticking)return;ticking=true;c.advanceDay().catch(()=>{}).finally(()=>ticking=false);},businessTickMs);businessTimer.unref();
  const timer=setInterval(()=>{
    for(const [ws,info] of clients){
      if(Date.now()-info.lastPong>=disconnectMs){
        if(owner===info.id){owner=null;c.online=false;if(info.screen==='game')c.pause('连接失联，协作已暂停。').catch(()=>{});}ws.terminate();
      }else if(ws.readyState===1)ws.ping();
    }
  },heartbeatMs);timer.unref();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {server,c,wss,origin,metadata,async close(){closing=true;clearInterval(timer);clearInterval(businessTimer);c.online=false;await c.pause('本机服务已停止，重新启动后点击继续。').catch(()=>{});for(const ws of clients.keys())ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const app=await createApp();console.log(`WORKVERSE 已启动：${app.origin}/workverse/\n密钥在本机配置，启动本身不会调用 AI。`);
    if(process.argv.includes('--open'))execFile('/usr/bin/open',[`${app.origin}/workverse/`],()=>{});
    for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>app.close().finally(()=>process.exit(0)));
  }catch(e){console.error(e.code==='EADDRINUSE'?'8010 端口已被占用，请关闭此前的 WORKVERSE 服务或稍后重试。':`启动失败：${e.message}`);process.exitCode=1;}
}
