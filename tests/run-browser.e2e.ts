import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID,createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { chromium } from 'playwright-core';
import { TenantStore } from '../src/server/tenant-store.ts';
import { BotStore } from '../src/server/bot-store.ts';
import { RunStore } from '../src/server/run-store.ts';
import { RunScheduler } from '../src/server/run-scheduler.ts';
import { GoogleAuthService,type IdentityProvider } from '../src/server/google-auth.ts';
import { createAuthServer } from '../src/server/auth-http.ts';
const mysqlPort=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!mysqlPort)throw new Error('Disposable MySQL port required');
async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=(s.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>s.close(()=>resolve()));return p}
const frontPort=await freePort(),backPort=await freePort(),identityPort=await freePort(),origin=`http://127.0.0.1:${frontPort}`,base='/grok-bot/',publicUrl=origin+base;
const database=`grok_run_ui_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port:mysqlPort,user:'root'});await admin.query(`CREATE DATABASE \`${database}\``);
const pool=mysql.createPool({host:'127.0.0.1',port:mysqlPort,user:'root',database,timezone:'Z'}),store=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool);await store.migrate();await bots.migrate();await runs.migrate();
const flows=new Map<string,{nonce:string;challenge:string}>();let state='',identity='alice';
const provider:IdentityProvider={authorizationUrl(s,nonce,challenge){flows.set(s,{nonce,challenge});return `http://127.0.0.1:${identityPort}/?state=${s}`},async exchange(code,verifier){const f=flows.get(state)!;assert.equal(createHash('sha256').update(verifier).digest('base64url'),f.challenge);return {sub:code,email:`${code}@example.test`,email_verified:true,name:code,nonce:f.nonce}}};
const identityServer=createHttpServer((req,res)=>{state=new URL(req.url||'/',`http://127.0.0.1:${identityPort}`).searchParams.get('state')!;res.writeHead(302,{Location:`${publicUrl}auth/google/callback?state=${state}&code=${identity}`});res.end()});identityServer.listen(identityPort,'127.0.0.1');await once(identityServer,'listening');
const backend=createAuthServer(new GoogleAuthService(store,provider,publicUrl),publicUrl,undefined,bots,runs);backend.listen(backPort,'127.0.0.1');await once(backend,'listening');
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(frontPort),'--strictPort'],{env:{...process.env,VITE_REQUIRE_AUTH:'true',VITE_BASE_PATH:base,VITE_AUTH_PROXY_TARGET:`http://127.0.0.1:${backPort}`},stdio:'ignore'});
let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let executions=0;
const scheduler=new RunScheduler(runs,{execute:async (_owner,run)=>{executions++;await gate;return {status:'completed',result:`Done: ${run.prompt}`}}},{concurrency:2,leaseSeconds:30});
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch(publicUrl)).ok)break}catch{}if(i===99)throw new Error('Vite did not start');await new Promise(resolve=>setTimeout(resolve,100))}
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(8000);
 await page.goto(publicUrl);await page.getByRole('link',{name:'Continue with Google'}).click();await page.getByRole('button',{name:'Create new Bot'}).click();
 const field=page.getByLabel('Message New Bot');await field.fill('Test queued task');await page.getByRole('button',{name:'Send task'}).click();
 await page.getByText('Queued · waiting for your computer').waitFor();await scheduler.tick();await page.getByText('Working on your computer').waitFor();
 release();await page.getByText('Done: Test queued task').waitFor();await page.reload();await page.getByText('Done: Test queued task').waitFor();assert.equal(executions,1);
 let posts=0;await page.route('**/api/bots/*/runs',async route=>{if(route.request().method()!=='POST')return route.continue();posts++;await route.fetch();await route.fulfill({status:503,body:'{}'})});
 await page.getByLabel('Message New Bot').fill('Uncertain submission');await page.getByRole('button',{name:'Send task'}).click();await page.getByText('Submission could not be confirmed. Refresh and check the history before trying again.').waitFor();
 assert.equal(posts,1);assert.equal(await page.getByLabel('Message New Bot').isDisabled(),true);await page.unroute('**/api/bots/*/runs');await page.reload();await page.getByText('Uncertain submission').waitFor();assert.equal(posts,1);
 identity='bob';await page.goto(`${publicUrl}api/auth/google/start`);await page.getByRole('button',{name:'Sign out'}).waitFor();assert.equal(await page.getByText('Test queued task').count(),0);
 await context.close();console.log('Browser run UI passed with simulated identity and executor: queued, running, completed, refresh, ambiguous submission and account isolation.');
}finally{release();await scheduler.stop();if(browser)await browser.close();vite.kill('SIGTERM');await new Promise<void>(resolve=>backend.close(()=>resolve()));await new Promise<void>(resolve=>identityServer.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE \`${database}\``);await admin.end()}
