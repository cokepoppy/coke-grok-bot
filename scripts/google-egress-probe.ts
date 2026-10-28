import { OAuth2Client } from 'google-auth-library';
const proxy = process.env.COKE_GROK_GOOGLE_OAUTH_PROXY_URL;
if (!proxy) throw new Error('Set a credential-free OAuth proxy origin for this probe.');
const client = new OAuth2Client({ transporterOptions: { proxy, timeout: 15000 } });
client.getFederatedSignonCerts().then(result => {
  const count = Object.keys(result.certs).length;
  if (!count) throw new Error('Google returned no signing certificates');
  console.log(`Google signing certificate retrieval succeeded (${count} certificates).`);
}).catch(() => { console.error('Google signing certificate retrieval failed.'); process.exitCode = 1; });
