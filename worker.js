// Cloudflare Worker: публічний проксі до Ukraine Alarm. Токен лежить лише тут (секрет TRYVOHA_TOKEN).
const UPSTREAM = "https://api.ukrainealarm.com";
const ALLOWED = /^\/api\/v3\/(regions|alerts)(\/[A-Za-z0-9_-]+)?$/;
const TTL = 10; // секунд: не частіше ніж раз на 10 с до сервісу, скільки б людей не відкрило сайт

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra },
  });

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

    const url = new URL(request.url);
    if (url.pathname === "/proxy/status") return json({ hasToken: !!env.TRYVOHA_TOKEN });
    if (url.pathname === "/proxy/time") return json({ now: Date.now() }); // точний серверний час для синхронізації годинників

    const m = url.pathname.match(/^\/proxy\/ukrainealarm(\/.*)$/);
    if (!m || !ALLOWED.test(m[1])) return json({ error: "not found" }, 404);
    if (!env.TRYVOHA_TOKEN) return json({ error: "token not configured" }, 500);

    const cache = caches.default;
    const cacheKey = new Request(UPSTREAM + m[1], { method: "GET" });
    const hit = await cache.match(cacheKey);
    if (hit) {
      const r = new Response(hit.body, hit);
      Object.entries(CORS).forEach(([k, v]) => r.headers.set(k, v));
      return r;
    }

    let up;
    try {
      up = await fetch(UPSTREAM + m[1], {
        headers: { Authorization: env.TRYVOHA_TOKEN, "User-Agent": "tryvoha-monitor" },
      });
    } catch (e) {
      return json({ error: "upstream unreachable" }, 502);
    }
    const body = await up.arrayBuffer();
    const res = new Response(body, {
      status: up.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + TTL, ...CORS },
    });
    if (up.status === 200) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  },
};
