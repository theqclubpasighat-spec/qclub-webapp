// All legacy payment writers share exact-revision compare-and-swap. A retry
// re-runs the operation against fresh state; it never replays a stale snapshot.
export async function mutateLegacyState(db, mutate, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const read = await db.from('qclub_state').select('state,updated_at').eq('key', 'main').single();
    if (read.error || !read.data) throw Object.assign(new Error('STATE_UNAVAILABLE'), {status:503});
    const state = structuredClone(read.data.state);
    const value = await mutate(state);
    const updated_at = new Date(Math.max(Date.now(), Date.parse(read.data.updated_at) + 1)).toISOString();
    const saved = await db.from('qclub_state').update({state, updated_at}).eq('key','main').eq('updated_at',read.data.updated_at).select('updated_at').maybeSingle();
    if (saved.error) throw Object.assign(new Error('STATE_UNAVAILABLE'), {status:503});
    if (saved.data) return {state, value, updatedAt:saved.data.updated_at};
  }
  throw Object.assign(new Error('STATE_CONFLICT'), {status:409});
}

export async function patchLegacyOrder(db, orderId, patch) {
  return mutateLegacyState(db, state => {
    const record = (state.paymentOrders || []).find(row => row.order_id === orderId);
    if (!record) throw Object.assign(new Error('ORDER_NOT_FOUND'), {status:404});
    Object.assign(record, typeof patch === 'function' ? patch(record, state) : patch);
    return record;
  });
}
