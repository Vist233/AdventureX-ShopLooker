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
    return env.ASSETS.fetch(request);
  }
};
