/*
    Inactivity Monitor v1.1.5 by AAD
    //// Server-side code ////
*/

'use strict';

const pluginName = "Inactivity Monitor";

// Library imports
const fs = require('fs');
const path = require('path');

// File imports
const config = require('./../../config.json');
const { logInfo, logError } = require('../../server/console');

// Define variables
let debounceTimer;
let extraSocket;
let whitelist = [];
let tempBanDuration = 0; // minutes, 0 = disabled
let tempBannedIPs = new Map(); // Store temporarily bans with expiration times

// Define paths
const rootDir = path.dirname(require.main.filename); // Locate directory where index.js is located
const configFolderPath = path.join(rootDir, 'plugins_configs');
const configFilePath = path.join(configFolderPath, 'InactivityMonitor.json');

// Function to create a custom route
function customRoute() {
    // Load router from endpoints.js
    const endpointsRouter = require('../../server/endpoints');

    // Add checking route
    endpointsRouter.get('/inactivity-monitor-plugin-check-ban', (req, res) => {
        const pluginHeader = req.get('X-Plugin-Name') || 'NoPlugin';

        if (pluginHeader === 'InactivityMonitor') {
            const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
            const isBanned = isTempBanned(clientIp);

            if (isBanned) {
                res.json({ banned: true });
            } else {
                res.json({ banned: false });
            }
        } else {
            res.status(403).json({ error: 'Unauthorised' });
        }
    });

    // Add new route to this router
    endpointsRouter.get('/inactivity-monitor-plugin-validate-ip', (req, res) => {
        const pluginHeader = req.get('X-Plugin-Name') || 'NoPlugin';

        if (pluginHeader === 'InactivityMonitor') {
            const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
            const normalizedIp = clientIp?.replace(/^::ffff:/, '');

            // Check if IP is whitelisted
            const isWhitelisted = whitelist.some(whitelistedIp => {
              const normalizedWhitelistedIp = whitelistedIp.replace(/^::ffff:/, '');

              if (normalizedWhitelistedIp.includes('*')) {
                // Check if it's an IPv6 address with a wildcard
                if (normalizedWhitelistedIp.includes(':')) {
                  // Handle IPv6 address with wildcard
                  const regexPattern = `^${normalizedWhitelistedIp
                    .replace(/:/g, '\\:')                       // Escape colons
                    .replace(/\*/g, '[0-9a-fA-F]{1,4}')         // Replace * with valid IPv6 segment
                    .replace('::', '(?::[0-9a-fA-F]{0,4})*:?')  // Handle `::` for zero compression
                  }$`;
                  const regex = new RegExp(regexPattern, 'i');  // Case-insensitive matching for IPv6
                  return regex.test(normalizedIp);
                } else {
                  // Handle IPv4 address with wildcard
                  const regexPattern = `^${normalizedWhitelistedIp
                    .replace(/\./g, '\\.')                                     // Escape dots
                    .replace(/\*/g, '(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)')  // Replace * with valid IPv4 octet pattern
                  }$`;
                  const regex = new RegExp(regexPattern);
                  return regex.test(normalizedIp);
                }
              }
              return normalizedWhitelistedIp === normalizedIp;
            });

            if (isWhitelisted) {
                res.json({ isWhitelisted: true });
            } else {
                res.json({ isWhitelisted: false });
            }
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
                        function getQueryParam(param) {
                            var urlParams = new URLSearchParams(window.location.search);
                            return urlParams.get(param);
                        }
                        var msg = getQueryParam('msg');
                        if (msg) {
                            $('#message').html('<p>' + msg + '</p>');
                        }
                      });
                </script>
            </div> 
        </div>
    </div>
    <script src="js/settings.js"></script>
</body>
</html>
`);
    });

    logInfo(`${pluginName}: Custom route added to endpoints router.`);
}

// Create custom route for IP address
customRoute();

// Function to ensure the folder and file exist
function checkConfigFile() {
    // Check if the plugins_configs folder exists
    if (!fs.existsSync(configFolderPath)) {
        logInfo(`${pluginName}: Creating plugins_configs folder...`);
        fs.mkdirSync(configFolderPath, { recursive: true }); // Create the folder recursively if needed
    }

    // Check if InactivityMonitor.json exists
    if (!fs.existsSync(configFilePath)) {
        logInfo(`${pluginName}: Creating default InactivityMonitor.json file...`);
        // Create the JSON file with default content and custom formatting
        const defaultConfig = {
            whitelistedIps: ["127.0.0.1", "192.168.*.*"],
            tempBanDuration: 0
        };

        // Manually format the JSON with the desired structure
        const formattedConfig = `{
    "whitelistedIps": [${defaultConfig.whitelistedIps.map(ip => `"${ip}"`).join(', ')}],
    "tempBanDuration": ${defaultConfig.tempBanDuration}
}`;

        // Write the formatted JSON to the file
        fs.writeFileSync(configFilePath, formattedConfig);
    } else {
        // Add tempBanDuration if missing from file
        try {
            const fileContent = fs.readFileSync(configFilePath, 'utf8');
            const configData = JSON.parse(fileContent);

            if (configData.tempBanDuration === undefined) {
                logInfo(`${pluginName}: Adding tempBanDuration field to existing config...`);
                configData.tempBanDuration = 0;

                // Write the updated config back to file with proper formatting
                const formattedConfig = `{
    "whitelistedIps": [${(configData.whitelistedIps || []).map(ip => `"${ip}"`).join(', ')}],
    "tempBanDuration": ${configData.tempBanDuration}
}`;
                fs.writeFileSync(configFilePath, formattedConfig);
            }
        } catch (error) {
            logError(`${pluginName} error updating config file:`, error.message);
        }
    }
}

// Call function to ensure folder and file exist
checkConfigFile();

// Load the whitelist and config from the JSON file
function loadWhitelist(isReloaded) {
    try {
        const fileContent = fs.readFileSync(configFilePath, 'utf8');
        const configData = JSON.parse(fileContent);
        whitelist = configData.whitelistedIps || [];
        tempBanDuration = configData.tempBanDuration || 0;
        logInfo(`${pluginName} whitelist ${isReloaded || ''}loaded:`, whitelist.join(', '));
        logInfo(`${pluginName} temp ban duration ${isReloaded || ''}loaded:`, `${tempBanDuration} minutes`);
    } catch (error) {
        logError(`${pluginName} error loading config:`, error.message);
    }
}

// Watch for changes in config file and reload whitelist
fs.watch(configFilePath, (eventType) => {
    if (eventType === 'change') {
        clearTimeout(debounceTimer); // Clear any existing debounce timer
        debounceTimer = setTimeout(() => {
            loadWhitelist('re');
        }, 1000);
    }
});

// Initialise whitelist on server startup
loadWhitelist();

// Temporary ban management functions
function addTempBan(ip) {
    if (tempBanDuration <= 0) return; // Disable feature

    const normalizedIp = ip?.replace(/^::ffff:/, '');
    const expirationTime = Date.now() + (tempBanDuration * 60 * 1000);
    tempBannedIPs.set(normalizedIp, expirationTime);

    logInfo(`${pluginName}: Temporarily banned IP ${normalizedIp} for ${tempBanDuration} minutes`);

    // Set timeout to remove the ban automatically
    setTimeout(() => {
        removeTempBan(normalizedIp);
    }, tempBanDuration * 60 * 1000);
}

function removeTempBan(ip) {
    const normalizedIp = ip?.replace(/^::ffff:/, '');
    if (tempBannedIPs.has(normalizedIp)) {
        tempBannedIPs.delete(normalizedIp);
        logInfo(`${pluginName}: Removed temporary ban for IP ${normalizedIp}`);
    }
}

function isTempBanned(ip) {
    const normalizedIp = ip?.replace(/^::ffff:/, '');
    const expirationTime = tempBannedIPs.get(normalizedIp);

    if (expirationTime) {
        if (Date.now() < expirationTime) {
            return true; // Still banned
        } else {
            // Remove expired ban
            removeTempBan(normalizedIp);
            return false;
        }
    }

    return false;
}

// Periodically clean expired bans
setInterval(() => {
    const now = Date.now();
    for (const [ip, expirationTime] of tempBannedIPs.entries()) {
        if (now >= expirationTime) {
            removeTempBan(ip);
        }
    }
}, 5 * 60 * 1000);

// Add route to handle session limit via HTTP POST
function addSessionLimitRoute() {
    const endpointsRouter = require('../../server/endpoints');

    endpointsRouter.post('/inactivity-monitor-session-limit', (req, res) => {
        const pluginHeader = req.get('X-Plugin-Name') || 'NoPlugin';

        if (pluginHeader === 'InactivityMonitor') {
            const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
            logInfo(`${pluginName}: Session limit exceeded for IP ${clientIp}`);
            addTempBan(clientIp);
            res.json({ success: true });
        } else {
            res.status(403).json({ error: 'Unauthorised' });
        }
    });

    logInfo(`${pluginName}: Session limit route added to endpoints router.`);
}

// Add session limit route
addSessionLimitRoute();
