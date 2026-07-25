function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * StoreValidator is a presentation-only deployment. It serves a separately
 * versioned frontend while forwarding its same-origin API calls to the
 * production decision service. This deliberately keeps model credentials,
 * D1 data, queues, and Durable Objects in one backend and prevents this
 * design-only deployment from consuming queue messages itself.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) {
      const backendOrigin = String(env.BACKEND_ORIGIN || "https://shopvalidator.zhangyvjing.com").replace(/\/$/, "");
      const upstream = new URL(`${url.pathname}${url.search}`, backendOrigin);
      const upstreamRequest = new Request(upstream.toString(), request);
      const headers = new Headers(upstreamRequest.headers);
      // The browser is same-origin with this Worker, but the upstream service
      // correctly restricts cross-origin API access. The proxy is the explicit
      // trust boundary, so authenticate this hop as the backend's own origin.
      headers.set("Origin", new URL(backendOrigin).origin);
      return fetch(new Request(upstreamRequest, { headers }));
    }
    // Keep public links stable and shareable.  The application is still a
    // static SPA, but these are real, canonical resources rather than hash
    // fragments that disappear when somebody opens a copied link elsewhere.
    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname === "/ranking" || url.pathname === "/ranking.html") {
        return Response.redirect(new URL("/ranking/", url).toString(), 308);
      }
      if (url.pathname === "/demo") {
        return Response.redirect(new URL("/demo/", url).toString(), 308);
      }
      const share = url.pathname.match(/^\/case\/([A-Za-z0-9_-]+)$/);
      if (share) {
        return Response.redirect(new URL(`/case/${share[1]}/`, url).toString(), 308);
      }
      if (url.pathname === "/ranking/") {
        const rankingUrl = new URL("/ranking.html", url);
        return env.ASSETS.fetch(new Request(rankingUrl.toString(), request));
      }
    }
    return env.ASSETS.fetch(request);
  }
};
