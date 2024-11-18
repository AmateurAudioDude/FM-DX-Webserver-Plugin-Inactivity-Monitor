/*
    Inactivity Monitor v1.1.0 by AAD
    https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Inactivity-Monitor
*/

(() => {

////////////////////////////////////////////////////////////////////////////////////////////////////

let inactivityLimit = 30; // minutes
let popupWaitTime = 120; // seconds
let enableToasts = true;                  // Webserver toast notifications    
let resetTimerOnMouseMove = true;         // Mouse movement (within webserver webpage only)
let resetTimerOnMouseClick = true;        // Mouse click
let resetTimerOnMouseScroll = true;       // Mouse scroll wheel
let resetTimerOnKeyboard = true;          // Keyboard press
let resetTimerOnPageScroll = true;        // Webpage scrolling
let resetTimerOnWindowFocus = true;       // Window focus
let resetTimerOnFrequencyChange = true;   // Command sent to tuner

////////////////////////////////////////////////////////////////////////////////////////////////////

// Initial variable settings
let toastWarningPercentage = Math.floor((inactivityLimit * 60) * 0.9); // Toast warning popup at 90% idle limit
let inactivityTime = 0;
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
    if (consoleDebug) console.log(`Inactivity Monitor idle for ${inactivityTime / 1000} second(s)`);
    if ((inactivityTime / 1000) === toastWarningPercentage && typeof sendToast === 'function' && enableToasts) {
        setTimeout(function() {
            sendToast('warning', 'Inactivity Monitor', `You are currently idle!`, false, false);
        }, 400);
    }
    if (inactivityTime >= inactivityLimit * 60 * 1000) {
        showPopup(); // Show the popup if inactive
    }
};

// Display popup
const showPopup = () => {
    if (!popupDisplayed) {
        popupDisplayed = true; // Prevent multiple popups
        const userResponse = alert("Are you still there?", "Yes");

        // Popup timeout
        popupTimeout = setTimeout(() => {
            executeCode();
        }, popupWaitTime * 1000);
    }
};

const executeCode = () => {
    console.warn("User is inactive...");
    window.location.href = '/403?msg=Automatically+kicked+for+inactivity.';
};

// Check if administrator code
var isTuneAuthenticated = false;

document.addEventListener('DOMContentLoaded', () => {
    checkAdminMode();
});

function checkAdminMode() {
    const bodyText = document.body.textContent || document.body.innerText;
    isTuneAuthenticated = bodyText.includes("You are logged in as an administrator.") || bodyText.includes("You are logged in as an adminstrator.") ||bodyText.includes("You are logged in and can control the receiver.");
    if (isTuneAuthenticated) {
      cancelTimer(`Inactivity Monitor detected administrator logged in, plugin inactive.`, `You are logged in and whitelisted, enjoy!`);
    }
}

// Wait until sendToast has been defined
let toastQueue = [];
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

// Function to cancel the timer
function cancelTimer(reason, reasonToast) {
    clearInterval(intervalInactivity);

    if (typeof sendToast === 'function' && enableToasts) {
        sendToast('info', 'Inactivity Monitor', reasonToast, false, false);
    } else {
        toastQueue.push(['info', 'Inactivity Monitor', reasonToast, false, false]);

        // Start timeout only once
        if (!toastTimeout) {
            toastTimeout = setTimeout(() => {
                toastQueue = []; // Clear queue if timeout reached
                console.warn('Inactivity Monitor toast notifications not ready.');
            }, toastMaxWaitTime);
            setInterval(processToastQueue, 100); // Check periodically for sendToast
        }
    }

    console.log(reason);
}

const intervalInactivity = setInterval(checkInactivity, 1000); // Update every second

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
                        cancelTimer(`Inactivity Monitor IP address is whitelisted, plugin inactive.`, `IP address whitelisted, enjoy!`);
                    }
                    // Close WebSocket after receiving response
                    console.log("Inactivity Monitor IP address validated, WebSocket no longer required, closing connection.");
                    wsSendSocket.close();
                })
                .catch(error => {
                    console.error('Inactivity Monitor WebSocket failed to validate IP address:', error);
                    wsSendSocket.close();
                });
            };

            wsSendSocket.onerror = (error) => {
                console.error("Inactivity Monitor WebSocket error:", error);
                setTimeout(setupSendSocket, 10000); // Retry WebSocket setup after 10 seconds
            };

            wsSendSocket.onclose = () => {
            };
        } catch (error) {
            console.error("Inactivity Monitor WebSocket failed to setup WebSocket:", error);
            setTimeout(setupSendSocket, 10000); // Retry WebSocket setup after 10 seconds
        }
    }
}

