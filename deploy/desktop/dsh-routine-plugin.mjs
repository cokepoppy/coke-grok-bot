const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const name='coke-grok-bot-routines';
export const inject=['tools'];

export function apply(ctx) {
  const bridge=readBridge();
  if(!bridge)throw new Error('The mediated Bot routine bridge is not configured');
  ctx.tools.register({
    name:'bot_routines',
    description:'List this Bot’s routines, or create/edit a weekly or interval schedule when the user directly asks. Creating or editing schedules real future work.',
    parameters:{
      type:'object',
      properties:{
        action:{type:'string',enum:['list','create','edit']},
        routineId:{type:'string',minLength:36,maxLength:36},
        name:{type:'string',minLength:1,maxLength:80},
        instruction:{type:'string',minLength:1,maxLength:8000},
        timezone:{type:'string',minLength:1,maxLength:64},
        schedule:{oneOf:[
          {type:'object',properties:{kind:{const:'weekly'},weekday:{type:'integer',minimum:0,maximum:6},hour:{type:'integer',minimum:0,maximum:23},minute:{type:'integer',minimum:0,maximum:59}},required:['kind','weekday','hour','minute'],additionalProperties:false},
          {type:'object',properties:{kind:{const:'interval'},minutes:{type:'integer',minimum:5,maximum:10080}},required:['kind','minutes'],additionalProperties:false},
        ]},
      },required:['action'],additionalProperties:false,
    },
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(args,exec){
      if(exec.signal?.aborted)throw exec.signal.reason||new Error('Task was stopped');
      const isList=args.action==='list',isEdit=args.action==='edit';
      if(!['list','create','edit'].includes(args.action)||!isList&&(!args.name?.trim()||!args.instruction?.trim()||!args.timezone||!validSchedule(args.schedule)||isEdit&&!uuid.test(args.routineId||'')))throw new Error('Bot routine request is incomplete');
      const response=await fetch(`${bridge.url}/bot-routines${isEdit?`/${encodeURIComponent(args.routineId)}`:''}`,{
        method:isList?'GET':isEdit?'PATCH':'POST',
        headers:{authorization:`Bearer ${bridge.token}`,...(!isList?{'content-type':'application/json'}:{})},
        ...(!isList?{body:JSON.stringify({name:args.name,instruction:args.instruction,timezone:args.timezone,schedule:args.schedule})}:{}),
        signal:exec.signal,redirect:'error',
      });
      const value=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(typeof value?.error==='string'?value.error:'Bot routine operation failed');
      return value;
    },
  });
}

function validSchedule(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  if(value.kind==='weekly')return Number.isInteger(value.weekday)&&value.weekday>=0&&value.weekday<=6&&Number.isInteger(value.hour)&&value.hour>=0&&value.hour<=23&&Number.isInteger(value.minute)&&value.minute>=0&&value.minute<=59&&Object.keys(value).length===4;
  if(value.kind==='interval')return Number.isInteger(value.minutes)&&value.minutes>=5&&value.minutes<=10080&&Object.keys(value).length===2;
  return false;
}

function readBridge(){
  const raw=process.env.COKE_GROK_ROUTINE_BRIDGE_URL,token=process.env.COKE_GROK_ROUTINE_BRIDGE_TOKEN;
  if(typeof raw!=='string'||typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  let url;try{url=new URL(raw)}catch{return null}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/v1'))return null;
  return{url:url.href.replace(/\/$/,''),token};
}
