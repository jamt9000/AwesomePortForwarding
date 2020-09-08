const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const SSHConfig = require('ssh-config');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync, execSync } = require('child_process');
const getFavicons = require('get-website-favicon')


let win;


// Data structure representing SSH hosts,
// remote processes and forwarded ports
// as a list of 
// [{"hostName": "hostname",
//   "remoteProcesses": [{ "command": "command name",
//                         "user": "username",
//                         "pid": "1234",
//                         "port": "8080" }]}, ...]

let hostsState = null;
const subprocesses = [];


function sshConfigToHosts(sshConfig) {
    const hosts = [];

    for (var i = 0; i < sshConfig.length; i++) {
        const entry = sshConfig[i];
        if (entry.param == "Host" && entry.value.indexOf('*') == -1) {
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


async function waitForTunnel(spawnedProc, hostName, remotePort, localPort) {

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
        getFavicons('http://localhost:' + remotePort).then((favicons) => {

            let processEntry = null;

            for (var i = 0; i < hostsState.length; i++) {
                if (hostsState[i]['hostName'] == hostName) {
                    for (var j = 0; j < hostsState[i]['remoteProcesses'].length; j++) {
                        if (hostsState[i]['remoteProcesses'][j]['remotePort'] == remotePort) {
                            processEntry = hostsState[i]['remoteProcesses'][j];
                        }
                    }
                }
            }

            let faviconURL = null;
            if (favicons && favicons.icons && favicons.icons.length) {
                faviconURL = favicons.icons[0].src;
            } else if (processEntry != null && processEntry['command'].startsWith('python')) {
                faviconURL = 'https://www.python.org/favicon.ico';
            } else if (processEntry != null && processEntry['command'].startsWith('node')) {
                faviconURL = 'https://nodejs.org/favicon.ico';
            }

            if (processEntry != null) {
                processEntry['sshAgentPid'] = pid;
                processEntry['localPort'] = localPort;
                processEntry['faviconURL'] = faviconURL;
            }


            win.webContents.send('updateHostsState', hostsState);


        });
    }
}

ipcMain.on('requestUpdateHostsState', event => {
    if (hostsState == null) {
        const sshConfigPath = path.join(process.env.HOME, '.ssh/config')
        const sshConfig = SSHConfig.parse(fs.readFileSync(sshConfigPath, 'utf8'));
        const hostsList = sshConfigToHosts(sshConfig);

        hostsState = [];

        for (var i = 0; i < hostsList.length; i++) {
            const stateEntry = { "hostName": hostsList[i], "remoteProcesses": [] }
            hostsState.push(stateEntry);
        }
    }


    win.webContents.send('updateHostsState', hostsState);

});

ipcMain.on('forwardPort', (event, hostName, remotePort) => {
    console.log('Forward ' + hostName + ':' + remotePort);
    let localPort = parseInt(remotePort);

    while (true) {
        try {
            console.log(execSync('nc -z -G5 -w5 localhost ' + localPort));
            // Success means port is in use
            localPort += 1;
        } catch (err) {
            break;
        }
    }

    const fwd = '' + localPort + ':localhost:' + remotePort;
    const spawned = spawn('ssh', ['-L', fwd, hostName, '-N']);

    subprocesses.push(spawned);

    waitForTunnel(spawned, hostName, remotePort, localPort);
});

ipcMain.on('getRemotePorts', (event, hostName) => {
    const spawned = spawnSync('ssh', [hostName, '-C', 'lsof -i -P -n -sTCP:LISTEN']);
    const output = '' + spawned.stdout;

    console.log(output);

    const rows = output.split('\n');
    const procInfo = [];
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
            "command": fields[0], "user": fields[2], "pid": fields[1],
            "remotePort": port, "localPort": null, "sshAgentPid": null,
            "faviconURL": null
        };
        procInfo.push(entry);
    }

    // Update hosts state with the remote processes
    for (var i = 0; i < hostsState.length; i++) {
        if (hostsState[i]['hostName'] == hostName) {
            hostsState[i]['remoteProcesses'] = procInfo;
        }
    }

    win.webContents.send('updateHostsState', hostsState);
});
