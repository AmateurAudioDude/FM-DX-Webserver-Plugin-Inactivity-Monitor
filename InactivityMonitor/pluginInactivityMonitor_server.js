/*
    Inactivity Monitor v1.2.0 by AAD

    //// Server-side code ////
*/

'use strict';

const pluginName = "Inactivity Monitor";

const debug = false;

// Library imports
const fs = require('fs');
const path = require('path');

// File imports
const { logInfo, logWarn, logError } = require('../../server/console');
const endpointsRouter = require('../../server/endpoints');

// Get WebSockets
let wss, pluginsWss;
let useHooks = false;

try {
    // plugins API
    const pluginsApi = require('../../server/plugins_api');

    wss = pluginsApi.getWss?.();
    pluginsWss = pluginsApi.getPluginsWss?.();

    useHooks = !!(wss && pluginsWss);

    if (useHooks) {
        logInfo(`[${pluginName}] Using plugins_api WebSocket hooks`);
    } else {
        throw new Error(`loaded plugins_api but hooks unavailable`);
    }
} catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
        logError(`[${pluginName}] Missing plugins_api, plugin is nonfunctional, update FM-DX Webserver`);
    } else {
        logError(`[${pluginName}] Unusable plugins_api (${err.message}), plugin is nonfunctional, update FM-DX Webserver`);
    }

    return; // hard stop
}

// Configuration paths
const rootDir = path.dirname(require.main.filename);
const configFolderPath = path.join(rootDir, 'plugins_configs');
const configFilePath = path.join(configFolderPath, 'InactivityMonitor.json');

// Plugin state
const activityTracking = new Map(); // IP -> { lastActivity: timestamp, sessionStart: timestamp, ws: WebSocket, interval: intervalId }
const tempBannedIPs = new Map(); // IP -> expirationTime
const wsToIp = new Map(); // Map<ws, ip>
const whitelistedLogged = new Set();
let debounceTimer, debounceTimerLog;

// Configuration variables
let whitelistedIps = ['127.0.0.1', '192.168.*.*'];
let tempBanDuration = 1; // minutes, 0 = disabled
let inactivityLimit = 32; // minutes
let sessionLimit = 180; // minutes

// Default configuration
const defaultConfig = {
    whitelistedIps: ['127.0.0.1', '192.168.*.*'],
    tempBanDuration: 1,
    inactivityLimit: 32,
    sessionLimit: 180
};

// Ensure config file exists
function checkConfigFile() {
    if (!fs.existsSync(configFolderPath)) {
        logInfo(`[${pluginName}] Creating plugins_configs folder...`);
        fs.mkdirSync(configFolderPath, { recursive: true });
    }

    if (!fs.existsSync(configFilePath)) {
        logInfo(`[${pluginName}] Creating default InactivityMonitor.json file...`);
        const formattedConfig = JSON.stringify(defaultConfig, null, 2);
        fs.writeFileSync(configFilePath, formattedConfig);
    }
}

// Load configuration and ensure all keys exist
function loadConfig(isReloaded) {
    try {
        let config = {};
        if (fs.existsSync(configFilePath)) {
            const configContent = fs.readFileSync(configFilePath, 'utf-8');
            config = JSON.parse(configContent);
        }

        // Ensure all keys exist in the order of defaultConfig
        const orderedConfig = {};
        let updated = false;

        for (const key of Object.keys(defaultConfig)) {
            if (key in config) {
                orderedConfig[key] = config[key]; // keep existing value
            } else {
                orderedConfig[key] = defaultConfig[key]; // insert missing key
                updated = true;
            }
        }

        // Save back if missing keys were added
        if (updated) {
            fs.writeFileSync(configFilePath, JSON.stringify(orderedConfig, null, 2));
            logInfo(`[${pluginName}] Updated config file with missing keys in correct order`);
        }

        // Apply config values to plugin
        whitelistedIps = Array.isArray(orderedConfig.whitelistedIps) ? orderedConfig.whitelistedIps : defaultConfig.whitelistedIps;
        tempBanDuration = parseInt(orderedConfig.tempBanDuration) || defaultConfig.tempBanDuration;
        inactivityLimit = parseInt(orderedConfig.inactivityLimit) || defaultConfig.inactivityLimit;
        sessionLimit = parseInt(orderedConfig.sessionLimit) || defaultConfig.sessionLimit;

        logInfo(`[${pluginName}] Configuration ${isReloaded || ''}loaded successfully`);
        logInfo(`[${pluginName}] Inactivity limit: ${inactivityLimit} minutes, Session limit: ${sessionLimit} minutes, Temp ban duration: ${tempBanDuration} minutes`);
    } catch (error) {
        logError(`[${pluginName}] Error loading configuration: ${error.message}`);
    }
}

