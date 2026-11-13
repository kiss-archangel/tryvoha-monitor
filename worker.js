// Cloudflare Worker: публічний проксі до Ukraine Alarm + спільний час хвилини мовчання.
// Секрети/прив'язки (Settings → Variables and Secrets / Bindings):
//   TRYVOHA_TOKEN   (Secret)  токен Ukraine Alarm
//   ADMIN_PASSWORD  (Secret)  пароль адміністратора для зміни часу хвилини мовчання
//   SIL_KV          (KV namespace binding)  сховище для часу хвилини мовчання
const UPSTREAM = "https://api.ukrainealarm.com";
const ALLOWED = /^\/api\/v3\/(regions|alerts)(\/[A-Za-z0-9_-]+)?$/;
const TTL = 10; // секунд: не частіше ніж раз на 10 с до сервісу, скільки б людей не відкрило сайт
const DEFAULT_SIL = "08:59:00";
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const SIL_TTL = 15;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra },
  });

function safeEqual(a, b) {
  const x = String(a), y = String(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}

async function handleSilence(request, env, ctx, url) {
  const sub = url.pathname.replace(/^\/proxy\/silence/, "");
  const cache = caches.default;
  const cacheKey = new Request(url.origin + "/proxy/silence", { method: "GET" });

  if (request.method === "GET" && sub === "") {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const r = new Response(hit.body, hit);
      Object.entries(CORS).forEach(([k, v]) => r.headers.set(k, v));
      return r;
    }
    let time = DEFAULT_SIL;
    if (env.SIL_KV) {
      const v = await env.SIL_KV.get("silTime");
      if (v && TIME_RE.test(v)) time = v;
    }
    const res = json({ time }, 200, { "Cache-Control": "public, max-age=" + SIL_TTL });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }

  if (request.method === "POST" && (sub === "" || sub === "/auth")) {
    if (!env.ADMIN_PASSWORD) return json({ error: "admin password not configured" }, 500);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "bad json" }, 400); }
    if (!safeEqual(body && body.password || "", env.ADMIN_PASSWORD)) {
      await new Promise((r) => setTimeout(r, 500)); // уповільнюємо підбір пароля
      return json({ error: "unauthorized" }, 401);
    }
    if (sub === "/auth") return json({ ok: true });
    if (!env.SIL_KV) return json({ error: "kv not configured" }, 500);
    let t = String(body.time || "");
    if (!TIME_RE.test(t)) return json({ error: "bad time" }, 400);
    if (t.length === 5) t += ":00";
    await env.SIL_KV.put("silTime", t);
    ctx.waitUntil(cache.delete(cacheKey));
    return json({ ok: true, time: t });
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (url.pathname.startsWith("/proxy/silence")) return handleSilence(request, env, ctx, url);

    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    if (url.pathname === "/proxy/status") return json({ hasToken: !!env.TRYVOHA_TOKEN, hasAdmin: !!env.ADMIN_PASSWORD, hasKv: !!env.SIL_KV });
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
