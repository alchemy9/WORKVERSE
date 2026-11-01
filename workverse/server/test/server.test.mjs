import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createApp,storagePaths} from '../index.mjs';

test('独立仓库的密钥与存档位于私有目录，原开发工作区保持兼容',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workverse-paths-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const standalone=path.join(root,'WORKVERSE');
  assert.deepEqual(storagePaths(standalone),{dataDir:path.join(standalone,'.workverse/data'),keyFile:path.join(standalone,'.workverse/config.env')});
  const legacy=path.join(root,'outputs','business-tycoon');await fs.mkdir(path.join(root,'outputs/workverse-data'),{recursive:true});
  assert.deepEqual(storagePaths(legacy),{dataDir:path.join(root,'outputs/workverse-data'),keyFile:path.join(root,'work/workverse-local/config.env')});
});

async function setup(t,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workverse-http-'));let calls=0;
  const provider={configured:async()=>false,complete:async()=>{calls++;throw new Error('未配置时不得调用');}};
  const app=await createApp({port:0,dataDir:dir,provider,...options});const sockets=[];
  t.after(async()=>{for(const socket of sockets)socket.terminate();await app.close();await fs.rm(dir,{recursive:true,force:true});});
  async function connect(extra={}) {
    const bootstrap=await (await fetch(app.origin+'/api/bootstrap')).json();
    const socket=new WebSocket(app.origin.replace('http','ws')+'/live?screen=game&session='+bootstrap.session,{origin:app.origin,...extra});sockets.push(socket);
    const [raw]=await once(socket,'message'),hello=JSON.parse(raw.toString());
    const headers={'content-type':'application/json','origin':app.origin,'x-workverse-session':bootstrap.session,'x-workverse-token':hello.token};
    return {socket,hello,bootstrap,headers,post:(action,body={})=>fetch(app.origin+'/api/'+action,{method:'POST',headers,body:JSON.stringify(body)})};
  }
  return {app,connect,dir,calls:()=>calls};
}
test('A27 A32 A36: 本机接口、无密钥保存、不泄露数据与跨站拒绝',async t=>{
  const f=await setup(t),client=await f.connect();assert.equal(client.hello.control,true);assert.equal(client.bootstrap.meta.configured,false);
  let response=await client.post('message',{channel:'group',text:'尚未配置时保存此需求',clientId:'unconfigured'});assert.equal(response.status,200);assert.equal((await response.json()).state.status,'paused');assert.equal(f.calls(),0);
  const disk=JSON.parse(await fs.readFile(path.join(f.dir,'project.json'),'utf8'));assert.ok(disk.messages.some(m=>m.clientId==='unconfigured'));
  for(const route of ['/workverse/server/index.mjs','/.git/config','/work/workverse-local/config.env','/outputs/workverse-data/project.json','/sw.js'])assert.equal((await fetch(f.app.origin+route)).status,404);
  response=await fetch(f.app.origin+'/api/message',{method:'POST',headers:{...client.headers,origin:'https://other-site.invalid'},body:'{}'});assert.equal(response.status,403);
  response=await fetch(f.app.origin+'/api/pause',{method:'POST',headers:{origin:f.app.origin,'content-type':'application/json'},body:'{}'});assert.equal(response.status,403);
  assert.equal((await fetch(f.app.origin+'/workverse/')).status,200);assert.equal((await fetch(f.app.origin+'/workverse/client/office.js')).status,200);
});
test('A24: 第二个页面只读，接管后旧页面失去操作权',async t=>{
  const {app,connect}=await setup(t),first=await connect(),second=await connect();assert.equal(second.hello.control,false);
  assert.equal((await second.post('message',{channel:'group',text:'未接管时不能写入'})).status,409);
  const changed=once(second.socket,'message');second.socket.send(JSON.stringify({type:'takeover'}));await changed;
  assert.equal((await first.post('draft',{channel:'pm',text:'旧页面'})).status,409);
  assert.equal((await second.post('draft',{channel:'pm',text:'新页面草稿'})).status,200);assert.equal(app.c.s.drafts.pm,'新页面草稿');
});
test('A19 A38: 协议失联在检测窗口内暂停，正常连接不断开',async t=>{
  const {app,connect}=await setup(t,{heartbeatMs:20,disconnectMs:70});const client=await connect({autoPong:false});
  await once(client.socket,'close');assert.equal(app.c.online,false);
  await app.c.queue;assert.equal(app.c.s.status,'paused');assert.ok(app.c.s.pauseReason.includes('失联'));
});
test('A25: 导出选中的历史版本，GET不依赖浏览器发送Origin',async t=>{
  const {app,connect}=await setup(t),client=await connect();app.c.s.versions=[{number:1,revision:1,at:new Date().toISOString(),markdown:'# 第一版\n\n旧版保持不变',summary:'第一版'},{number:2,revision:2,at:new Date().toISOString(),markdown:'# 第二版',summary:'第二版'}];await app.c.exclusive(()=>app.c.persist());
  const {origin,...headers}=client.headers;const response=await fetch(app.origin+'/api/export?version=1',{headers});assert.equal(response.status,200);assert.ok((await response.text()).includes('旧版保持不变'));assert.ok(response.headers.get('content-disposition').includes('v1'));
});
