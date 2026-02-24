/*
    Inactivity Monitor v1.2.0 by AAD
    https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Inactivity-Monitor
*/

'use strict';

(() => {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

let POPUP_INACTIVITY_LIMIT = 30; // minutes     // For popup only, set 'inactivityLimit' in configuration file
let POPUP_WAIT_TIME = null; // seconds          // Set 'inactivityLimit' in configuration file, e.g. two minutes more than 'POPUP_INACTIVITY_LIMIT'
let SESSION_LIMIT = null; // minutes            // Set in configuration file
let ENABLE_TOASTS = true;                       // Webserver toast notifications
let ENABLE_WHITELIST_TOASTS = true;             // Webserver toast notifications for whitelisted IP addresses
let PAUSE_TIMER_ON_ONE_USER = false;            // Halt timer while only one user is connected
let RESET_TIMER_ON_MOUSE_MOVE = true;           // Mouse movement (within webserver webpage only)
let RESET_TIMER_ON_MOUSE_CLICK = true;          // Mouse click
let RESET_TIMER_ON_MOUSE_SCROLL = true;         // Mouse scroll wheel
let RESET_TIMER_ON_KEYBOARD = true;             // Keyboard press
let RESET_TIMER_ON_PAGE_SCROLL = true;          // Webpage scrolling
let RESET_TIMER_ON_WINDOW_FOCUS = true;         // Window focus
let RESET_TIMER_ON_FREQUENCY_CHANGE = true;     // Command sent to tuner

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const pluginVersion = '1.2.0';
const pluginName = "Inactivity Monitor";
const pluginHomepageUrl = "https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Inactivity-Monitor";
const pluginUpdateUrl = "https://raw.githubusercontent.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Inactivity-Monitor/refs/heads/main/InactivityMonitor/pluginInactivityMonitor.js";
const pluginSetupOnlyNotify = true;
const CHECK_FOR_UPDATES = true;

// Initial variable settings
let toastWarningPercentage = Math.floor((POPUP_INACTIVITY_LIMIT * 60) * 0.9); // Toast warning at 90%
let inactivityTime = 0;
let consoleDebug = false;
let popupDisplayed = false;
let popupTimeout;
let usersOnline = 0;

// Event listeners for user activity
const resetTimer = () => {
    if (!popupDisplayed) {
        sendActivityPing();
    }
};

// Listen for mouse events
if (RESET_TIMER_ON_MOUSE_MOVE) document.addEventListener('mousemove', resetTimer);
if (RESET_TIMER_ON_MOUSE_CLICK) document.addEventListener('mousedown', resetTimer);
if (RESET_TIMER_ON_KEYBOARD) document.addEventListener('keydown', resetTimer);
if (RESET_TIMER_ON_PAGE_SCROLL) document.addEventListener('scroll', resetTimer);
if (RESET_TIMER_ON_WINDOW_FOCUS) window.addEventListener('focus', resetTimer);
if (RESET_TIMER_ON_MOUSE_SCROLL) document.addEventListener('wheel', resetTimer);

// Listen for socket commands
if (RESET_TIMER_ON_FREQUENCY_CHANGE && !window._inactivitySendWrapped) {
    const setupSendWrapper = () => {
        if (!window.socket) return;

        const originalSend = window.socket.send.bind(window.socket);

        window.socket.send = function(...args) {
            // Don't trigger resetTimer if sending activity ping
            if (!args[0] || !args[0].includes('"type":"activityPing"')) {
                resetTimer();
            }
            return originalSend(...args);
        };

        window._inactivitySendWrapped = true;
    };

    if (window.socket) {
        setupSendWrapper();
    } else if (window.socketPromise) {
        window.socketPromise.then(setupSendWrapper);
    }
}

const checkInactivity = () => {
    if (window.location.pathname === '/setup') return;

    if (!PAUSE_TIMER_ON_ONE_USER || usersOnline > 1) {
        inactivityTime += 1000; // 1 second
    }

    if (consoleDebug) {
        console.log(`[${pluginName}] Idle for ${inactivityTime / 1000} seconds, ${usersOnline} user${usersOnline !== 1 ? 's' : ''}, online`);
    }

    // Show warning toast at 90% of limit
    if (usersOnline >= 1 && (inactivityTime / 1000) === toastWarningPercentage && typeof sendToast === 'function' && ENABLE_TOASTS) {
        setTimeout(() => {
            sendToast('warning', 'Inactivity Monitor', `You are currently idle!`, false, false);
        }, 400);
    }

    // Show popup when limit reached
    if (inactivityTime >= POPUP_INACTIVITY_LIMIT * 60 * 1000) {
        showPopup();
    }
};

// Display popup
function showPopup() {
    if (!popupDisplayed) {
        popupDisplayed = true;
        alert("Are you still there?", "Yes");

        // Server kick if no response
        /*
        popupTimeout = setTimeout(() => {
            console.warn(`[${pluginName}] User did not respond to inactivity popup`);
            // Server will handle kick
        }, POPUP_WAIT_TIME * 1000);
        */
    }
}

// --------------------------
// MAIN WebSocket
// --------------------------
if (!window.mainSocketId) {
    // Generate a unique ID for this client (simple timestamp + random)
    window.mainSocketId = `client_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

let socket = window.socket; // your main WS
let socketPromise = window.socketPromise; // your existing promise

// --------------------------
// PLUGIN WebSocket
// --------------------------
let pluginSocket = null;
let pluginSocketResolve;
let pluginSocketPromise = new Promise((resolve) => { pluginSocketResolve = resolve; });

function connectPluginSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/data_plugins`;
    pluginSocket = new WebSocket(wsUrl);

    pluginSocket.onopen = () => {
        console.log(`[${pluginName}] Connected to plugin WebSocket`);

        // Register this client with its unique main WS ID
        pluginSocket.send(JSON.stringify({
            type: 'registerClient',
            clientId: window.mainSocketId
        }));

        pluginSocketResolve(pluginSocket);
    };

    pluginSocket.onmessage = (event) => {
        // ignore
    };

    pluginSocket.onclose = () => {
        setTimeout(() => {
            console.log(`[${pluginName}] Plugin WS disconnected, reconnecting in 5 seconds...`);
        }, 1000);
        setTimeout(connectPluginSocket, 5000);
    };

    pluginSocket.onerror = (err) => {
        console.error(`[${pluginName}] Plugin WS error:`, err);
    };
}

connectPluginSocket();

// --------------------------
// Activity ping
// --------------------------
let _lastActivityPing = 0;
const ACTIVITY_PING_INTERVAL = 5 * 1000;

function sendActivityPing(isPopup = false) {
    pluginSocketPromise.then((socket) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        const now = Date.now();
        if (!isPopup && now - _lastActivityPing < ACTIVITY_PING_INTERVAL) return;

        // Reset local timer
        inactivityTime = 0;

        try {
            socket.send(JSON.stringify({
                type: 'activityPing',
                clientId: window.mainSocketId
            }));
            _lastActivityPing = now;
            console.log(`[${pluginName}] Ping`);
        } catch (err) {
            console.error(`[${pluginName}] Failed to send activity ping:`, err);
        }
    });
}

// Check if administrator
var isTuneAuthenticated = false;

document.addEventListener('DOMContentLoaded', () => {
    checkAdminMode();
    checkTempBan();
});

function checkAdminMode() {
    const bodyText = document.body.textContent || document.body.innerText;
    isTuneAuthenticated = bodyText.includes("You are logged in as an administrator.") ||
        bodyText.includes("You are logged in as an adminstrator.") ||
        bodyText.includes("You are logged in and can control the receiver.");

    if (isTuneAuthenticated) {
        setTimeout(() => {
            cancelTimer(`[${pluginName}] Detected administrator logged in, plugin inactive.`,
                `You are logged in (and whitelisted), enjoy!`, !ENABLE_WHITELIST_TOASTS);
        }, 600);
    }
}

function checkTempBan() {
    // Check if temporarily banned
    fetch('/inactivity-monitor-plugin-check-ban', {
            method: 'GET',
            headers: {
                'X-Plugin-Name': 'InactivityMonitor'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.banned) {
                console.warn(`[${pluginName}] IP is temporarily banned, redirecting...`);
                window.location.href = '/403_inactivitymonitor?msg=Temporarily+banned+for+exceeding+session+limit.';
            }
        })
        .catch(error => {
            console.error(`[${pluginName}] Failed to check ban status:`, error);
        });
}

// Check if whitelisted
fetch('/inactivity-monitor-plugin-validate-ip', {
        method: 'GET',
        headers: {
            'X-Plugin-Name': 'InactivityMonitor'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.isWhitelisted) {
            setTimeout(() => {
                cancelTimer(`[${pluginName}] IP address validated and whitelisted.`,
                    `IP address whitelisted, enjoy!`, !ENABLE_WHITELIST_TOASTS);
            }, 800);
        }
    })
    .catch(error => {
        console.error(`[${pluginName}] Failed to validate IP:`, error);
    });

const intervalInactivity = setInterval(checkInactivity, 1000); // Update every second

// Function to cancel the timer
function cancelTimer(reason, reasonToast, noDisplay) {
    clearInterval(intervalInactivity);
    setTimeout(() => {
        clearInterval(intervalInactivity);
    }, 1000);

    if (typeof sendToast === 'function' && ENABLE_TOASTS && !noDisplay) {
        sendToast('info', 'Inactivity Monitor', reasonToast, false, false);
    }

    console.log(reason);
}

// Setup WebSocket connection for number of users
let lastProcessedTime = 0;
let reconnectAttempts = 0;
let executeFunction = false;

const TIMEOUT_DURATION = 1000;

window.onload = function() {
    executeFunction = true;
};

function connectWebSocket() {
    if (!window.socketPromise) return;

    // Wait for the socket to be initialized
    window.socketPromise.then(() => {
        if (!window.socket) return;

        const socket = window.socket;

        // Reset reconnect attempts if already open
        if (socket.readyState === WebSocket.OPEN) {
            reconnectAttempts = 0;
        }

        // Message handler
        socket.addEventListener('message', (event) => {
            handle_INACTIVITY_MONITOR(event);
        });

        // Close handler
        socket.addEventListener('close', () => {
            setTimeout(() => {
                console.log(`[${pluginName}] WebSocket closed. Attempting to reconnect...`);
            }, 1000);
            attemptReconnect();
        });

        // Error handler
        socket.addEventListener('error', (err) => {
            attemptReconnect();
        });

        console.log(`[${pluginName}] WebSocket connected and listeners set up.`);
    }).catch(err => {
        console.error(`[${pluginName}] Failed to connect WebSocket:`, err);
    });
}

function attemptReconnect() {
    if (reconnectAttempts >= 500) return;

    setTimeout(() => {
        reconnectAttempts++;
        connectWebSocket();
    }, 10000);
}

function handle_INACTIVITY_MONITOR(event) {
    const now = Date.now();

    if (now - lastProcessedTime < TIMEOUT_DURATION) return;
    lastProcessedTime = now;

    const { users } = JSON.parse(event.data);

    function updateVariables(users) {
        usersOnline = users;
    }

    if (executeFunction) updateVariables(users);
}

connectWebSocket();

// Listen for WebSocket close events
(function() {
    function registerWsCloseHandler(pluginName, redirectUrl, defaultMsg, reasonCode) {
        if (!window._wsClosePlugins) window._wsClosePlugins = new Map();
        if (window._wsClosePlugins.has(reasonCode)) return; // Already registered

        window._wsClosePlugins.set(reasonCode, {
            pluginName,
            redirectUrl,
            defaultMsg
        });

        if (!window._wsCloseWrapped) {
            const originalOnClose = window.socket?.onclose;
            window.socket.onclose = function(event) {
                if (event.code !== 1008) {
                    if (originalOnClose) originalOnClose.call(this, event);
                    return;
                }

                let parsed;
                try {
                    parsed = JSON.parse(event.reason);
                } catch {
                    parsed = { code: null, msg: event.reason };
                }

                const info = window._wsClosePlugins.get(parsed.code);
                if (info) {
                    console.log(`[${info.pluginName}] Kicked by server: ${parsed.msg}`);
                    const redirect = () => {
                        const msg = encodeURIComponent(parsed.msg || info.defaultMsg);
                        window.location.href = info.redirectUrl + '?msg=' + msg;
                    };
                    redirect();
                    setInterval(redirect, 1000);
                }

                if (originalOnClose) originalOnClose.call(this, event);
            };
            window._wsCloseWrapped = true;
        }
    }

    window.registerWsCloseHandler = registerWsCloseHandler;
})();

(function() {
    const setup = () => {
        window.registerWsCloseHandler(
            'Inactivity Monitor',
            '/403_inactivitymonitor',
            'Kicked for inactivity',
            'INACTIVITY_MONITOR'
        );
    };

    if (window.socket) setup();
    else if (window.socketPromise) window.socketPromise.then(setup);
})();

// Function for update notification in /setup
if (window.location.pathname === '/setup') {
    // Function for update notification in /setup
    function checkUpdate(e,n,t,o){if(e&&"/setup"!==location.pathname)return;let i="undefined"!=typeof pluginVersion?pluginVersion:"undefined"!=typeof plugin_version?plugin_version:"undefined"!=typeof PLUGIN_VERSION?PLUGIN_VERSION:"Unknown";async function r(){try{let e=await fetch(o);if(!e.ok)throw new Error("["+n+"] update check HTTP error! status: "+e.status);let t=(await e.text()).split("\n"),r;if(t.length>2){let e=t.find(e=>e.includes("const pluginVersion =")||e.includes("const plugin_version =")||e.includes("const PLUGIN_VERSION ="));if(e){let n=e.match(/const\s+(?:pluginVersion|plugin_version|PLUGIN_VERSION)\s*=\s*['"]([^'"]+)['"]/);n&&(r=n[1])}}return r||(r=/^\d/.test(t[0].trim())?t[0].trim():"Unknown"),r}catch(e){return console.error("["+n+"] error fetching file:",e),null}}r().then(e=>{e&&e!==i&&(console.log("["+n+"] There is a new version of this plugin available"),function(e,n,t,o){if("/setup"===location.pathname){let i=document.getElementById("plugin-settings");if(i){let r=i.textContent.trim(),l=`<a href="${o}" target="_blank">[${t}] Update available: ${e} --> ${n}</a><br>`;i.innerHTML="No plugin settings are available."===r?l:i.innerHTML+" "+l}let a=document.querySelector(".wrapper-outer #navigation .sidenav-content .fa-puzzle-piece")||document.querySelector(".wrapper-outer .sidenav-content")||document.querySelector(".sidenav-content"),d=document.createElement("span");d.style.cssText="display:block;width:12px;height:12px;border-radius:50%;background:#FE0830;margin-left:82px;margin-top:-12px",a.appendChild(d)}}(i,e,n,t))})}CHECK_FOR_UPDATES&&checkUpdate(pluginSetupOnlyNotify,pluginName,pluginHomepageUrl,pluginUpdateUrl);
}

/*
    Themed Popups v1.1.3 by AAD
    https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Themed-Popups
*/

document.addEventListener('DOMContentLoaded', () => {
    if (!window.hasCustomPopup) {
        let styleElement = document.createElement("style"),
            cssCodeThemedPopups = ".popup-plugin{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background-color:var(--color-2);color:var(--color-main-bright);padding:20px;border-radius:10px;box-shadow:0 4px 8px rgba(0,0,0,.4);opacity:0;transition:opacity .3s ease-in;z-index:9999;max-width:90vw;max-height:90vh;overflow:auto}@media (max-width:400px){.popup-plugin{padding:10px}}.popup-plugin-content{text-align:center}.popup-plugin button{margin-top:10px}.popup-plugin.open{opacity:.99}";
        styleElement.appendChild(document.createTextNode(cssCodeThemedPopups)), document.head.appendChild(styleElement)
    }
});
const isClickedOutsidePopup = !0;

function alert(e, t) { "undefined" == typeof t && (t = "OK"), popupOpened || (popup = document.createElement("div"), popup.classList.add("popup-plugin"), popup.innerHTML = `<div class="popup-plugin-content">${e.replace(/\n/g,"<br>")}<button id="popup-plugin-close">${t}</button></div>`, document.body.appendChild(popup), popup.querySelector("#popup-plugin-close").addEventListener("click", closePopup), popup.addEventListener("click", function(e) { e.stopPropagation() }), setTimeout(function() { popup.classList.add("open"), popupOpened = !0, blurBackground(!0) }, 10)) }

function blurBackground(e) { idModal && (e ? (idModal.style.display = "block", setTimeout(function() { idModal.style.opacity = "1" }, 40)) : (setTimeout(function() { idModal.style.display = "none" }, 400), idModal.style.opacity = "0")) }
let popupOpened = !1,
    popup, popupPromptOpened = !1,
    idModal = document.getElementById("myModal");

function closePopup(e) {
    e.stopPropagation(), popupOpened = !1, popup.classList.remove("open"), setTimeout(function() { popup.remove(), blurBackground(!1) }, 300);
    console.log(`[${pluginName}] Popup closed, user active.`);
    sendActivityPing(true);
    clearTimeout(popupTimeout);
    popupDisplayed = false;
    inactivityTime = 0;
}
document.addEventListener("keydown", function(e) { popupOpened && ("Escape" === e.key || "Enter" === e.key) && (closePopup(e), blurBackground(!1)) }), isClickedOutsidePopup && document.addEventListener("click", function(e) { popupOpened && !popup.contains(e.target) && (closePopup(e), blurBackground(!1)) });

})();
