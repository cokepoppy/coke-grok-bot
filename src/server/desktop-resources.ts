import { createHash, createHmac } from 'node:crypto';
import type { Session } from './tenant-store.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface DesktopIdentity { namespace: string; ownerHash: string; workerToken: string; agentToken: string; controlToken: string }
export function desktopIdentity(session: Pick<Session,'tenantId'|'userId'>, signingKey: Buffer): DesktopIdentity {
  if (!uuid.test(session.tenantId) || !uuid.test(session.userId) || signingKey.length < 32) throw new Error('Invalid desktop identity');
  const subject = `${session.tenantId.toLowerCase()}:${session.userId.toLowerCase()}`;
  const ownerHash = createHash('sha256').update(subject).digest('hex').slice(0,32);
  const token = (role: string) => createHmac('sha256',signingKey).update(`coke-grok-desktop:${role}:${subject}`).digest('base64url');
  return { namespace:`grok-user-${ownerHash}`, ownerHash, workerToken:token('worker'), agentToken:token('agent'), controlToken:token('control') };
}

/** Resources are specific to one tenant/user pair. The caller must verify ownership on existing objects. */
export function desktopResources(identity: DesktopIdentity, options: { image: string; controlNamespace: string; gatewayCA: string; guarded?:boolean }): Record<string, unknown>[] {
  if (!/^grok-user-[a-f0-9]{32}$/.test(identity.namespace) || !/^[a-f0-9]{32}$/.test(identity.ownerHash) || identity.namespace !== `grok-user-${identity.ownerHash}` || !/^[A-Za-z0-9_-]{43}$/.test(identity.workerToken) || !/^[A-Za-z0-9_-]{43}$/.test(identity.agentToken) || !/^[A-Za-z0-9_-]{43}$/.test(identity.controlToken) || new Set([identity.workerToken,identity.agentToken,identity.controlToken]).size!==3) throw new Error('Invalid desktop identity');
  if (!/^coke-grok-desktop:sha-[a-f0-9]{40}$/.test(options.image) || !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(options.controlNamespace) || !options.gatewayCA.includes('BEGIN CERTIFICATE') || options.gatewayCA.length > 16384) throw new Error('Invalid desktop configuration');
  const ns = identity.namespace, labels = { 'app.kubernetes.io/managed-by':'coke-grok-bot', 'coke-grok-bot.io/owner-hash':identity.ownerHash };
  const meta = (name:string) => ({name,namespace:ns,labels});
  const security = (uid:number, readOnlyRootFilesystem:boolean) => ({runAsNonRoot:true,runAsUser:uid,runAsGroup:1000,allowPrivilegeEscalation:false,readOnlyRootFilesystem,capabilities:{drop:['ALL']}});
  const secretEnv = (name:string,key:string) => ({name,valueFrom:{secretKeyRef:{name:'desktop-runtime',key}}});
  return [
    { apiVersion:'v1',kind:'Namespace',metadata:{name:ns,labels} },
    { apiVersion:'v1',kind:'PersistentVolumeClaim',metadata:meta('workspace'),spec:{accessModes:['ReadWriteOnce'],resources:{requests:{storage:'10Gi'}}} },
    { apiVersion:'v1',kind:'Secret',metadata:meta('desktop-runtime'),type:'Opaque',stringData:{worker:identity.workerToken,agent:identity.agentToken,control:identity.controlToken} },
    { apiVersion:'v1',kind:'ConfigMap',metadata:meta('model-ca'),data:{'ca.pem':options.gatewayCA} },
    { apiVersion:'networking.k8s.io/v1',kind:'NetworkPolicy',metadata:meta('desktop-isolation'),spec:{
      podSelector:{matchLabels:{app:'grok-desktop'}},policyTypes:['Ingress','Egress'],
      ingress:[{from:[{namespaceSelector:{matchLabels:{'kubernetes.io/metadata.name':options.controlNamespace}}}],ports:[{protocol:'TCP',port:6080},{protocol:'TCP',port:8082},{protocol:'TCP',port:8083}]}],
      egress:[
        {to:[{namespaceSelector:{matchLabels:{'kubernetes.io/metadata.name':'kube-system'}}}],ports:[{protocol:'UDP',port:53},{protocol:'TCP',port:53}]},
        {to:[{namespaceSelector:{matchLabels:{'kubernetes.io/metadata.name':options.controlNamespace}},podSelector:{matchLabels:{app:'coke-grok-auth'}}}],ports:[{protocol:'TCP',port:3002}]},
        {to:[{ipBlock:{cidr:'0.0.0.0/0',except:['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','169.254.0.0/16','127.0.0.0/8']}}],ports:[{protocol:'TCP',port:80},{protocol:'TCP',port:443}]},
      ],
    } },
    { apiVersion:'apps/v1',kind:'Deployment',metadata:meta('desktop'),spec:{replicas:1,strategy:{type:'Recreate'},selector:{matchLabels:{app:'grok-desktop'}},template:{metadata:{labels:{...labels,app:'grok-desktop'}},spec:{
      automountServiceAccountToken:false,securityContext:{runAsNonRoot:true,fsGroup:1000,seccompProfile:{type:'RuntimeDefault'}},
      containers:[
        {name:'desktop',image:options.image,imagePullPolicy:'Never',
          env:[secretEnv('LINUX_DESKTOP_WORKER_TOKEN','worker'),secretEnv('DOTS_AGENT_RUNTIME_TOKEN','agent'),...(options.guarded?[secretEnv('COKE_GROK_CONTROL_TOKEN','control'),{name:'COKE_GROK_GUARDED_MODE',value:'1'}]:[]),{name:'COKE_DESKTOP_VNC_AUTH_MODE',value:'gateway'},{name:'COKE_DESKTOP_RESOLUTION',value:'1440x900'},{name:'COKE_DESKTOP_CHROME_NO_SANDBOX',value:'1'}],
          securityContext:security(1000,false),resources:{requests:{cpu:'200m',memory:'512Mi'},limits:{cpu:'2',memory:'2Gi'}},
          ports:[{name:'novnc',containerPort:6080},{name:'worker',containerPort:8082}],
          startupProbe:{httpGet:{path:'/healthz',port:8082},periodSeconds:5,timeoutSeconds:5,failureThreshold:36},
          readinessProbe:{httpGet:{path:'/readyz',port:8082},periodSeconds:5,timeoutSeconds:5,failureThreshold:2},
          volumeMounts:[{name:'workspace',mountPath:'/workspace'},{name:'shm',mountPath:'/dev/shm'},{name:'desktop-tmp',mountPath:'/tmp'}]},
        {name:'agent',image:options.image,imagePullPolicy:'Never',command:['/bin/sh','-c','umask 0002; mkdir -p /tmp/agent-home; exec node /opt/coke-grok/agent-runtime.mjs'],
          env:[secretEnv('LINUX_DESKTOP_WORKER_TOKEN','worker'),secretEnv('DOTS_AGENT_RUNTIME_TOKEN','agent'),{name:'HOME',value:'/tmp/agent-home'},{name:'NODE_EXTRA_CA_CERTS',value:'/run/model-ca/ca.pem'},
            {name:'DOTS_DESKTOP_AGENT_ADAPTERS',value:'pi'},{name:'DOTS_AGENT_KERNELS_JSON',value:JSON.stringify({pi:{command:'node',args:['/opt/coke-dots/grok-kernel-adapter.mjs']}})}],
          securityContext:security(1001,true),resources:{requests:{cpu:'50m',memory:'128Mi'},limits:{cpu:'1',memory:'1Gi'}},ports:[{name:'agent',containerPort:8083}],
          readinessProbe:{httpGet:{path:'/healthz',port:8083},periodSeconds:5,timeoutSeconds:2},
          volumeMounts:[{name:'workspace',mountPath:'/workspace'},{name:'agent-tmp',mountPath:'/tmp'},{name:'model-ca',mountPath:'/run/model-ca',readOnly:true}]},
      ],
      volumes:[{name:'workspace',persistentVolumeClaim:{claimName:'workspace'}},{name:'shm',emptyDir:{medium:'Memory',sizeLimit:'512Mi'}},{name:'desktop-tmp',emptyDir:{sizeLimit:'512Mi'}},{name:'agent-tmp',emptyDir:{sizeLimit:'512Mi'}},{name:'model-ca',configMap:{name:'model-ca'}}],
    }}}},
    { apiVersion:'v1',kind:'Service',metadata:meta('desktop'),spec:{type:'ClusterIP',selector:{app:'grok-desktop'},ports:[{name:'novnc',port:6080,targetPort:'novnc'},{name:'worker',port:8082,targetPort:'worker'},{name:'agent',port:8083,targetPort:'agent'}]} },
  ];
}
