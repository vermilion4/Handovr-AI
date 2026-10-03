import { paypal } from './client.mts';
const [captureId, batchId] = process.argv.slice(2);
const capture = await paypal('GET', `/v2/payments/captures/${captureId}`);
console.log('capture', capture.status, JSON.stringify(capture.body.seller_receivable_breakdown), capture.body.status);
const payout = await paypal('GET', `/v1/payments/payouts/${batchId}`);
const item = payout.body.items?.[0];
console.log('payout', payout.body.batch_header?.batch_status, item?.transaction_status, JSON.stringify({ amount: item?.payout_item?.amount, fee: item?.payout_item_fee, receiver: item?.payout_item?.receiver?.replace(/^(.{3}).*@/, '$1…@') }));
