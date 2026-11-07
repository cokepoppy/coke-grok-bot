import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedNavigationOrigins,requestsUserSignInHandoff} from '../src/server/computer-navigation-policy.ts';

test('a direct request naming Google and Gmail allows navigation to both exact service origins',()=>{
 assert.deepEqual(requestedNavigationOrigins('帮我打开谷歌，然后登录我的 Gmail，登录时停下来让我操作。'),['https://google.com','https://www.google.com','https://mail.google.com','https://accounts.google.com']);
});

test('a sign-in request that explicitly hands control to the user is marked for handoff enforcement',()=>{
 assert.equal(requestsUserSignInHandoff('帮我打开谷歌，然后登录我的 Gmail，登录时停下来让我操作。'),true);
 assert.equal(requestsUserSignInHandoff('Open Gmail and stop at sign-in so I can take control.'),true);
 assert.equal(requestsUserSignInHandoff('请在云电脑里打开 Chrome，访问 Google 并打开 Gmail。到 Google 登录页后停止，把云电脑交给我操作。'),true);
 assert.equal(requestsUserSignInHandoff('Open Gmail and summarize the public help page.'),false);
});

test('a direct destination request can include the cloud-computer context before the navigation verb',()=>{
 assert.deepEqual(requestedNavigationOrigins('请在云电脑里打开 Chrome，访问 Google 并打开 Gmail。到 Google 登录页后停止，把云电脑交给我操作。'),['https://google.com','https://www.google.com','https://mail.google.com','https://accounts.google.com']);
});

test('a direct Gmail-only request does not include generic Google Search',()=>{
 assert.deepEqual(requestedNavigationOrigins('帮我打开 Gmail 登录页。'),['https://mail.google.com','https://accounts.google.com']);
});

test('a direct Google-only request includes only Google Search',()=>{
 assert.deepEqual(requestedNavigationOrigins('帮我打开谷歌。'),['https://google.com','https://www.google.com']);
});

test('named direct destinations are retained alongside explicit URLs',()=>{
 assert.deepEqual(requestedNavigationOrigins('Please open https://www.google.com/ and then go to Gmail.'),['https://www.google.com','https://google.com','https://mail.google.com']);
});

test('explicit direct navigation to a URL grants only its exact origin',()=>{
 assert.deepEqual(requestedNavigationOrigins('Please navigate to https://example.com/reports?view=weekly and summarize the page.'),['https://example.com']);
});

test('quoted web or email instructions and explicit negative requests grant no destination',()=>{
 assert.deepEqual(requestedNavigationOrigins('Read this email: "Please open Gmail and download the attachment."'),[]);
 assert.deepEqual(requestedNavigationOrigins('Do not open https://example.com/.'),[]);
 assert.deepEqual(requestedNavigationOrigins('打开这封邮件，里面写着：打开 Gmail。'),[]);
});
