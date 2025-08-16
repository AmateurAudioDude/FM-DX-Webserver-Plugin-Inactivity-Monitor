# Inactivity Monitor plugin for FM-DX Webserver

This plugin monitors for webpage user inactivity over a specified period of time before a popup asks the user if they are still there, once the timer has expired. If no response, the user is then automatically kicked from the server. _Timer is inactive for whitelisted IP addresses, and users logged in with administrator or tuner privileges._

![image](https://github.com/user-attachments/assets/51acf67a-1505-4c08-8b62-21665cb25d93)

* [Download the latest zip file](https://github.com/AmateurAudioDude/FM-DX-Webserver-Plugin-Inactivity-Monitor/archive/refs/heads/main.zip)
* Transfer `InactivityMonitor` folder, and `InactivityMonitor.js` to FM-DX Webserver `plugins` folder
* Customise settings in `pluginInactivityMonitor.js`
* Restart FM-DX Webserver if required
* Login to Adminstrator Panel and enable plugin
* Restart FM-DX Webserver again if required
* Configure `InactivityMonitor.json` for whitelisted IP addresses

**Client-side configuration options found in `pluginInactivityMonitor.js`**   
**Server-side configuration options found in `InactivityMonitor.json`**

IP addresses can be whitelisted inside `InactivityMonitor.json`, located in the `plugins_configs` folder. Changes made to the config file take immediate effect, so there's no need to restart the server after an edit.


v1.1.5
------
* Added temporary ban option in minutes (in InactivityMonitor.json) for user exceeding `sessionLimit` value

v1.1.4
------
* Added option to halt timer while only one user is connected and resume with two or more users

v1.1.3
------
* Wildcard permitted for whitelisted IP addresses
* `::ffff:` no longer required for local addresses

v1.1.2
------
* Fix for FM-DX Webserver v1.3.4 compatibility issues

v1.1.1
------
* Added option to include session limit that ignores activity

v1.1.0
------
* Added IP address whitelist function
* Added optional toast notifications for 90% idle warning, and whitelisted IP address

v1.0.1
------
* Included tune password for timer bypass

v1.0.0
------
* Initial release
