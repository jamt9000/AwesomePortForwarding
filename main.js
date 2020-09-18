const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron')
const SSHConfig = require('ssh-config');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync, exec, execSync } = require('child_process');
const getFavicons = require('get-website-favicon')
const getTitleAtUrl = require('get-title-at-url');
const metafetch = require('metafetch');


let win;


// Data structure representing SSH hosts,
// remote processes and forwarded ports
// as a list of 
// [{"hostName": "hostname",
//   "lastConnectionResult": "neverConnected", // or "lastConnectionFailed" or "lastConnectionSucceeded"
//   "uptime": "01:02:03 up x days ...",
//   "gpuInfo": "name, memory.free...",
//   "defaultPwd": "/home/asdf",
//   "remoteProcesses": [{ "command": "command name",
//                         "title": "title from html",
//                         "user": "username",
//                         "pid": "1234",
//                         "remotePort": "8080",
//                         "state": "forwarded", // or "unforwarded" or "dead"
//                         "sshAgentPid": 1234,
//                         "localPort": 8081,
//                         "faviconURL": 'http://...',
// }]}, ...]
let hostsState = null;

const sshConfigPath = path.join(process.env.HOME, '.ssh/config');
const sshConfigDir = path.join(process.env.HOME, '.ssh');

const subprocesses = [];

process.on('exit', function () {
    for (var i = 0; i < subprocesses.length; i++) {
        try {
            subprocesses[i].kill();
        } catch (err) {

        }
    }
});

if (process.platform == 'darwin') {
    // Mac does not natively have ssh-askpass or have an X11 DISPLAY, so we
    // need to fake it
    var sshEnv = { ...process.env, "DISPLAY": "1", "SSH_ASKPASS": path.join(__dirname, "askpass.osascript") };
} else {
    var sshEnv = { ...process.env };
}


function sshConfigToHosts(sshConfig) {
    const hosts = [];

    for (var i = 0; i < sshConfig.length; i++) {
        const entry = sshConfig[i];
        if (entry.param == "Host" && entry.value && entry.value.indexOf('*') == -1) {
            hosts.push(entry.value);
        }
    }

    return hosts;
}

function createWindow() {
    // Create the browser window.
    win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true
        }
    })

    // Open external links in browser
    win.webContents.on('new-window', function (e, url) {
        e.preventDefault();
        require('electron').shell.openExternal(url);
    });

    // load the index.html of the app.
    win.loadFile('index.html')

    // Open the DevTools.
    // win.webContents.openDevTools()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow)

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

function getProcessFromList(processList, remotePort) {
    let processEntry = null;
    for (var j = 0; j < processList.length; j++) {
        if (processList[j]['remotePort'] == remotePort) {
            processEntry = processList[j];
        }
    }
    return processEntry;
}

function getHostEntry(hostsState, hostName) {
    let hostEntry = null;
    for (var i = 0; i < hostsState.length; i++) {
        if (hostsState[i]['hostName'] == hostName) {
            hostEntry = hostsState[i];
        }
    }
    return hostEntry;
}

function getProcessEntry(hostName, remotePort) {
    let processEntry = null;

    for (var i = 0; i < hostsState.length; i++) {
        if (hostsState[i]['hostName'] == hostName) {
            processEntry = getProcessFromList(hostsState[i]['remoteProcesses'], remotePort);
        }
    }
    return processEntry;
}

function hostsStateFromConfig() {
    const sshConfig = SSHConfig.parse(fs.readFileSync(sshConfigPath, 'utf8'));
    const hostsList = sshConfigToHosts(sshConfig);
    const newHostsState = [];

    for (var i = 0; i < hostsList.length; i++) {
        const stateEntry = {
            "hostName": hostsList[i],
            "lastConnectionResult": "neverConnected",
            "uptime": null,
            "gpuInfo": null,
            "defaultPwd": null,
            "remoteProcesses": [],
        }
        newHostsState.push(stateEntry);
    }

    return newHostsState;
}

