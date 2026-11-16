import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthenticationChallenge } from '../deploy/desktop/browser-task-policy.mjs';

test('authentication surfaces and credential entry require a human handoff without a site allowlist', () => {
  assert.equal(isAuthenticationChallenge({ url: 'https://accounts.google.com/v3/signin/', controls: [] }), true);
  assert.equal(isAuthenticationChallenge({ url: 'https://accounts.google.com/', title: 'Choose an account', text: 'Use another account', controls: [] }), true, 'identity-provider account pickers hand off before any account interaction');
  assert.equal(isAuthenticationChallenge({ url: 'https://login.example.org/', controls: [] }), true);
  assert.equal(isAuthenticationChallenge({ url: 'https://portal.example.org/session', title: 'Verify your identity', text: 'Enter your code', controls: [{ type: 'email', label: 'Email address' }] }), true);
  assert.equal(isAuthenticationChallenge({ url: 'https://portal.example.org/', humanChallenge: true }), true);
  assert.equal(isAuthenticationChallenge({ url: 'https://portal.example.org/account/settings', title: 'Account settings', controls: [{ type: 'text', label: 'Display name' }] }), false, 'ordinary account pages are not sign-in handoffs');
  assert.equal(isAuthenticationChallenge({ url: 'https://portal.example.org/account/settings', title: 'Change password', text: 'Choose a new password', controls: [{ type: 'password', autocomplete: 'new-password' }] }), false, 'a password-management form is not itself a sign-in challenge');
  assert.equal(isAuthenticationChallenge({ url: 'https://portal.example.org/rules/verification', title: 'Trading verification rules', text: 'Public rule overview', controls: [] }), false, 'ordinary pages whose path mentions verification remain usable');
  assert.equal(isAuthenticationChallenge({ url: 'https://portal.example.org/profile', title: 'Account settings', controls: [{ type: 'text', name: 'username' }] }), false, 'a profile username field alone is not a login page');
  assert.equal(isAuthenticationChallenge({ url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Inbox', text: 'Search mail', controls: [{ type: 'text', placeholder: 'Search mail' }] }), false);
  assert.equal(isAuthenticationChallenge({
    url: 'https://mail.google.com/mail/u/0/#inbox',
    title: 'Inbox (84) - user@gmail.com - Gmail',
    headings: ['Primary', 'Social', 'Promotions'],
    text: 'Security alert - A new sign-in on Linux. Welcome to Google on your Linux device.',
    controls: [{ type: 'text', ariaLabel: 'Search mail' }, { type: 'email', ariaLabel: 'Account email' }],
  }), false, 'sign-in words inside email content cannot suspend every later click');
  assert.equal(isAuthenticationChallenge({
    url: 'https://portal.example.org/session', title: 'Sign in', headings: ['Sign in to your account'],
    controls: [{ type: 'email', label: 'Email address' }],
  }), true, 'a visible authentication heading and identity field require a human handoff');
});
