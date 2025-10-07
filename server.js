const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Store scripts in memory (use database for production)
const scripts = new Map();

function generateScriptId() {
    return crypto.randomBytes(8).toString('hex');
}

app.post('/api/upload', (req, res) => {
    try {
        const { script, options } = req.body;
        
        if (!script || script.trim().length === 0) {
            return res.status(400).json({ error: 'Script content is required' });
        }

        // Check if max tokens reached
        if (scripts.size >= 1) {
            return res.status(403).json({ 
                error: 'Token limit reached. Delete existing scripts to upload new ones.' 
            });
        }

        const scriptId = generateScriptId();
        const obfuscatedScript = obfuscateScript(script, options);
        
        scripts.set(scriptId, {
            id: scriptId,
            content: obfuscatedScript,
            original: script,
            options: options,
            createdAt: new Date().toISOString(),
            enabled: true,
            accessCount: 0,
            size: Buffer.byteLength(obfuscatedScript, 'utf8')
        });

        res.json({
            success: true,
            scriptId: scriptId,
            loadstring: `loadstring(game:HttpGet("${req.protocol}://${req.get('host')}/api/execute/${scriptId}"))()`,
            size: Buffer.byteLength(obfuscatedScript, 'utf8')
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to process script: ' + error.message });
    }
});

// Execute endpoint - serves the obfuscated script
app.get('/api/execute/:scriptId', (req, res) => {
    const scriptId = req.params.scriptId;
    const script = scripts.get(scriptId);
    
    if (!script) {
        return res.status(404).send('-- [Moonware] Script not found or has been deleted');
    }
    
    if (!script.enabled) {
        return res.status(403).send('-- [Moonware] Script has been disabled by owner');
    }
    
    // Increment access count
    script.accessCount++;
    
    // Set proper headers
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    res.send(script.content);
});

// Get all scripts
app.get('/api/scripts', (req, res) => {
    const scriptList = Array.from(scripts.values()).map(s => ({
        id: s.id,
        createdAt: s.createdAt,
        enabled: s.enabled,
        accessCount: s.accessCount,
        size: s.size
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json({ scripts: scriptList });
});

// Delete script
app.delete('/api/scripts/:scriptId', (req, res) => {
    const scriptId = req.params.scriptId;
    
    if (scripts.has(scriptId)) {
        scripts.delete(scriptId);
        res.json({ success: true, message: 'Script deleted successfully' });
    } else {
        res.status(404).json({ error: 'Script not found' });
    }
});

// Toggle script enabled status
app.patch('/api/scripts/:scriptId/toggle', (req, res) => {
    const scriptId = req.params.scriptId;
    const script = scripts.get(scriptId);
    
    if (script) {
        script.enabled = !script.enabled;
        res.json({ success: true, enabled: script.enabled });
    } else {
        res.status(404).json({ error: 'Script not found' });
    }
});

// Get statistics
app.get('/api/stats', (req, res) => {
    const totalScripts = scripts.size;
    const totalSize = Array.from(scripts.values()).reduce((sum, s) => sum + s.size, 0);
    const totalAccess = Array.from(scripts.values()).reduce((sum, s) => sum + s.accessCount, 0);
    
    res.json({
        totalScripts,
        totalSize,
        totalAccess,
        tokensLeft: Math.max(0, 1 - totalScripts),
        maxTokens: 1
    });
});

// Obfuscation function - FIXED VERSION
function obfuscateScript(script, options = {}) {
    let obfuscated = script;

    // Apply variable renaming first (if enabled)
    if (options.varRename) {
        const varMap = new Map();
        const localVars = [];
        
        // Find all local variables
        const localRegex = /local\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        while ((match = localRegex.exec(script)) !== null) {
            const varName = match[1];
            if (!varMap.has(varName)) {
                const obfName = '_0x' + crypto.randomBytes(4).toString('hex');
                varMap.set(varName, obfName);
                localVars.push(varName);
            }
        }
        
        // Replace variables (do this carefully to avoid replacing parts of strings)
        localVars.forEach(oldName => {
            const newName = varMap.get(oldName);
            // Use word boundary to avoid partial replacements
            const regex = new RegExp('\\b' + oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
            obfuscated = obfuscated.replace(regex, newName);
        });
    }

    // Apply V3 Class-A encoding (wraps everything in a loader)
    if (options.v3ClassA) {
        const encoded = Buffer.from(obfuscated).toString('base64');
        const chunks = encoded.match(/.{1,80}/g) || [encoded]; // Split into lines
        const encodedString = chunks.join('"\n    .."');
        
        const decoderVar = '_0x' + crypto.randomBytes(3).toString('hex');
        const dataVar = '_0x' + crypto.randomBytes(3).toString('hex');
        const funcVar = '_0x' + crypto.randomBytes(3).toString('hex');
        
        obfuscated = `-- Moonware Obfuscator V3 Class-A
-- Protected Script - Unauthorized redistribution prohibited

local ${dataVar} = "${chunks[0]}"${chunks.length > 1 ? '\n    .."' + chunks.slice(1).join('"\n    .."') + '"' : ''}

local ${funcVar} = function(${decoderVar})
    local _0xb = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    ${decoderVar} = string.gsub(${decoderVar}, '[^'.._0xb..'=]', '')
    return (${decoderVar}:gsub('.', function(_0xx)
        if _0xx == '=' then return '' end
        local _0xr, _0xf = '', (_0xb:find(_0xx) - 1)
        for _0xi = 6, 1, -1 do
            _0xr = _0xr .. (_0xf % 2^_0xi - _0xf % 2^(_0xi-1) > 0 and '1' or '0')
        end
        return _0xr
    end):gsub('%d%d%d?%d?%d?%d?%d?%d?', function(_0xx)
        if #_0xx ~= 8 then return '' end
        local _0xc = 0
        for _0xi = 1, 8 do
            _0xc = _0xc + (_0xx:sub(_0xi, _0xi) == '1' and 2^(8-_0xi) or 0)
        end
        return string.char(_0xc)
    end))
end

return loadstring(${funcVar}(${dataVar}))()`;
    }

    // Add Vanguard header
    if (options.vanguard) {
        obfuscated = `-- ╔═══════════════════════════════════════╗
-- ║  Vanguard-WS v3.5 Protection Active  ║
-- ║  Anti-Decompiler • Anti-Tamper       ║
-- ║  Unauthorized Access Forbidden       ║
-- ╚═══════════════════════════════════════╝
--
-- This script is protected by Panda Vanguard
-- Tampering with this code will result in execution failure
-- Script integrity verified

${obfuscated}`;
    }

    // Bypass syntax checking comment
    if (options.bypassSyntax) {
        obfuscated = `-- [SYNTAX CHECK BYPASS ENABLED]\n${obfuscated}`;
    }

    return obfuscated;
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        uptime: process.uptime(),
        scripts: scripts.size
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   🌙 Moonware Obfuscator Server       ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 API endpoint: http://localhost:${PORT}/api`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
    console.log('');
});
