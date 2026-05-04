const { EnhancedMCP } = require('@odin_ssup/emcp')
const http = require('http')

const client = new EnhancedMCP({
    enrichment: 'full',
    output: 'json',
    maxTokens: 4000,
    fuzzyLinkingThreshold: 0.4,
    diffTracking: true,
})

const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'POST' && req.url === '/process') {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
            try {
                const { toolName, serverId, content } = JSON.parse(body)
                const ctx = await client.process({ toolName, serverId, content })
                const json = await client.getJSON()
                res.writeHead(200)
                res.end(JSON.stringify({
                    success: true,
                    nodes: ctx.nodes,
                    meta: ctx.meta,
                    errors: ctx.errors || [],
                    diff: ctx.diff || null,
                    json
                }))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({ success: false, error: e.message }))
            }
        })
        return
    }

    if (req.method === 'POST' && req.url === '/process_many') {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
            try {
                const { responses } = JSON.parse(body)
                const ctx = await client.processMany(responses)
                const json = await client.getJSON()
                res.writeHead(200)
                res.end(JSON.stringify({
                    success: true,
                    nodes: ctx.nodes,
                    meta: ctx.meta,
                    errors: ctx.errors || [],
                    json
                }))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({ success: false, error: e.message }))
            }
        })
        return
    }

    if (req.method === 'POST' && req.url === '/clear') {
        client.clearContext()
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
        return
    }

    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200)
        res.end(JSON.stringify({ status: 'ok', version: '0.2.0' }))
        return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
})

const PORT = 3001
server.listen(PORT, '127.0.0.1', () => {
    console.log(`emcp bridge running on http://127.0.0.1:${PORT}`)
})

module.exports = { server }