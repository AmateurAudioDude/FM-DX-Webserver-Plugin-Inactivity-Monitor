/*
    Inactivity Monitor v1.1.3 by AAD
    https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Inactivity-Monitor
*/

(() => {

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

let inactivityLimit = 30; // minutes
let popupWaitTime = 120; // seconds
let sessionLimit = 180; // minutes          // Total session time ignoring activity
let enableToasts = true;                    // Webserver toast notifications
let enableWhitelistToasts = true;           // Webserver toast notifications for whitelisted IP addresses
let resetTimerOnMouseMove = true;           // Mouse movement (within webserver webpage only)
let resetTimerOnMouseClick = true;          // Mouse click
let resetTimerOnMouseScroll = true;         // Mouse scroll wheel
let resetTimerOnKeyboard = true;            // Keyboard press
let resetTimerOnPageScroll = true;          // Webpage scrolling
let resetTimerOnWindowFocus = true;         // Window focus
let resetTimerOnFrequencyChange = true;     // Command sent to tuner

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

const pluginName = "Inactivity Monitor";

// Initial variable settings
let toastWarningPercentage = Math.floor((inactivityLimit * 60) * 0.9); // Toast warning popup at 90% idle limit
let inactivityTime = 0;
let sessionTime = 0;
let consoleDebug = false;
let popupDisplayed = false;
let popupTimeout;

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
if (resetTimerOnFrequencyChange) {
    const originalSend = socket.send.bind(socket);
    socket.send = function(...args) { resetTimer(); return originalSend(...args); };
}

const checkInactivity = () => {
    inactivityTime += 1000; // Increment inactivity by 1 second
    sessionTime += 1000; // Increment session by 1 second
    if (consoleDebug) {
        console.log(`${pluginName}: idle for ${inactivityTime / 1000} second(s)`);
        if (Number.isInteger(sessionTime / 60000)) console.log(`${pluginName}: session running for ${(sessionTime / 1000) / 60} minute(s)`);
    }
    if ((inactivityTime / 1000) === toastWarningPercentage && typeof sendToast === 'function' && enableToasts) {
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
            cancelTimer(`${pluginName}: detected administrator logged in, plugin inactive.`, `You are logged in and whitelisted, enjoy!`, !enableWhitelistToasts);
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
                console.warn(`${pluginName}: toast notifications not ready.`);
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
                                cancelTimer(`${pluginName}: IP address validated and whitelisted, closing WebSocket connection.`, `IP address whitelisted, enjoy!`, !enableWhitelistToasts);
                            }, 800);
                        }
                        // Close WebSocket after receiving response
                        if (!data.isWhitelisted) console.log(`${pluginName}: IP address validated and not whitelisted, closing WebSocket connection.`);
                        wsSendSocket.close();
                    })
                    .catch(error => {
                        console.error(`${pluginName}: WebSocket failed to validate IP address:`, error);
                        wsSendSocket.close();
                    });
            };

            wsSendSocket.onerror = (error) => {
                console.error(`${pluginName}: WebSocket error:`, error);
                setTimeout(setupSendSocket, 10000); // Retry WebSocket setup after 10 seconds
            };

            wsSendSocket.onclose = () => {};
        } catch (error) {
            console.error(`${pluginName}: WebSocket failed to setup WebSocket:`, error);
            setTimeout(setupSendSocket, 10000); // Retry WebSocket setup after 10 seconds
        }
    }
}

// Initialise WebSocket connection
setupSendSocket();

/*
    Themed Popups v1.1.2 by AAD
    https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Themed-Popups
*/

document.addEventListener('DOMContentLoaded',()=>{if(typeof pluginThemedPopup==='undefined'){var styleElement=document.createElement('style');var cssCodeThemedPopups=`.popup-plugin{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background-color:var(--color-2);color:var(--color-main-bright);padding:20px;border-radius:10px;box-shadow:0 4px 8px rgba(0,0,0,0.4);opacity:0;transition:opacity 0.3s ease-in;z-index:9999}.popup-plugin-content{text-align:center}.popup-plugin button{margin-top:10px}.popup-plugin.open{opacity:.99}`;styleElement.appendChild(document.createTextNode(cssCodeThemedPopups));document.head.appendChild(styleElement)}});const isClickedOutsidePopupPluginInactivityMonitor=true;function alert(popupMessage,popupButton){if(typeof popupButton==='undefined'){popupButton='OK'}if(!popupOpened){popup=document.createElement('div');popup.classList.add('popup-plugin');popup.innerHTML=`<div class="popup-plugin-content">${popupMessage.replace(/\n/g,'<br>')}<button id="popup-plugin-close">${popupButton}</button></div>`;document.body.appendChild(popup);var closeButton=popup.querySelector('#popup-plugin-close');closeButton.addEventListener('click',closePopup);popup.addEventListener('click',function(event){event.stopPropagation()});setTimeout(function(){popup.classList.add('open');popupOpened=true;blurBackground(true)},10)}}function blurBackground(status){if(status===true){if(idModal){idModal.style.display='block';setTimeout(function(){idModal.style.opacity='1'},40)}}else{if(idModal){setTimeout(function(){idModal.style.display='none'},400);idModal.style.opacity='0'}}}var popupOpened=false,popup,popupPromptOpened=false,idModal=document.getElementById('myModal');function closePopup(event){event.stopPropagation();popupOpened=false;popup.classList.remove('open');setTimeout(function(){popup.remove();blurBackground(false)},300);console.log(`${pluginName}: popup closed, user active.`);clearTimeout(popupTimeout);popupDisplayed=false;resetTimer()}document.addEventListener('keydown',function(event){if(popupOpened&&(event.key==='Escape'||event.key==='Enter')){closePopup(event);blurBackground(false)}});if(isClickedOutsidePopupPluginInactivityMonitor){document.addEventListener('click',function(event){if(popupOpened&&!popup.contains(event.target)){closePopup(event);blurBackground(false)}})}

})();
