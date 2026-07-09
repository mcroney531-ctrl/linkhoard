import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { saveLink, listLinks, updateLink, searchLinks, deleteLink } from './tools.js';

export function createServer() {
  const server = new McpServer({
    name: 'link-hoarder',
    version: '1.0.0',
  });

  server.tool(
    'save_link',
    'Save a URL to the link hoard. Fetches title and description automatically.',
    {
      url: z.string().url().describe('The URL to save'),
      category: z.string().optional().default('other')
        .describe('Broad content category. Common ones: article, tool, reference, video, shopping, resource, thread, other — but any custom category is allowed.'),
      tags: z.array(z.string()).optional().default([]).describe('Free-form tags'),
      status: z.enum(['unread', 'skimmed', 'act-on-it', 'archived']).optional().default('unread'),
      notes: z.string().optional().default('').describe('Optional personal note'),
    },
    async (args) => saveLink(args)
  );

  server.tool(
    'list_links',
    'List saved links, optionally filtered by status, category, or tag.',
    {
      status: z.enum(['unread', 'skimmed', 'act-on-it', 'archived']).optional(),
      category: z.string().optional().describe('Filter by category (any string)'),
      tag: z.string().optional().describe('Filter by a single tag'),
      limit: z.number().int().min(1).max(100).optional().default(20),
      offset: z.number().int().min(0).optional().default(0),
    },
    async (args) => listLinks(args)
  );

  server.tool(
    'update_link',
    'Update the status, category, tags, or notes of a saved link. Accepts full UUID or first 8 chars of ID.',
    {
      id: z.string().describe('Link ID (full UUID or 8-char prefix shown in list)'),
      status: z.enum(['unread', 'skimmed', 'act-on-it', 'archived']).optional(),
      category: z.string().optional().describe('Any category string'),
      tags: z.array(z.string()).optional().describe('Replaces existing tags entirely'),
      notes: z.string().optional().describe('Replaces existing note'),
    },
    async (args) => updateLink(args)
  );

  server.tool(
    'search_links',
    'Full-text search across title, description, URL, and notes.',
    {
      query: z.string().describe('Search term'),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async (args) => searchLinks(args)
  );

  server.tool(
    'delete_link',
    'Permanently delete a saved link. Accepts full UUID or 8-char ID prefix.',
    {
      id: z.string().describe('Link ID (full UUID or 8-char prefix)'),
    },
    async (args) => deleteLink(args)
  );

  return server;
}
