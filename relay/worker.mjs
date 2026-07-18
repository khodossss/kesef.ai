// Zero-knowledge family relay. Stores only: room:<hid>:verifier and
// room:<hid>:member:<mid> = sealed blob. Cannot decrypt anything.
const MAX_BLOB = 5 * 1024 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      const p = url.pathname.split('/').filter(Boolean); // rooms, hid, members, mid

      if (req.method === 'POST' && p[0] === 'rooms' && p.length === 1) {
        const { household_id, verifier } = await req.json();
        if (!household_id || !verifier) return json({ error: 'bad_request' }, 400);
        const key = `room:${household_id}:verifier`;
        const existing = await env.ROOMS.get(key);
        if (existing && !safeEqual(existing, verifier)) return json({ error: 'conflict' }, 409);
        if (!existing) await env.ROOMS.put(key, verifier);
        return json({ ok: true });
      }

      const hid = p[1];
      if (!hid) return json({ error: 'not_found' }, 404);
      const stored = await env.ROOMS.get(`room:${hid}:verifier`);
      if (!stored || !safeEqual(stored, req.headers.get('Authorization') || '')) {
        return json({ error: 'unauthorized' }, 401);
      }

      if (req.method === 'GET' && p[0] === 'rooms' && p.length === 2) {
        const list = await env.ROOMS.list({ prefix: `room:${hid}:member:` });
        const members = [];
        for (const k of list.keys) {
          const v = await env.ROOMS.getWithMetadata(k.name);
          members.push({ memberId: k.name.split(':').pop(), blob: v.value, updatedAt: v.metadata?.updatedAt || null });
        }
        return json({ members });
      }

      if (p[2] === 'members' && p[3]) {
        if (req.method === 'PUT') {
          const body = await req.text();
          if (new TextEncoder().encode(body).length > MAX_BLOB) return json({ error: 'too_large' }, 413);
          await env.ROOMS.put(`room:${hid}:member:${p[3]}`, body, {
            metadata: { updatedAt: new Date().toISOString() },
          });
          return json({ ok: true });
        }
        if (req.method === 'DELETE') {
          await env.ROOMS.delete(`room:${hid}:member:${p[3]}`);
          return json({ ok: true });
        }
      }
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 500);
    }
  },
};
