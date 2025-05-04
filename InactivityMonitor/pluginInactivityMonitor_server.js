/*
    Inactivity Monitor v1.1.4 by AAD
    //// Server-side code ////
*/

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

// Define paths
const rootDir = path.dirname(require.main.filename); // Locate directory where index.js is located
const configFolderPath = path.join(rootDir, 'plugins_configs');
const configFilePath = path.join(configFolderPath, 'InactivityMonitor.json');

// Function to create a custom route
function customRoute() {
    // Load router from endpoints.js
    const endpointsRouter = require('../../server/endpoints');

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
            whitelistedIps: ["127.0.0.1", "192.168.*.*"]
        };

        // Manually format the JSON with the desired structure
        const formattedConfig = `{
    "whitelistedIps": [${defaultConfig.whitelistedIps.map(ip => `"${ip}"`).join(', ')}]
}`;

        // Write the formatted JSON to the file
        fs.writeFileSync(configFilePath, formattedConfig);
    }
}

// Call function to ensure folder and file exist
checkConfigFile();

// Load the whitelist from the JSON file
function loadWhitelist(isReloaded) {
    try {
        const fileContent = fs.readFileSync(configFilePath, 'utf8');
        const configData = JSON.parse(fileContent);
        whitelist = configData.whitelistedIps || [];
        logInfo(`${pluginName} whitelist ${isReloaded || ''}loaded:`, whitelist.join(', '));
    } catch (error) {
        logError(`${pluginName} error loading whitelist:`, error.message);
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
