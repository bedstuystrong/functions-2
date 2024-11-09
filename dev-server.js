import path from 'node:path';
import Fastify from 'fastify';
import { Eta } from 'eta';
import juice from 'juice';

const server = Fastify();

const eta = new Eta({ views: path.resolve(process.cwd(), 'templates') });

server.get('/email/:templateName', async function handler(request, reply) {
  const { templateName } = request.params;
  const { inline, ...query } = request.query;

  let html = await eta.renderAsync(templateName, { 
    ...query,
    subject: query.subject || `${templateName} preview`,
  });

  if (inline) {
    html = juice(html, { removeStyleTags: false })
  }

  return reply.type('text/html').send(html);
});

try {
  await server.listen({ port: process.env.PORT || 3001 });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