// Initialise WebSocket connection
setupSendSocket();

/*
    Themed Popups v1.1.1 by AAD
    https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Themed-Popups
*/

document.addEventListener('DOMContentLoaded', () => {
  // If Themed Popups plugin is not installed
  if (typeof pluginThemedPopup === 'undefined') {
    var styleElement = document.createElement('style');
    var cssCodeThemedPopups = `
    /* Themed Popups CSS */
    .popup {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: var(--color-2); /* Background */
        color: var(--color-main-bright); /* Text */
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
        opacity: 0;
        transition: opacity 0.3s ease-in;
        z-index: 9999;
    }

    .popup-content {
        text-align: center;
    }

    .popup button {
        margin-top: 10px;
    }

    .popup.open {
        opacity: .99;
    }
    `;
    styleElement.appendChild(document.createTextNode(cssCodeThemedPopups));
    document.head.appendChild(styleElement);
  }
});

const isClickedOutsidePopupPluginInactivityMonitor = true;

function alert(popupMessage, popupButton) {
    if (typeof popupButton === 'undefined') {
        popupButton = 'OK';
    }
    if (!popupOpened) { // Check if a popup is not already open
        popup = document.createElement('div');
        popup.classList.add('popup');
        popup.innerHTML = `<div class="popup-content">${popupMessage.replace(/\n/g, '<br>')}<button id="popup-close">${popupButton}</button></div>`;
        document.body.appendChild(popup);

        var closeButton = popup.querySelector('#popup-close');
        closeButton.addEventListener('click', closePopup);

        popup.addEventListener('click', function(event) {
            event.stopPropagation(); // Prevent event propagation
        });

        // Trigger the fade-in effect
        setTimeout(function() {
            popup.classList.add('open');
            popupOpened = true; // Set popupOpened flag to true
            blurBackground(true);
        }, 10);
    }
}

function blurBackground(status) {
    // Blur background
    if (status === true) {
      if (idModal) {
          idModal.style.display = 'block';
        setTimeout(function() {
          idModal.style.opacity = '1';
        }, 40);
      }
    } else {
      // Restore background
      if (idModal) {
        setTimeout(function() {
          idModal.style.display = 'none';
        }, 400);
          idModal.style.opacity = '0';
      }
    }
}

var popupOpened = false;
var popup;

var popupPromptOpened = false;
var idModal = document.getElementById('myModal');

// Function to close the popup
function closePopup(event) {
    event.stopPropagation(); // Prevent event propagation
    popupOpened = false; // Set popupOpened flag to false
    popup.classList.remove('open'); // Fade out
    setTimeout(function() {
        popup.remove();
        blurBackground(false);
    }, 300); // Remove after fade-out transition
    console.log("Inactivity Monitor popup closed, user active.");

    // Reset if popup is closed
    clearTimeout(popupTimeout);
    popupDisplayed = false; // Reset popup flag
    resetTimer();
}

// Event listener for ESC key to close popup
document.addEventListener('keydown', function(event) {
    if (popupOpened && (event.key === 'Escape' || event.key === 'Enter')) {
        closePopup(event);
        blurBackground(false);
    }
});

if (isClickedOutsidePopupPluginInactivityMonitor) {
  // Event listener for clicks outside the popup to close it
  document.addEventListener('click', function(event) {
      if (popupOpened && !popup.contains(event.target)) {
          closePopup(event);
          blurBackground(false);
      }
  });
}

})();
