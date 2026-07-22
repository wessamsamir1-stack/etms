import Fastify, { FastifyInstance } from 'fastify';
import { ApiError } from './middleware/context';
import { Deps, registerRoutes } from './routes';

/** Builds the Fastify app with a problem+json error handler and all routes. */
export async function buildServer(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.config.env !== 'test',
    genReqId: () => `req_${Math.random().toString(36).slice(2, 12)}`,
  });

  // CORS for the web dashboard (Bearer-token auth, no cookies). Off unless
  // CORS_ORIGIN is set; use '*' for local testing.
  const cors = deps.config.corsOrigin;
  if (cors) {
    app.addHook('onRequest', async (req, reply) => {
      reply.header('access-control-allow-origin', cors);
      reply.header('access-control-allow-headers', 'authorization,content-type');
      reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      reply.header('vary', 'origin');
      if (req.method === 'OPTIONS') reply.code(204).send();
    });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).type('application/problem+json').send({
        type: `https://errors.etms.app/${err.code.toLowerCase()}`,
        title: err.message,
        status: err.status,
        code: err.code,
        request_id: req.id,
      });
    }
    // Zod / unexpected
    req.log.error(err);
    return reply.status(500).type('application/problem+json').send({
      type: 'https://errors.etms.app/internal',
      title: 'Internal error',
      status: 500,
      code: 'INTERNAL',
      request_id: req.id,
    });
  });

  await registerRoutes(app, deps);
  return app;
}
