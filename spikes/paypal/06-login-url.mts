const authorize = new URL('https://www.sandbox.paypal.com/signin/authorize');
authorize.search = new URLSearchParams({
  flowEntry: 'static',
  client_id: process.env.PAYPAL_CLIENT_ID!,
  response_type: 'code',
  scope: 'openid profile email https://uri.paypal.com/services/paypalattributes',
  redirect_uri: 'http://127.0.0.1:3000/api/auth/paypal/callback',
}).toString();
console.log(authorize.toString());
