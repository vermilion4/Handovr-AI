import { getToken } from './client.mts';

const { scopes } = await getToken();
console.log('Token issued. Scopes:');
for (const scope of scopes.sort()) console.log('  ' + scope);