function initializeHostsState() {
    if (!fs.existsSync(sshConfigPath)) {
        dialog.showMessageBox({
            "message": "SSH Config file (" + sshConfigPath +
                ") not found. You must put the hosts you want to connect to in this file."
        });
        return;
    }

    hostsState = hostsStateFromConfig();

    if (hostsState.length == 0) {
        dialog.showMessageBox({
            "message": "No hosts found in " + sshConfigPath +
                ". You must put the hosts you want to connect to in this file. (Wildcards are currently not supported)."
        });
    }

    // Watch for changes to ssh config
    watchSshConfig();
}


function mergeHostsState(oldHostsState, newHostsState) {
    // Merge the current host state with one reloaded from
    // the ssh config file. This could get quite complicated
    // if we want to handle things like changed ip addresses
    // and deleted or renamed hosts that we are currently forwarding.
    // For now just re-associate the data when the hostnames
    // match and ignore that we could have forwardings that
    // are now invisible.

    const mergedHostsState = [];

    for (var i = 0; i < newHostsState.length; i++) {
        const matchedHost = oldHostsState == null ? null : getHostEntry(oldHostsState, newHostsState[i].hostName);
        if (matchedHost != null) {
            mergedHostsState.push(matchedHost);
        } else {
            mergedHostsState.push(newHostsState[i]);
        }
    }

    return mergedHostsState;
}

var watchingSshConfig = false;

function watchSshConfig() {
    if (!watchingSshConfig && fs.existsSync(sshConfigPath)) {
        fs.watchFile(sshConfigPath, (curr, prev) => {
            console.log('SSH config changed');
            const newHostsState = hostsStateFromConfig();
            hostsState = mergeHostsState(hostsState, newHostsState);
            win.webContents.send('updateHostsState', hostsState);
        });
        watchingSshConfig = true;
    }
}

