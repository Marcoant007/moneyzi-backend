import { McpServer } from '@modelcontextprotocol/server'
import type { McpToolDefinition } from './mcp-tools'

export function buildMcpServer(tools: McpToolDefinition[]): McpServer {
    const server = new McpServer({ name: 'moneyzi-mcp', version: '1.0.0' })

    for (const tool of tools) {
        server.registerTool(
            tool.name,
            // pnpm resolves this to the same zod@4.6.5 install `@modelcontextprotocol/server`
            // uses internally, but tsc treats the two import paths as nominally distinct —
            // hence the cast; verified identical at runtime (see `pnpm why zod`).
            { description: tool.description, inputSchema: tool.inputSchema as any },
            async (args: unknown) => {
                try {
                    const result = await tool.execute(args)
                    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
                } catch (error: any) {
                    return {
                        content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message || 'Tool execution failed' }) }],
                        isError: true,
                    }
                }
            },
        )
    }

    return server
}
