const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const name='coke-grok-bot-handoff';
export const inject=['tools'];

export function apply(ctx) {
  const bridge=readBridge();
  if(!bridge)throw new Error('The mediated Bot handoff bridge is not configured');
  const nameAddress=bot=>`${bot.name}${bot.label?` (${bot.label})`:''}`;
  const address=bot=>`${nameAddress(bot)} [Bot ID ${bot.id}]`;
  ctx.tools.register({
    name:'bot_handoff',
    description:`Send a private asynchronous task to another Bot owned by this same user. Available Bots include stable IDs; use targetBotId when selecting a Bot, especially when names overlap: ${bridge.bots.map(address).join(', ')}. The recipient works on its own Pi/DSH run queue and replies later.`,
    parameters:{type:'object',properties:{targetBotId:{type:'string',pattern:uuid.source},targetBotName:{type:'string',minLength:1,maxLength:200},message:{type:'string',minLength:1,maxLength:4000}},required:['message'],additionalProperties:false},
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(args,exec){
      if(exec.signal?.aborted)throw exec.signal.reason||new Error('Task was stopped');
      const hasId=typeof args.targetBotId==='string'&&args.targetBotId.length>0;
      const hasName=typeof args.targetBotName==='string'&&args.targetBotName.trim().length>0;
      if(hasId===hasName||typeof args.message!=='string'||!args.message.trim()||args.message.length>4000)throw new Error('Bot handoff target or message is invalid');
      let target;
      if(hasId)target=bridge.bots.find(bot=>bot.id===args.targetBotId);
      else{
        const requested=args.targetBotName.trim().toLocaleLowerCase();
        const matches=bridge.bots.filter(bot=>nameAddress(bot).toLocaleLowerCase()===requested||bot.name.toLocaleLowerCase()===requested);
        if(matches.length>1)throw new Error('Bot handoff target name is ambiguous');
        target=matches[0];
      }
      if(!target)throw new Error('Bot handoff target or message is invalid');
      const response=await fetch(`${bridge.url}/bot-handoffs`,{
        method:'POST',headers:{authorization:`Bearer ${bridge.token}`,'content-type':'application/json'},
        body:JSON.stringify({targetBotId:target.id,message:args.message}),signal:exec.signal,redirect:'error',
      });
      const value=await response.json().catch(()=>null);
      if(!response.ok||response.status!==202||!value?.handoff?.targetRunId)throw new Error('Bot handoff could not be queued');
      return{status:'queued',target:target.name,targetRunId:value.handoff.targetRunId,message:'The private reply will arrive asynchronously; this is not a completed result.'};
    },
  });
}

function readBridge(){
  const raw=process.env.COKE_GROK_HANDOFF_BRIDGE_URL,token=process.env.COKE_GROK_HANDOFF_BRIDGE_TOKEN,botsRaw=process.env.COKE_GROK_HANDOFF_BOTS;
  if(typeof raw!=='string'||typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||typeof botsRaw!=='string'||botsRaw.length>32_000)return null;
  let url,bots;try{url=new URL(raw);bots=JSON.parse(botsRaw)}catch{return null}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/v1')||!Array.isArray(bots)||bots.length>100)return null;
  const ids=new Set();
  for(const bot of bots){
    if(!bot||typeof bot!=='object'||!uuid.test(String(bot.id||''))||typeof bot.name!=='string'||!bot.name.trim()||bot.name.length>120||typeof bot.label!=='string'||bot.label.length>120||ids.has(bot.id))return null;
    ids.add(bot.id);
  }
  return{url:url.href.replace(/\/$/,''),token,bots};
}
