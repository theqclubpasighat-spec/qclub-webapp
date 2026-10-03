import { SecurityError, bearer, revokeSession, authenticate, privateLogin, publicContent, rehearsalConfig, requestAddress, rotateCredential, saveContent, tokenHash } from './foundation.js';
import { cancelStaffShift, clockStaffAttendance, createStaffExpense, createStaffShift, staffOpsSnapshot, voidStaffExpense } from './staff-operations.js';

export function createSecurityHandler({ env, createDatabase }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, value) => res.status(status).json(value);
    try {
      const config = rehearsalConfig(env);
      // No wildcard CORS or cookie-based authority. Mutations require bearer tokens.
      if (req.headers?.['sec-fetch-site'] === 'cross-site') throw new SecurityError(403, 'CROSS_SITE_REQUEST');
      const action = req.query?.action;
      const method = req.method;
      const routes = {
        content: ['GET', 'PATCH'], session: ['GET'], login: ['POST'], logout: ['POST'], rotate: ['POST'],
        'staff-ops': ['GET'], 'staff-shift': ['POST'], 'staff-attendance': ['POST'], 'staff-expense': ['POST'],
      };
      if (!Object.hasOwn(routes, action)) throw new SecurityError(404, 'NOT_FOUND');
      if (!routes[action].includes(method)) throw new SecurityError(405, 'METHOD_NOT_ALLOWED');
      const db = createDatabase(config);
      const actorTokenHash = () => tokenHash(bearer(req));
      if (action === 'staff-ops') {
        await authenticate(db, req, ['ADMIN','STAFF']);
        return reply(200, await staffOpsSnapshot(db, actorTokenHash()));
      }
      if (action === 'staff-shift') {
        await authenticate(db, req, ['ADMIN']);
        const command = String(req.body?.command || '').toUpperCase();
        if (command === 'CREATE') return reply(200, await createStaffShift(db, actorTokenHash(), req.body));
        if (command === 'CANCEL') return reply(200, await cancelStaffShift(db, actorTokenHash(), req.body));
        throw new SecurityError(400, 'INVALID_SHIFT_COMMAND');
      }
      if (action === 'staff-attendance') {
        await authenticate(db, req, ['STAFF']);
        return reply(200, await clockStaffAttendance(db, actorTokenHash(), req.body));
      }
      if (action === 'staff-expense') {
        const command = String(req.body?.command || '').toUpperCase();
        if (command === 'CREATE') {
          await authenticate(db, req, ['ADMIN','STAFF']);
          return reply(200, await createStaffExpense(db, actorTokenHash(), req.body));
        }
        if (command === 'VOID') {
          await authenticate(db, req, ['ADMIN']);
          return reply(200, await voidStaffExpense(db, actorTokenHash(), req.body));
        }
        throw new SecurityError(400, 'INVALID_EXPENSE_COMMAND');
      }
      if (action === 'logout') return reply(200, await revokeSession(db, req));
      if (action === 'rotate') return reply(200, await rotateCredential(db, req));
      if (action === 'login') return reply(200, await privateLogin(db, req, new Date(), requestAddress(req, env)));
      if (action === 'session') {
        const actor = await authenticate(db, req);
        return reply(200, { role: actor.role, staff_id: actor.staff_id, display_name: actor.display_name, expires_at: actor.expires_at });
      }
      if (method === 'PATCH') {
        const actor = await authenticate(db, req, ['ADMIN']);
        return reply(200, await saveContent(db, actor, req.body));
      }
      const { data, error } = await db.from('qclub_state').select('state,updated_at').eq('key', 'main').single();
      if (error || !data) throw new SecurityError(503, 'STATE_UNAVAILABLE');
      return reply(200, { content: publicContent(data.state), updatedAt: data.updated_at });
    } catch (error) {
      // Never return database text, hashes, PINs, access tokens or request payloads.
      return reply(error instanceof SecurityError ? error.status : 503, { ok: false, error: error instanceof SecurityError ? error.code : 'SECURITY_UNAVAILABLE' });
    }
  };
}
