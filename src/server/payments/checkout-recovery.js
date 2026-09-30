import { tokenHash } from '../security/foundation.js';
import { SecurityError } from '../security/errors.js';

export async function closeUnusedCheckout(db, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['checkoutId', 'receiptToken'].includes(key)) ||
      typeof body.checkoutId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.checkoutId) ||
      typeof body.receiptToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.receiptToken)) {
    throw new SecurityError(400, 'INVALID_CHECKOUT');
  }
  const orderId = `qcr_${body.checkoutId}`;
  const { data, error } = await db.rpc('qclub_close_unused_checkout', {
    p_order_id: orderId, p_receipt_hash: tokenHash(body.receiptToken),
  });
  if (error) throw new SecurityError(503, 'CHECKOUT_UNAVAILABLE');
  if (!data?.ok) throw new SecurityError(409, 'CHECKOUT_CONFLICT');
  if (!['closed', 'existing'].includes(data.state)) throw new SecurityError(503, 'CHECKOUT_UNAVAILABLE');
  return { ok: true, orderId, state: data.state };
}
