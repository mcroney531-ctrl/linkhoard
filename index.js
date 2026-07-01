// Railway entry point — SSE/HTTP transport
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import http from 'http';
import { createServer } from './server.js';

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method === 'GET' && req.url === '/sse') {
    const mcpServer = createServer();
    const transport = new SSEServerTransport('/message', res);
    await mcpServer.connect(transport);
    return;
  }

  if (req.method === 'POST' && req.url === '/message') {
    // SSE transport handles message routing internally via the session map
    // This branch is hit by the SDK's own internal routing — handled by transport
    res.writeHead(404);
    res.end('Use /sse to establish SSE connection');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

httpServer.listen(PORT, () => {
  process.stderr.write(`Link Hoarder MCP server listening on port ${PORT}\n`);
});