async function waitForTunnel(spawnedProc, hostName, remotePort, localPort) {
    // Wait for the SSH tunnel to be established by repeatedly calling
    // lsof until the connection is shown (with a 1s sleep between calls),
    // timing out after 10 attempts

    const tries = 10;
    const pid = spawnedProc.pid;
    const re = new RegExp('' + pid, "g");
    let succ = false;

    for (var i = 0; i < tries; i++) {
        console.log('Try ' + i + ' pid ' + pid);

        const sshprocs = '' + execSync("lsof -P -i -n | grep '^ssh' | awk '{print $2}'");
        const count = (sshprocs.match(re) || []).length;

        // When the tunnel is established, lsof will show over two connections
        // made by the ssh process (for remote TCP port 22, local TCP on local port,
        // and possibe duplicates for ipv6)
        if (count >= 2) {
            succ = true;
            break;
        }

        // Sleep 1s
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (succ) {
        console.log('Tunnel established')
        const forwardedURL = 'http://localhost:' + remotePort;
        getFavicons(forwardedURL).then((favicons) => {
            metafetch.fetch(forwardedURL, function (err, meta) {
                let processEntry = getProcessEntry(hostName, remotePort);

                const title = meta ? (meta.title ? meta.title : null) : null;

                let faviconURL = null;
                if (favicons && favicons.icons && favicons.icons.length) {
                    faviconURL = favicons.icons[0].src;
                } else if (processEntry != null && processEntry['command'] != null) {
                    if (processEntry['command'].startsWith('python')) {
                        faviconURL = 'https://www.python.org/favicon.ico';
                    } else if (processEntry['command'].startsWith('node')) {
                        faviconURL = 'https://nodejs.org/favicon.ico';
                    } else if (processEntry['command'].startsWith('ruby')) {
                        faviconURL = 'https://www.ruby-lang.org/favicon.ico';
                    }
                }

                if (processEntry != null) {
                    processEntry['sshAgentPid'] = pid;
                    processEntry['localPort'] = localPort;
                    processEntry['faviconURL'] = faviconURL;
                    if (title) {
                        processEntry['title'] = title;
                    }
                    processEntry["state"] = "forwarded";
                }

                win.webContents.send('updateHostsState', hostsState);
            });
        });
    }
}

ipcMain.on('sshConfigEdit', event => {
    if (!fs.existsSync(sshConfigDir)) {
        fs.mkdirSync(sshConfigDir);
    }

    if (!fs.existsSync(sshConfigPath)) {
        fs.closeSync(fs.openSync(sshConfigPath, 'w'));
        watchSshConfig();
    }

    // Not very portable
    execSync('(code ~/.ssh/config || subl ~/.ssh/config || xdg-open ~/.ssh/config || open ~/.ssh/config) &');
});



ipcMain.on('requestUpdateHostsState', event => {
    if (hostsState == null) {
        initializeHostsState();
    }

    win.webContents.send('updateHostsState', hostsState);

});

ipcMain.on('forwardPort', (event, hostName, remotePort) => {
    console.log('Forward ' + hostName + ':' + remotePort);
    let localPort = parseInt(remotePort);

    while (true) {
        try {
            if (process.platform == 'darwin') {
                // Mac may need the -G option, which is
                // unavailable on Linux 
                // https://stackoverflow.com/a/60918924
                execSync('nc -z -G5 -w5 localhost ' + localPort);
            } else {
                execSync('nc -z -w5 localhost ' + localPort);
            }
            // Success means port is in use
            localPort += 1;
        } catch (err) {
            break;
        }
    }

    const fwd = '' + localPort + ':localhost:' + remotePort;
    const spawned = spawn('ssh', ['-L', fwd, hostName, '-N'], { "env": sshEnv });

    spawned.on('exit', function (errCode) {
        let procInfo = getProcessEntry(hostName, remotePort);
        if (procInfo) {
            procInfo.state = "dead";
        }
        try {
            win.webContents.send('updateHostsState', hostsState);
        } catch (err) {
            // Will fail if app is exiting
        }
    });

    subprocesses.push(spawned);

    waitForTunnel(spawned, hostName, remotePort, localPort);
});

ipcMain.on('cancelForwarding', (event, hostName, remotePort) => {
    const proc = getProcessEntry(hostName, remotePort);

    if (proc != null && proc.sshAgentPid != null) {
        execSync("kill " + proc.sshAgentPid);
    }

    win.webContents.send('updateHostsState', hostsState);
});


function mergeProcessLists(oldProcessList, newProcessList) {
    // * Add any currently-being-forwarded process info 
    //   from oldProcessList to the new newProcessList
    //
    // * If any old process no longer exists then
    //   show it as having died (?) (Not certain about this one - 
    //   a process can die but the port forwarding will stick around.
    //   There could also be a race condition where a new process is started and
    //   forwarded on the same port and gets mislabelled as dead when the old
    //   forwarding process dies)
    //
    //   processLists contain:
    //
    //   [{ "command": "command name",
    //      "title": "title from html",
    //      "user": "username",
    //      "pid": "1234",
    //      "remotePort": "8080",
    //      "state": "forwarded", // or "unforwarded" or "dead"
    //      "sshAgentPid": 1234,
    //      "localPort": 8081,
    //      "faviconURL": 'http://...'}, ...]

    let mergedList = [];
    let remotePortsMerged = [];

    for (var i = 0; i < newProcessList.length; i++) {
        let mergedInfo = {};
        Object.assign(mergedInfo, newProcessList[i]);

        let oldInfo = getProcessFromList(oldProcessList, mergedInfo["remotePort"]);

        console.log(oldInfo)

        if (oldInfo && oldInfo["state"] == "forwarded") {
            mergedInfo["title"] = oldInfo["title"];
            mergedInfo["state"] = oldInfo["state"];
            mergedInfo["sshAgentPid"] = oldInfo["sshAgentPid"];
            mergedInfo["localPort"] = oldInfo["localPort"];
            mergedInfo["faviconURL"] = oldInfo["faviconURL"];
        }

        mergedList.push(mergedInfo);
        remotePortsMerged.push(mergedInfo["remotePort"]);
    }

    for (var j = 0; j < oldProcessList.length; j++) {
        let oldPort = oldProcessList[j]["remotePort"];

        if (remotePortsMerged.indexOf(oldPort) == -1 && oldProcessList[j]["state"] != "dead") {
            // A process we used to be showing no longer exists
            let mergedInfo = {};
            Object.assign(mergedInfo, oldProcessList[j]);
            mergedInfo["state"] = "dead";

            mergedList.push(mergedInfo);
            //remotePortsMerged.push(mergedInfo["remotePort"]);
        }
    }

    return mergedList;
}


ipcMain.on('getRemotePorts', (event, hostName) => {
    // Find the listening ports on the remote machine
    // and if possible find which process it is
    // We first try lsof, which may not show all ports
    // without sudo, and then we try netstat

    const lsofCommand = "lsof -iTCP -P -n -sTCP:LISTEN"
    const netstatCommand = "netstat -anp tcp | grep '^tcp' | grep '\\bLISTEN\\b'"
    const sshCommand = 'ssh ' + hostName + ' -o NumberOfPasswordPrompts=1 -C "' + lsofCommand + ' ; echo AWESOME_SSH_SENTINEL ; ' + netstatCommand +
        ' ; echo AWESOME_SSH_SENTINEL ; uptime ; echo AWESOME_SSH_SENTINEL ; pwd ; echo AWESOME_SSH_SENTINEL ; nvidia-smi --query-gpu=name,memory.free --format=csv' + '"';

    console.log(sshCommand);

    const spawned = exec(sshCommand,
        { "env": sshEnv, "timeout": 20000 },

        function (err, stdout, stderr) {
            let output = '' + stdout;
            let code = err ? err.code : 0;

            console.log(output);

            if (code == 255 || code == null) {
                // Connecting failed (255) or timed out (null status)
                // (don't fail on other exit codes since commands could
                // fail or not exist even if the connection works)
                console.log(`error code ${code}`);
                getHostEntry(hostsState, hostName)['lastConnectionResult'] = 'lastConnectionFailed';
                win.webContents.send('updateHostsState', hostsState);
                return;
            }

            const parts = output.split('AWESOME_SSH_SENTINEL')

            const lsofOutput = parts[0];
            const netstatOutput = parts[1];
            const uptime = parts[2].indexOf('up') == -1 ? null : parts[2].trim();
            const pwd = parts[3].trim();
            const gpuInfo = parts[4].indexOf('MiB') == -1 ? null : parts[4].trim();

            const rows = lsofOutput.split('\n');
            const processList = [];
            var portsUsed = [];

            for (var i = 1; i < rows.length; i++) {
                const fields = rows[i].split(/ +/);
                if (fields.length < 8) { continue }
                console.log(fields);
                const port = fields[8].split(':').pop();

                if (parseInt(port) > 9999) {
                    // Skip high port numbers
                    continue;
                }

                if (portsUsed.indexOf(port) != -1) {
                    // Skip duplicate ports (due to ipv4 and ipv6)
                    continue;
                }

                portsUsed.push(port);

                const entry = {
                    "command": fields[0], "title": null, "user": fields[2], "pid": fields[1],
                    "remotePort": port, "localPort": null, "sshAgentPid": null,
                    "faviconURL": null, "state": "unforwarded"
                };
                processList.push(entry);
            }

            // lsof may not show all processes without sudo
            // netstat can show the open ports (without the PID)
            // although the flags and output are not consistent cross-platform
            // so this is an attempt to support both linux and macos/bsd

            const ns_rows = netstatOutput.split('\n');

            for (var i = 0; i < ns_rows.length; i++) {
                const fields = ns_rows[i].split(/ +/);
                if (fields.length < 3) { continue }

                console.log(fields);

                const port = fields[3].split(/[:\.]+/).pop();
                const portInt = parseInt(port);

                if ((portInt < 1000 || portInt > 9999) && portInt != 80 && portInt != 443) {
                    // Skip high/low port numbers except http(s)
                    continue;
                }

                if (portsUsed.indexOf(port) != -1) {
                    // Skip duplicate ports (due to ipv4 and ipv6) or already
                    // found by lsof approach
                    continue;
                }

                portsUsed.push(port);

                const entry = {
                    "command": null, "title": null, "user": null, "pid": null,
                    "remotePort": port, "localPort": null, "sshAgentPid": null,
                    "faviconURL": null, "state": "unforwarded"
                };
                processList.push(entry);
            }

            // Update hosts state with the remote processes
            for (var i = 0; i < hostsState.length; i++) {
                if (hostsState[i]['hostName'] == hostName) {
                    let newProcessList;

                    if (hostsState[i]['remoteProcesses'].length) {
                        console.log('merge process lists');
                        newProcessList = mergeProcessLists(hostsState[i]['remoteProcesses'], processList);
                    } else {
                        newProcessList = processList;
                    }

                    hostsState[i]['remoteProcesses'] = newProcessList;
                    hostsState[i]['lastConnectionResult'] = "lastConnectionSucceeded";
                    hostsState[i]['uptime'] = uptime;
                    hostsState[i]['gpuInfo'] = gpuInfo;
                    hostsState[i]['defaultPwd'] = pwd;
                }
            }

            win.webContents.send('updateHostsState', hostsState);
        });
});

ipcMain.on('openTerminal', (event, hostName) => {
    if (process.platform == 'darwin') {
        spawnSync('open', ['ssh://' + hostName]);
    } else {
        exec(`gnome-terminal -- bash -c "ssh ${hostName}; exec bash" || xterm -hold -e 'ssh ${hostName}'`);
    }
});

ipcMain.on('openVSCode', (event, hostName) => {
    try {
        execSync('code --remote ssh-remote+' + hostName + ' .')
    } catch (e) {
        dialog.showMessageBox({
            "message": "Could not launch VSCode. Make sure it is installed and the `code` command is set up."
        });
    }
});


ipcMain.on('openCyberduck', (event, hostName) => {
    try {
        execSync('open -a Cyberduck sftp://' + hostName);
    } catch (e) {
        dialog.showMessageBox({
            "message": "Could not launch Cyberduck. Make sure it is installed in /Applications. You can install it from https://cyberduck.io/"
        });
    }
});

ipcMain.on('openNautilus', (event, hostName) => {
    try {
        execSync(`nautilus sftp://${hostName} || xdg-open sftp://${hostName}`);
    } catch (e) {
        dialog.showMessageBox({
            "message": "Could not launch. Make sure nautilus is installed or the sftp:// handler is configured."
        });
    }
});

ipcMain.on('openNvidiaSmi', (event, hostName) => {
    const cmd = "watch -n1 nvidia-smi";
    if (process.platform == 'darwin') {
        const applescript = `tell application "Terminal"\nactivate\ndo script "ssh ${hostName} -t -C '${cmd}'"\nend tell`;
        console.log(applescript);
        spawnSync('osascript', ['-e', applescript]);
    } else {
        exec(`gnome-terminal -- bash -c "ssh ${hostName} -t -C '${cmd}'; exec bash" || xterm -hold -e "ssh ${hostName} -t -C '${cmd}'"`);
    }
});

ipcMain.on('openSSHFS', (event, hostName) => {
    let pwd = getHostEntry(hostsState, hostName)['defaultPwd'];
    pwd = pwd ? pwd : "";

    let mountDir = `~/ssh_mounts/${hostName}`;
    const cmd = `mkdir -p ${mountDir}; ` +
                `umount ${mountDir} 2>&- ; ` +
                `sshfs -o allow_other,default_permissions,noappledouble,volname=${hostName} ${hostName}:/ ${mountDir} ;` +
                `echo '\\nLaunching Finder. To unmount run:\\numount ${mountDir} ' ;` + 
                `xdg-open ${mountDir}/${pwd} 2>&- || open ${mountDir}/${pwd}`

    try {
        execSync('which sshfs');
    } catch(err) {
        dialog.showMessageBox({
            "message": "Could not find the sshfs command. Make sure it is installed."
        });
        return;
    }

    // Run in a terminal so the user can see the command, enter a password if needed, and check if anything breaks
    if (process.platform == 'darwin') {
        const applescript = `tell application "Terminal"\nactivate\ndo script "${cmd}"\nend tell`;
        console.log(applescript);
        spawnSync('osascript', ['-e', applescript]);
    } else {
        exec(`gnome-terminal -- bash -c "${cmd}; exec bash" || xterm -hold -e "${cmd}"`);
    }
});
