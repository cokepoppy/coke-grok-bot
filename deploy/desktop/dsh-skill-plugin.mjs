const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const name='coke-grok-bot-skills';
export const inject=['tools'];

export function apply(ctx){
  const bridge=readBridge();
  if(!bridge)throw new Error('The mediated Bot Skill bridge is not configured');
  ctx.tools.register({
    name:'bot_skills',
    description:'List enabled Skills for this Bot, including read-only team-published Skills, or create, edit, or delete an owner-private or Bot-only Skill only when the user directly asks. Team publishing and sync are managed in Connect apps.',
    parameters:{
      type:'object',
      properties:{
        action:{type:'string',enum:bridge.actions},
        id:{type:'string',pattern:uuid.source},
        name:{type:'string',minLength:1,maxLength:120},
        description:{type:'string',minLength:1,maxLength:1000},
        instructions:{type:'string',minLength:1,maxLength:12000},
        visibility:{type:'string',enum:['private','bot']},
      },required:['action'],additionalProperties:false,
    },
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(args,exec){
      if(exec.signal?.aborted)throw exec.signal.reason||new Error('Task was stopped');
      validateArgs(args,bridge.actions);
      const isList=args.action==='list',isDelete=args.action==='delete',isUpdate=args.action==='update';
      const response=await fetch(`${bridge.url}/bot-skills${isUpdate||isDelete?`/${encodeURIComponent(args.id)}`:''}`,{
        method:isList?'GET':isDelete?'DELETE':isUpdate?'PATCH':'POST',
        headers:{authorization:`Bearer ${bridge.token}`,...(!isList&&!isDelete?{'content-type':'application/json'}:{})},
        ...(!isList&&!isDelete?{body:JSON.stringify({action:args.action,skill:{name:args.name,description:args.description,instructions:args.instructions,...(args.visibility?{visibility:args.visibility}:{})}})}:{}),
        signal:exec.signal,redirect:'error',
      });
      const value=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(typeof value?.error==='string'?value.error:'Bot Skill operation failed');
      return value;
    },
  });
}

function validateArgs(args,actions){
  if(!args||typeof args!=='object'||Array.isArray(args)||!bridgeAction(args.action,actions))throw new Error('Bot Skill action is unavailable');
  const allowed=args.action==='list'?['action']:args.action==='delete'?['action','id']:args.action==='update'?['action','id','name','description','instructions','visibility']:['action','name','description','instructions','visibility'];
  if(Object.keys(args).some(key=>!allowed.includes(key)))throw new Error('Bot Skill request contains unsupported fields');
  if((args.action==='delete'||args.action==='update')&&!uuid.test(args.id||''))throw new Error('Bot Skill id is invalid');
  if(args.action==='create'||args.action==='update'){
    if(typeof args.name!=='string'||!args.name.trim()||args.name.length>120||typeof args.description!=='string'||!args.description.trim()||args.description.length>1000||typeof args.instructions!=='string'||!args.instructions.trim()||args.instructions.length>12000)throw new Error('Bot Skill request is incomplete');
    if(args.visibility!==undefined&&!['private','bot'].includes(args.visibility))throw new Error('Bot Skill visibility is invalid');
  }
}

function bridgeAction(action,actions){return actions.includes(action)&&['list','create','update','delete'].includes(action)}

function readBridge(){
  const raw=process.env.COKE_GROK_SKILL_BRIDGE_URL,token=process.env.COKE_GROK_SKILL_BRIDGE_TOKEN;
  let actions;try{actions=JSON.parse(process.env.COKE_GROK_SKILL_ACTIONS||'[]')}catch{return null}
  const allowed=['list','create','update','delete'];
  if(typeof raw!=='string'||typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||!Array.isArray(actions)||!actions.length||actions.length>allowed.length||new Set(actions).size!==actions.length||actions.some(action=>!allowed.includes(action)))return null;
  let url;try{url=new URL(raw)}catch{return null}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/v1'))return null;
  return{url:url.href.replace(/\/$/,''),token,actions};
}
