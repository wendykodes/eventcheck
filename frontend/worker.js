// Serves the Vite SPA and proxies /api/* to the Express backend
// (same role the netlify.toml redirects play on Netlify).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const backend = (env.BACKEND_URL || 'https://natural-beauty-production-5cb5.up.railway.app').replace(/\/$/, '');
      const target = new URL(url.pathname + url.search, backend + '/');
      const headers = new Headers(request.headers);
      headers.set('host', new URL(backend).host);
      headers.set('x-forwarded-host', url.host);
      headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
      return fetch(
        new Request(target.toString(), {
          method: request.method,
          headers,
          body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        })
      );
    }

    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 404 && request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html')) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url.origin).toString(), { headers: request.headers }));
    }
    return asset;
  },
};
