const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function allowedOrigins(env = process.env) {
  const appUrl = new URL(env.APP_URL || 'http://localhost:5173');
  const origins = new Set([appUrl.origin]);
  // Local aliases are enabled only in development, with an explicit local APP_URL.
  // Production always requires the exact configured public origin.
  if (env.NODE_ENV === 'development' && loopbackHosts.has(appUrl.hostname)) {
    const ports = new Set([appUrl.port, String(env.PORT || 3100)]);
    for (const host of loopbackHosts) {
      for (const port of ports) {
        origins.add(new URL(`${appUrl.protocol}//${host}${port ? ':' + port : ''}`).origin);
      }
    }
  }
  return origins;
}

export function originGuard(origins) {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin !== undefined && !origins.has(origin)) {
        return res.status(403).json({ error: 'Origem não autorizada.' });
      }
      if (req.get('x-gmv-request') !== '1') {
        return res.status(403).json({ error: 'Requisição inválida.' });
      }
    }
    next();
  };
}