// Watch config file for changes
function watchConfigFile() {
    fs.watch(configFilePath, (eventType) => {
        if (eventType === 'change') {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                loadConfig('re');
            }, 1000);
        }
    });
}

// Check if IP matches wildcard pattern
function matchesWildcard(ip, pattern) {
    const normalizedIp = normalizeIp(ip);
    const normalizedPattern = pattern?.replace(/^::ffff:/, '');

    if (!normalizedPattern.includes('*')) {
        return normalizedIp === normalizedPattern;
    }

    if (normalizedPattern.includes(':')) {
        // IPv6 wildcard
        const regexPattern = `^${normalizedPattern
      .replace(/:/g, '\\:')
      .replace(/\*/g, '[0-9a-fA-F]{1,4}')
      .replace('::', '(?::[0-9a-fA-F]{0,4})*:?')
    }$`;
        const regex = new RegExp(regexPattern, 'i');
        return regex.test(normalizedIp);
    } else {
        // IPv4 wildcard
        const regexPattern = `^${normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)')
    }$`;
        const regex = new RegExp(regexPattern);
        return regex.test(normalizedIp);
    }
}

// Normalise IP address
function normalizeIp(ip) {
    return ip
        ?.replace(/^::ffff:/, '')
        .trim();
}

// Check if IP is whitelisted
function isWhitelisted(ip) {
    const normalizedIp = normalizeIp(ip);
    return whitelistedIps.some(pattern => matchesWildcard(normalizedIp, pattern));
}

// Check if IP is temporarily banned
function isTempBanned(ip) {
    const normalizedIp = normalizeIp(ip);
    const data = tempBannedIPs.get(normalizedIp);
    if (!data) return false;

    if (Date.now() < data.expirationTime) return true;

    clearTimeout(data.timeout);
    tempBannedIPs.delete(normalizedIp);
    return false;
}

// Add temporary ban
function addTempBan(ip, durationMinutes, pluginName) {
    if (durationMinutes <= 0) return;

    const normalizedIp = normalizeIp(ip);
    const now = Date.now();
    const expirationTime = now + durationMinutes * 60 * 1000;

    const existing = tempBannedIPs.get(normalizedIp);
    if (existing?.timeout) clearTimeout(existing.timeout);

    const timeout = setTimeout(() => {
        tempBannedIPs.delete(normalizedIp);
        logInfo(`[${pluginName}] Removed temporary ban for IP ${normalizedIp}`);
    }, durationMinutes * 60 * 1000);

    tempBannedIPs.set(normalizedIp, { expirationTime, timeout });

    logWarn(`[${pluginName}] Temporarily banned IP ${normalizedIp} for ${durationMinutes} minute${durationMinutes !== 1 ? 's' : ''}`);
}

// Kick IP for inactivity
function kickForInactivity(ip, reason) {
    const tracking = activityTracking.get(ip);
    if (!tracking) return;

    for (const ws of tracking.wsSet) {
        try {
            ws.send('KICK'); // server-side kick if client-side fails
            ws.close(1008, JSON.stringify({
                code: 'INACTIVITY_MONITOR',
                msg: reason
            }));
        } catch {}
        wsToIp.delete(ws);
    }

    activityTracking.delete(ip);

    logWarn(`[${pluginName}] Kicked ${ip}: ${reason}`);
}

