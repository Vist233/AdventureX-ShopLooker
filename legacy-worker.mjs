function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isApiPath(url.pathname)) {
      const backendOrigin = String(
        env.BACKEND_ORIGIN || "https://shopvalidator.zhangyvjing.com"
      ).replace(/\/$/, "");
      const upstream = new URL(`${url.pathname}${url.search}`, backendOrigin);
      const headers = new Headers(request.headers);
      headers.set("Origin", new URL(backendOrigin).origin);
      return fetch(new Request(upstream, request), { headers });
    }

    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname === "/ranking.html" || url.pathname === "/ranking/") {
        return Response.redirect(new URL("/ranking", url).toString(), 308);
      }
      if (url.pathname === "/ranking") {
        return env.ASSETS.fetch(
          new Request(new URL("/ranking.html", url), request)
        );
      }
      if (url.pathname === "/demo") {
        return Response.redirect(new URL("/demo/", url).toString(), 308);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
