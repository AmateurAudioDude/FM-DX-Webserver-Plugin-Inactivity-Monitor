/*
    Inactivity Monitor v1.1.4 by AAD
    https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Inactivity-Monitor
*/

(() => {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

let inactivityLimit = 30; // minutes
let popupWaitTime = 120; // seconds
let sessionLimit = 180; // minutes          // Total session time ignoring activity
let enableToasts = true;                    // Webserver toast notifications
let enableWhitelistToasts = true;           // Webserver toast notifications for whitelisted IP addresses
let pauseTimerOnOneUser = false;            // Halt timer while only one user is connected
let resetTimerOnMouseMove = true;           // Mouse movement (within webserver webpage only)
let resetTimerOnMouseClick = true;          // Mouse click
let resetTimerOnMouseScroll = true;         // Mouse scroll wheel
let resetTimerOnKeyboard = true;            // Keyboard press
let resetTimerOnPageScroll = true;          // Webpage scrolling
let resetTimerOnWindowFocus = true;         // Window focus
let resetTimerOnFrequencyChange = true;     // Command sent to tuner

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

const pluginVersion = '1.1.4';
const pluginName = "Inactivity Monitor";
const pluginHomepageUrl = "https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Inactivity-Monitor";
const pluginUpdateUrl = "https://raw.githubusercontent.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Inactivity-Monitor/refs/heads/main/version";
const pluginSetupOnlyNotify = true;
const CHECK_FOR_UPDATES = true;

// Initial variable settings
let toastWarningPercentage = Math.floor((inactivityLimit * 60) * 0.9); // Toast warning popup at 90% idle limit
let inactivityTime = 0;
let sessionTime = 0;
let consoleDebug = false;
let popupDisplayed = false;
let popupTimeout;
let usersOnline = 0; // Used by WebSocket connection for number of users

// Event listeners for user activity
const resetTimer = () => {
    if (!popupDisplayed) inactivityTime = 0;
};

// Listen for mouse events
if (resetTimerOnMouseMove) document.addEventListener('mousemove', resetTimer);
if (resetTimerOnMouseClick) document.addEventListener('mousedown', (event) => { resetTimer(); });
if (resetTimerOnKeyboard) document.addEventListener('keydown', resetTimer);
if (resetTimerOnPageScroll) document.addEventListener('scroll', resetTimer);
if (resetTimerOnWindowFocus) window.addEventListener('focus', resetTimer);
if (resetTimerOnMouseScroll) document.addEventListener('wheel', (event) => { resetTimer(); });

// Listen for socket commands
if (resetTimerOnFrequencyChange && window.socket) {
    const originalSend = socket.send.bind(socket);
    socket.send = function(...args) { resetTimer(); return originalSend(...args); };
}

const checkInactivity = () => {
    if (window.location.pathname === '/setup') return;
    if (!pauseTimerOnOneUser || usersOnline > 1) {
        inactivityTime += 1000; // Increment inactivity by 1 second
        sessionTime += 1000; // Increment session by 1 second
    }
    if (consoleDebug) {
        console.log(`[${pluginName}] Idle for ${inactivityTime / 1000} seconds, ${usersOnline} users online`);
        if (Number.isInteger(sessionTime / 60000) && sessionTime) console.log(`[${pluginName}] session running for ${(sessionTime / 1000) / 60} minutes`);
    }
    if (usersOnline > 1 && (inactivityTime / 1000) === toastWarningPercentage && typeof sendToast === 'function' && enableToasts) {
        setTimeout(function() {
            sendToast('warning', 'Inactivity Monitor', `You are currently idle!`, false, false);
        }, 400);
    }
    if (inactivityTime >= inactivityLimit * 60 * 1000) {
        showPopup(); // Show the popup if inactive
    }
    if (sessionTime >= sessionLimit * 60 * 1000) {
        executeSessionCode(); // Execute if session limit time exceeded
    }
};

// Display popup
const showPopup = () => {
    if (!popupDisplayed) {
        popupDisplayed = true; // Prevent multiple popups
        const userResponse = alert("Are you still there?", "Yes");

        // Popup timeout
        popupTimeout = setTimeout(() => {
            executeInactivityCode();
        }, popupWaitTime * 1000);
    }
};

const executeInactivityCode = () => {
    console.warn("User is inactive...");
    window.location.href = '/403?msg=Automatically+kicked+for+inactivity.';
};

const executeSessionCode = () => {
    console.warn("User exceeded session limit...");
    window.location.href = '/403?msg=Automatically+kicked+for+exceeding+session+limit.<br>It+may+be+possible+to+reconnect.';
};

// Check if administrator code
var isTuneAuthenticated = false;

document.addEventListener('DOMContentLoaded', () => {
    checkAdminMode();
});

function checkAdminMode() {
    const bodyText = document.body.textContent || document.body.innerText;
    isTuneAuthenticated = bodyText.includes("You are logged in as an administrator.") || bodyText.includes("You are logged in as an adminstrator.") || bodyText.includes("You are logged in and can control the receiver.");
    if (isTuneAuthenticated) {
        setTimeout(function() {
            cancelTimer(`[${pluginName}] Detected administrator logged in, plugin inactive.`, `You are logged in (and whitelisted), enjoy!`, !enableWhitelistToasts);
        }, 600);
    }
}

// Wait until sendToast has been defined
let toastQueue = [];
let toastQueueInterval;
let toastTimeout;
const toastMaxWaitTime = 5000;

// Function to process toast queue
function processToastQueue() {
    if (typeof sendToast === 'function') {
        while (toastQueue.length) sendToast(...toastQueue.shift());
        clearTimeout(toastTimeout);
        toastQueue = []; // Clear any remaining items
    }
}

const intervalInactivity = setInterval(checkInactivity, 1000); // Update every second

// Function to cancel the timer
function cancelTimer(reason, reasonToast, noDisplay) {
    clearInterval(intervalInactivity);
    setTimeout(() => {
        clearInterval(intervalInactivity);
    }, 1000);

    if (typeof sendToast === 'function' && enableToasts) {
        if (!noDisplay) sendToast('info', 'Inactivity Monitor', reasonToast, false, false);
    } else {
        if (enableToasts) toastQueue.push(['info', 'Inactivity Monitor', reasonToast, false, false]);

        // Start timeout only once
        if (!toastTimeout) {
            toastTimeout = setTimeout(() => {
                toastQueue = []; // Clear queue if timeout reached
                console.warn(`[${pluginName}] toast notifications not ready.`);
            }, toastMaxWaitTime);
            toastQueueInterval = setInterval(processToastQueue, 200); // Check periodically for sendToast
        }
    }

    setTimeout(() => {
        clearInterval(toastQueueInterval);
    }, toastMaxWaitTime);

    console.log(reason);
}

// Determine WebSocket URL based on the current page's URL
const currentURL = new URL(window.location.href);
const WebserverURL = currentURL.hostname;
const WebserverPath = currentURL.pathname.replace(/setup/g, '');
const WebserverPORT = currentURL.port || (currentURL.protocol === 'https:' ? '443' : '80');
const protocol = currentURL.protocol === 'https:' ? 'wss:' : 'ws:';
const WEBSOCKET_URL = `${protocol}//${WebserverURL}:${WebserverPORT}${WebserverPath}data_plugins`;

let wsSendSocket;

// Function to setup the WebSocket connection
async function setupSendSocket() {
    if (!wsSendSocket || wsSendSocket.readyState === WebSocket.CLOSED) {
        try {
            wsSendSocket = new WebSocket(WEBSOCKET_URL);

            wsSendSocket.onopen = () => {
                // Fetch IP address whitelisting status from the server
                fetch('/inactivity-monitor-plugin-validate-ip', {
                        method: 'GET',
                        headers: {
                            'X-Plugin-Name': 'InactivityMonitor'
                        }
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.isWhitelisted) {
                            setTimeout(function() {
                                cancelTimer(`[${pluginName}] IP address validated and whitelisted, closing WebSocket connection.`, `IP address whitelisted, enjoy!`, !enableWhitelistToasts);
                            }, 800);
                        }
                        // Close WebSocket after receiving response
                        if (!data.isWhitelisted) console.log(`[${pluginName}] IP address validated (and not whitelisted), closing WebSocket connection.`);
                        wsSendSocket.close();
                    })
                    .catch(error => {
                        console.error(`[${pluginName}] WebSocket failed to validate IP address:`, error);
                        wsSendSocket.close();
                    });
            };

            wsSendSocket.onerror = (error) => {
                console.error(`[${pluginName}] WebSocket error:`, error);
                setTimeout(setupSendSocket, 10000); // Retry WebSocket setup after 10 seconds
            };

            wsSendSocket.onclose = () => {};
        } catch (error) {
            console.error(`[${pluginName}] WebSocket failed to setup WebSocket:`, error);
            setTimeout(setupSendSocket, 10000); // Retry WebSocket setup after 10 seconds
        }
    }
}

// Initialise WebSocket connection
setupSendSocket();

// Setup WebSocket connection for number of users
let lastProcessedTime = 0;
let reconnectAttempts = 0;
let executeFunction = false;

const TIMEOUT_DURATION = 1000;

window.onload = function() {
    executeFunction = true;
};

function connectWebSocket() {
    if (!window.socket) return;

    if (socket.readyState === WebSocket.OPEN) {
        reconnectAttempts = 0;
    }

    socket.addEventListener('message', (event) => {
        handle_INACTIVITY_MONITOR(event);
    });

    socket.addEventListener('close', () => {
        setTimeout(() => {
            console.log(`[${pluginName}] WebSocket closed. Attempting to reconnect...`);
        }, 1000);
        attemptReconnect();
    });

    socket.addEventListener('error', (err) => {
        attemptReconnect();
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

// Function for update notification in /setup
function checkUpdate(setupOnly, pluginVersion, pluginName, urlUpdateLink, urlFetchLink) {
    if (setupOnly && window.location.pathname !== '/setup') return;

    // Function to check for updates
    async function fetchFirstLine() {
        const urlCheckForUpdate = urlFetchLink;

        try {
            const response = await fetch(urlCheckForUpdate);
            if (!response.ok) {
                throw new Error(`[${pluginName}] update check HTTP error! status: ${response.status}`);
            }

            const text = await response.text();
            const firstLine = text.split('\n')[0]; // Extract first line

            const version = firstLine;

            return version;
        } catch (error) {
            console.error(`[${pluginName}] error fetching file:`, error);
            return null;
        }
    }


    // Check for updates
    fetchFirstLine().then(newVersion => {
        if (newVersion) {
            if (newVersion !== pluginVersion) {
                let updateConsoleText = "There is a new version of this plugin available";
                // Any custom code here

                console.log(`[${pluginName}] ${updateConsoleText}`);
                setupNotify(pluginVersion, newVersion, pluginName, urlUpdateLink);
            }
        }
    });

    function setupNotify(pluginVersion, newVersion, pluginName, urlUpdateLink) {
        if (window.location.pathname === '/setup') {
          const pluginSettings = document.getElementById('plugin-settings');
          if (pluginSettings) {
            const currentText = pluginSettings.textContent.trim();
            const newText = `<a href="${urlUpdateLink}" target="_blank">[${pluginName}] Update available: ${pluginVersion} --> ${newVersion}</a><br>`;

            if (currentText === 'No plugin settings are available.') {
              pluginSettings.innerHTML = newText;
            } else {
              pluginSettings.innerHTML += ' ' + newText;
            }
          }

          const updateIcon = document.querySelector('.wrapper-outer #navigation .sidenav-content .fa-puzzle-piece') || document.querySelector('.wrapper-outer .sidenav-content') || document.querySelector('.sidenav-content');

          const redDot = document.createElement('span');
          redDot.style.display = 'block';
          redDot.style.width = '12px';
          redDot.style.height = '12px';
          redDot.style.borderRadius = '50%';
          redDot.style.backgroundColor = '#FE0830' || 'var(--color-main-bright)'; // Prefer set colour over theme colour
          redDot.style.marginLeft = '82px';
          redDot.style.marginTop = '-12px';

          updateIcon.appendChild(redDot);
        }
    }
}

if (CHECK_FOR_UPDATES) {
    checkUpdate(
        pluginSetupOnlyNotify,  // Check only in /setup
        pluginVersion,          // Plugin version (string)
        pluginName,             // Plugin name
        pluginHomepageUrl,      // Update link URL
        pluginUpdateUrl,        // Update check URL
    );
}

/*
    Themed Popups v1.1.3 by AAD
    https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Themed-Popups
*/

document.addEventListener('DOMContentLoaded',()=>{if(!window.hasCustomPopup){let styleElement=document.createElement("style"),cssCodeThemedPopups=".popup-plugin{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background-color:var(--color-2);color:var(--color-main-bright);padding:20px;border-radius:10px;box-shadow:0 4px 8px rgba(0,0,0,.4);opacity:0;transition:opacity .3s ease-in;z-index:9999;max-width:90vw;max-height:90vh;overflow:auto}@media (max-width:400px){.popup-plugin{padding:10px}}.popup-plugin-content{text-align:center}.popup-plugin button{margin-top:10px}.popup-plugin.open{opacity:.99}";styleElement.appendChild(document.createTextNode(cssCodeThemedPopups)),document.head.appendChild(styleElement)}});const isClickedOutsidePopup=!0;function alert(e,t){"undefined"==typeof t&&(t="OK"),popupOpened||(popup=document.createElement("div"),popup.classList.add("popup-plugin"),popup.innerHTML=`<div class="popup-plugin-content">${e.replace(/\n/g,"<br>")}<button id="popup-plugin-close">${t}</button></div>`,document.body.appendChild(popup),popup.querySelector("#popup-plugin-close").addEventListener("click",closePopup),popup.addEventListener("click",function(e){e.stopPropagation()}),setTimeout(function(){popup.classList.add("open"),popupOpened=!0,blurBackground(!0)},10))}function blurBackground(e){idModal&&(e?(idModal.style.display="block",setTimeout(function(){idModal.style.opacity="1"},40)):(setTimeout(function(){idModal.style.display="none"},400),idModal.style.opacity="0"))}let popupOpened=!1,popup,popupPromptOpened=!1,idModal=document.getElementById("myModal");function closePopup(e){e.stopPropagation(),popupOpened=!1,popup.classList.remove("open"),setTimeout(function(){popup.remove(),blurBackground(!1)},300);console.log(`[${pluginName}] Popup closed, user active.`);clearTimeout(popupTimeout);popupDisplayed=false;resetTimer()}document.addEventListener("keydown",function(e){popupOpened&&("Escape"===e.key||"Enter"===e.key)&&(closePopup(e),blurBackground(!1))}),isClickedOutsidePopup&&document.addEventListener("click",function(e){popupOpened&&!popup.contains(e.target)&&(closePopup(e),blurBackground(!1))});

})();
