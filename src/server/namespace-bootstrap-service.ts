import type {ServerOptions} from 'node:https';
import type {RunOwner} from './run-store.ts';
import {createOwnerRequestServer} from './owner-request-server.ts';

export interface NamespaceBootstrapConnection {ensure(owner:RunOwner,signal:AbortSignal):Promise<string>}
export function createNamespaceBootstrapService(tls:ServerOptions,token:string,bootstrap:NamespaceBootstrapConnection){
 return createOwnerRequestServer(tls,token,'/v1/personal-namespace',async(owner,signal)=>({namespace:await bootstrap.ensure(owner,signal)}));
}
