import { promises as fs } from 'node:fs';

export class CallError extends Error {
  constructor(message,{retryable=false,status=0}={}) { super(message); this.retryable=retryable; this.status=status; }
}
export async function readKey(file) {
  try {
    const text=await fs.readFile(file,'utf8');
    const value=text.split(/\r?\n/).find(l=>/^\s*DEEPSEEK_API_KEY\s*=/.test(l))?.split('=').slice(1).join('=').trim().replace(/^(['"])(.*)\1$/,'$2');
    return value && !value.startsWith('请填写') ? value : '';
  } catch(e) { if(e.code==='ENOENT')return ''; throw e; }
}
export class DeepSeek {
  constructor({keyFile, fetchImpl=fetch, timeout=120000}={}) { this.keyFile=keyFile; this.fetch=fetchImpl; this.timeout=timeout; }
  async configured() { return Boolean(await readKey(this.keyFile)); }
  async complete({messages,generating,signal}) {
    const key=await readKey(this.keyFile);
    if(!key) throw new CallError('尚未配置 DeepSeek 密钥，请在本机配置文件填写。');
    const body={model:'deepseek-flash',messages,stream:false,thinking:{type:'disabled'},temperature:0.3,max_tokens:generating?8192:4096,response_format:{type:'json_object'}};
    const serialized=JSON.stringify(body);
    if(Buffer.byteLength(serialized)>1048576) throw new CallError('上下文超过 1 MiB，请整理需求后继续；关键决定未被删除。');
    let response;
    try {
      response=await this.fetch('https://api.deepseek.com/chat/completions',{
        method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:serialized,
        signal:AbortSignal.any([signal,AbortSignal.timeout(this.timeout)])});
      const content=await response.text();
      if(!response.ok) {
        const labels={400:'请求格式不兼容',401:'密钥无效，请修改本机配置',402:'DeepSeek 余额不足，请充值',422:'模型参数不兼容',429:'调用受限',500:'DeepSeek 服务异常',503:'DeepSeek 暂时繁忙'};
        const error=new CallError(labels[response.status]||`模型调用失败（${response.status}）`,{retryable:[429,500,503].includes(response.status),status:response.status});
        const retry=response.headers.get('retry-after');
        if(retry) error.retryAfter=/^\d+$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry)-Date.now());
        throw error;
      }
      let envelope;
      try { envelope=JSON.parse(content); } catch { throw new CallError('模型返回了无法解析的响应',{retryable:true}); }
      const choice=envelope.choices?.[0], raw=choice?.message?.content;
      if(typeof raw!=='string'||!raw.trim()) throw new CallError('模型返回空内容',{retryable:true});
      let parsed;
      try { parsed=JSON.parse(raw); } catch { return {raw,invalid:'工作结果不是完整 JSON',usage:envelope.usage}; }
      return {data:parsed,raw,invalid:choice.finish_reason==='length'?'输出被截断，不能作为完整文档':null,usage:envelope.usage};
    } catch(e) {
      if(signal.aborted) throw signal.reason||new Error('工作已取消');
      if(e instanceof CallError) throw e;
      throw new CallError(e.name==='TimeoutError'?'等待超过 120 秒，已停止本地等待':'网络连接失败',{retryable:true});
    }
  }
}