// Check activity for an IP
function checkActivity(
    sessionLimitMinutes = 0,
    inactivityLimitMinutes = 0,
    tempBanDuration = 0,
    pluginName = 'InactivityMonitor'
) {
    const now = Date.now();

    for (const [ip, tracking] of activityTracking.entries()) {
        // Clean up dead sockets
        for (const ws of [...tracking.wsSet]) {
            if (ws.readyState !== ws.OPEN) {
                tracking.wsSet.delete(ws);
                wsToIp.delete(ws);
            }
        }

        if (tracking.wsSet.size === 0) {
            activityTracking.delete(ip);
            continue;
        }

        const inactiveMinutes = (now - tracking.lastActivity) / 60000;
        const sessionMinutes = (now - tracking.sessionStart) / 60000;

        // Session limit
        if (sessionLimitMinutes > 0 && sessionMinutes >= sessionLimitMinutes) {
            addTempBan(ip, tempBanDuration, pluginName);
            kickForInactivity(ip, 'Automatically kicked for exceeding session limit.');
            continue;
        }

        // Inactivity limit
        if (inactivityLimitMinutes > 0 && inactiveMinutes >= inactivityLimitMinutes) {
            kickForInactivity(ip, 'Automatically kicked for inactivity.');
        }
    }
}

// Periodic cleanup of all tracked connections
setInterval(() => {
    checkActivity(
        sessionLimit, // session limit in minutes
        inactivityLimit, // inactivity limit in minutes
        tempBanDuration, // temp ban duration in minutes
        pluginName // plugin name string
    );
}, 30 * 1000);

// Update last activity timestamp
function updateActivity(ws) {
    const ip = wsToIp.get(ws);
    if (!ip) return;

    const tracking = activityTracking.get(ip);
    if (!tracking) return;

    tracking.lastActivity = Date.now();
}

// Handle new WebSocket connection
function handleConnection(ws, request) {
    const clientIp =
        request.headers['x-forwarded-for']?.split(',')[0] ||
        request.connection.remoteAddress;

    const normalizedIp = normalizeIp(clientIp);

    // Admin
    if (request.session?.isAdminAuthenticated === true) {
        tempBannedIPs.delete(normalizedIp);
        //logInfo(`[${pluginName}] Admin authenticated (${normalizedIp})`);
        return;
    }

    // Temp ban check
    if (tempBanDuration > 0 && isTempBanned(normalizedIp)) {
        const expirationTime = tempBannedIPs.get(normalizedIp).expirationTime;
        const remainingMinutes = Math.ceil((expirationTime - Date.now()) / 60000);

        ws.send('KICK'); // server-side kick if client-side fails
        ws.close(
            1008,
            JSON.stringify({
                code: 'INACTIVITY_MONITOR',
                msg: `Temporarily banned for ${remainingMinutes} more minute${remainingMinutes !== 1 ? 's' : ''}.`
            })
        );

        clearTimeout(debounceTimerLog);
        debounceTimerLog = setTimeout(() => {
            logWarn(`[${pluginName}] Temporarily banned IP (${normalizedIp}) attempted to connect`);
        }, 2000);
        return;
    }

    // Whitelist
    if (isWhitelisted(normalizedIp)) {
        if (!whitelistedLogged.has(normalizedIp)) {
            logInfo(`[${pluginName}] Whitelisted IP connected (${normalizedIp})`);
            whitelistedLogged.add(normalizedIp);
        }
        return;
    }

    // Track this connection per IP
    wsToIp.set(ws, normalizedIp);

    let tracking = activityTracking.get(normalizedIp);
    if (!tracking) {
        tracking = {
            lastActivity: Date.now(),
            sessionStart: Date.now(),
            wsSet: new Set()
        };
        activityTracking.set(normalizedIp, tracking);
        if (debug) logInfo(`[${pluginName}] Started monitoring connection from IP ${normalizedIp}`);
    } else {
        // Update last activity on new connection
        tracking.lastActivity = Date.now();
    }
    tracking.wsSet.add(ws);

    // Activity updates
    ws.on('message', () => {
        updateActivity(ws);
    });

    // Cleanup
    ws.on('close', () => {
        const ip = wsToIp.get(ws);
        if (ip) {
            const track = activityTracking.get(ip);
            if (track) {
                track.wsSet.delete(ws);
                if (track.wsSet.size === 0) {
                    activityTracking.delete(ip);
                    whitelistedLogged.delete(ip);
                    if (debug) logInfo(`[${pluginName}] Stopped monitoring connection from IP ${ip}`);
                }
            }
        }
        wsToIp.delete(ws);
    });
}

