import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('namespace bootstrap refuses production startup before admission checks exist',async()=>{
 const child=spawn(process.execPath,['--import','tsx','src/server/start-namespace-bootstrap.ts'],{env:{...process.env,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});child.stdout.resume();child.stderr.resume();
 const [code]=await once(child,'close') as [number|null];assert.equal(code,1);
});
