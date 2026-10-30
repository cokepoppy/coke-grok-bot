import type {ServerOptions} from 'node:https';
import type {DesktopConnections} from './pi-executor.ts';
import {createOwnerRequestServer} from './owner-request-server.ts';

/** Private service: it accepts only an owner identity, never Kubernetes objects or resource paths. */
export function createDesktopProvisioningBroker(tls:ServerOptions,token:string,desktops:DesktopConnections) {
 return createOwnerRequestServer(tls,token,'/v1/personal-computer',async(owner,signal)=>{
  const result=await desktops.connect(owner,signal);return {agentUrl:result.agentUrl.href,agentToken:result.agentToken};
 });
}
