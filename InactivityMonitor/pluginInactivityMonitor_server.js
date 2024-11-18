/*
    Inactivity Monitor v1.1.0 by AAD
    Server-side code
*/

// Library imports
const express = require('express');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// File imports
const config = require('./../../config.json');
const { logInfo, logError } = require('../../server/console');
const webserverPort = config.webserver.webserverPort || 8080; // Default to port 8080 if not specified
const externalWsUrl = `ws://127.0.0.1:${webserverPort}`;

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

            // Check if the IP is whitelisted
            const isWhitelisted = whitelist.includes(clientIp);

            if (isWhitelisted) {
                res.json({ isWhitelisted: true });
            } else {
                res.json({ isWhitelisted: false });
            }
        } else {
            res.status(403).json({ error: 'Unauthorised' });
        }
    });

    logInfo('Inactivity Monitor: Custom route added to endpoints router.');
}

// Create custom route for IP address
customRoute();

// Function to ensure the folder and file exist
function checkConfigFile() {
    // Check if the plugins_configs folder exists
    if (!fs.existsSync(configFolderPath)) {
        logInfo("Inactivity Monitor: Creating plugins_configs folder...");
        fs.mkdirSync(configFolderPath, { recursive: true }); // Create the folder recursively if needed
    }

    // Check if InactivityMonitor.json exists
    if (!fs.existsSync(configFilePath)) {
        logInfo("Inactivity Monitor: Creating default InactivityMonitor.json file...");
        // Create the JSON file with default content and custom formatting
        const defaultConfig = {
            whitelistedIps: ["192.168.1.1", "::ffff:192.168.1.1"]
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
        logInfo(`Inactivity Monitor whitelist ${isReloaded || ''}loaded:`, whitelist);
    } catch (error) {
        logError("Inactivity Monitor error loading whitelist:", error.message);
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

async function ExtraWebSocket() {
    if (!extraSocket || extraSocket.readyState === WebSocket.CLOSED) {
        try {
            extraSocket = new WebSocket(`${externalWsUrl}/data_plugins`);

            extraSocket.onopen = () => {
                logInfo(`Inactivity Monitor connected to ${externalWsUrl}/data_plugins`);
            };

            extraSocket.onerror = (error) => {
                logError("Inactivity Monitor webSocket error:", error);
            };

            extraSocket.onclose = () => {
                logInfo("Inactivity Monitor webSocket closed, reconnecting...");
                setTimeout(ExtraWebSocket, 10000); // Reconnect after a delay
            };

            extraSocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);

                    // Validate IP if the message type is 'validate-ip'
                    if (message.type === 'inactivity-monitor-plugin-validate-ip' && message.ip) {
                        const isWhitelisted = whitelist.includes(message.ip);

                        // Send validation response back to the client
                        extraSocket.send(JSON.stringify({
                            type: 'inactivity-monitor-plugin-validate-ip-response',
                            ip: message.ip,
                            isWhitelisted,
                        }));

                        if (isWhitelisted) logInfo(`Inactivity Monitor: ${message.ip} is whitelisted`);
                    }
                } catch (error) {
                    logError("Inactivity Monitor error processing message:", error);
                }
            };
        } catch (error) {
            logError("Inactivity Monitor failed to set up WebSocket:", error);
            setTimeout(ExtraWebSocket, 10000); // Reconnect after failure
        }
    }
}

// Initialise the WebSocket connection
ExtraWebSocket();
