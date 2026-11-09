import test from 'node:test';
import assert from 'node:assert/strict';
import { browserActionRequiresApproval, isAuthenticationChallenge, isCredentialEntry } from '../deploy/desktop/browser-task-policy.mjs';

test('authentication surfaces require a human handoff without a site allowlist', () => {
  assert.equal(isAuthenticationChallenge({ url: 'https://accounts.google.com/v3/signin/', controls: [] }), true);
  assert.equal(isAuthenticationChallenge({ url: 'https://login.example.org/', controls: [] }), true);
  assert.equal(isAuthenticationChallenge({ url: 'https://portal.example.org/session', title: 'Verify your identity', text: 'Enter your code', controls: [{ type: 'email', label: 'Email address' }] }), true);
  assert.equal(isAuthenticationChallenge({ url: 'https://portal.example.org/', humanChallenge: true }), true);
  assert.equal(isAuthenticationChallenge({ url: 'https://portal.example.org/account/settings', title: 'Account settings', controls: [{ type: 'text', label: 'Display name' }] }), false, 'ordinary account pages are not sign-in handoffs');
  assert.equal(isAuthenticationChallenge({ url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Inbox', text: 'Search mail', controls: [{ type: 'text', placeholder: 'Search mail' }] }), false);
  assert.equal(isCredentialEntry({ input: { target: 'Password' }, control: { type: 'password' } }), true);
  assert.equal(isCredentialEntry({ input: { target: 'Search mail' }, control: { type: 'text', placeholder: 'Search mail' } }), false);
  assert.equal(isCredentialEntry({ input: { target: 'Email address' }, control: { type: 'email', autocomplete: 'email' } }), false, 'ordinary contact fields remain usable outside an authentication surface');
});

test('routine browser interactions are generic across sites while consequential controls stay approval-gated', () => {
  assert.equal(browserActionRequiresApproval({ action: 'fill', input: { target: 'Search mail', value: 'is:unread' }, control: { type: 'search' } }), false);
  assert.equal(browserActionRequiresApproval({ action: 'press', input: { target: 'Search mail', key: 'Enter' }, control: { type: 'search' } }), false);
  assert.equal(browserActionRequiresApproval({ action: 'click', input: { target: 'Search', role: 'button' }, control: { type: 'submit', text: 'Search' } }), false, 'generic search form submission is routine');
  assert.equal(browserActionRequiresApproval({ action: 'click', input: { target: '提交搜索', role: 'button' }, control: { type: 'submit', text: '提交搜索' } }), false, 'Chinese search form submission is routine');
  assert.equal(browserActionRequiresApproval({ action: 'click', input: { target: 'Inbox update', role: 'link' }, control: { type: 'a', href: '/mail/u/0/#inbox' } }), false);
  assert.equal(browserActionRequiresApproval({ action: 'click', input: { target: 'Reply', role: 'button' }, control: { type: 'button' } }), false);
  for (const target of ['Send', 'Delete', 'Archive', 'Purchase', 'Publish', 'Submit payment']) {
    assert.equal(browserActionRequiresApproval({ action: 'click', input: { target, role: 'button' }, control: { type: 'button' } }), true, `${target} remains gated`);
  }
  assert.equal(browserActionRequiresApproval({ action: 'click', input: { target: 'Continue', role: 'button' }, control: { type: 'submit' } }), false, 'ordinary form submission does not need a per-step approval');
  assert.equal(browserActionRequiresApproval({ action: 'click', input: { target: 'Submit', role: 'button' }, control: { type: 'submit' } }), false, 'generic submit controls are not a site-specific allowlist');
  assert.equal(browserActionRequiresApproval({ action: 'press', input: { target: 'Message Body', key: 'Enter' }, control: { type: 'textarea' } }), false, 'ordinary keyboard interaction does not need a per-step approval');
});