// Main server WebSocket
if (wss) {
    wss.on('connection', (ws, request) => handleConnection(ws, request));
    logInfo(`[${pluginName}] Main WebSocket server hooked`);
}

// Plugin WebSocket
if (pluginsWss) {
    pluginsWss.on('connection', (ws, request) => handleConnection(ws, request));
    logInfo(`[${pluginName}] Plugin WebSocket server hooked`);
}

// HTTP endpoints for client-side checks
endpointsRouter.get('/inactivity-monitor-plugin-check-ban', (req, res) => {
    const pluginHeader = req.get('X-Plugin-Name') || 'NoPlugin';

    if (pluginHeader === 'InactivityMonitor') {
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
        const isBanned = isTempBanned(clientIp);

        res.json({ banned: isBanned });
    } else {
        res.status(403).json({ error: 'Unauthorised' });
    }
});

endpointsRouter.get('/inactivity-monitor-plugin-validate-ip', (req, res) => {
    const pluginHeader = req.get('X-Plugin-Name') || 'NoPlugin';

    if (pluginHeader === 'InactivityMonitor') {
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
        const normalizedIp = normalizeIp(clientIp);

        res.json({ isWhitelisted: isWhitelisted(normalizedIp) });
    } else {
        res.status(403).json({ error: 'Unauthorised' });
    }
});

endpointsRouter.get('/403_inactivitymonitor', (req, res) => {
    res.status(403).send(`<!DOCTYPE html>
<html>
<head>
    <title>Unauthorized - FM-DX Webserver</title>
    <link href="css/entry.css" type="text/css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css" type="text/css" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js" integrity="sha512-v2CJ7UaYy4JwqLDIrZUI/4hqeoQieOmAZNXBeQyjo21dadnwR+8ZaIJVT8EE2iyI61OV8e6M8PP2/4hpQINQ/g==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <link rel="icon" type="image/png" href="favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <div id="wrapper" class="auto">
        <div class="panel-100 no-bg">
            <img class="top-10" src="./images/openradio_logo_neutral.png" height="64px">
            <h2 class="text-monospace text-light text-center">[403]</h2>

            <div class="panel-100 p-10">
                <br>
                <i class="text-big fa-solid fa-exclamation-triangle color-4"></i>
                <p>
                    There's a possibility you were kicked by the system.<br>
                    Please try again later.</p>
                <b id="message"></b>
                <script>
                    $(document).ready(function() {
                        const urlParams = new URLSearchParams(window.location.search);
                        const msg = urlParams.get('msg');
                        if (msg) {
                            $('#message').text(decodeURIComponent(msg));
                        }
                    });
                </script>
            </div>
        </div>
    </div>
</body>
</html>`);
});

if (debug) {
    // Call this once at server startup
    function monitorActivityTimers(interval = 5000) { // 5 seconds
        setInterval(() => {
            console.log('--- Activity Monitor ---');
            const now = Date.now();
            for (const [key, record] of activityTracking.entries()) {
                const elapsed = Math.floor((now - record.lastActivity) / 1000); // seconds since last ping
                console.log(
                    `[Timer] IP=${key}: lastActivity=${new Date(record.lastActivity).toISOString()}, ` +
                    `elapsed=${elapsed}s`
                );
            }
            console.log('-----------------------\n');
        }, interval);
    }

    monitorActivityTimers(3000);
}

// Initialise
checkConfigFile();
loadConfig();
watchConfigFile();

logInfo(`[${pluginName}] Server-side plugin initialised successfully`);
