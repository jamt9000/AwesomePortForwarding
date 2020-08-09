const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const SSHConfig = require('ssh-config');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync, execSync } = require('child_process');
const getFavicons = require('get-website-favicon')
const tcpPortUsed = require('tcp-port-used');



let win;

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

    sshConfigPath = path.join(process.env.HOME, '.ssh/config')
    sshConfig = SSHConfig.parse(fs.readFileSync(sshConfigPath, 'utf8'));

    console.log('Got ssh config');

    win.webContents.on('did-finish-load', () => {
        console.log('renderer loaded');
        const hostsList = sshConfigToHosts(sshConfig);
        win.webContents.send('updateHostsList', hostsList);
    });

    // Open external links in browser
    win.webContents.on('new-window', function (e, url) {
        e.preventDefault();
        require('electron').shell.openExternal(url);
    });

    // load the index.html of the app.
    win.loadFile('index.html')

    // Open the DevTools.
    win.webContents.openDevTools()
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

const subprocesses = [];

async function waitForTunnel(spawnedProc, hostName, remotePort, localPort) {

    const tries = 10;
    const pid = spawnedProc.pid;
    const re = new RegExp('' + pid, "g");
    let succ = false;

    for (var i = 0; i < tries; i++) {
        console.log('Try ' + i + ' pid ' + pid);

        const sshprocs = '' + execSync("lsof -i -n | grep ssh | awk '{print $2}'");
        const count = (sshprocs.match(re) || []).length;

        if (count >= 3) {
            succ = true;
            break;
        }

        // Sleep 1s
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (succ) {
        console.log('Tunnel established')
        getFavicons('http://localhost:' + remotePort).then((favicons) => {
            win.webContents.send('forwardingSuccessful', hostName, remotePort, localPort, favicons);
        });
    }
}


ipcMain.on('forwardPort', (event, hostName, remotePort) => {
    console.log('Forward ' + hostName + ':' + remotePort);
    let localPort = parseInt(remotePort);

    while (true) {
        let portUsed = undefined;
        tcpPortUsed.check(localPort);

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


    //console.log(sub)
});

ipcMain.on('getRemotePorts', (event, hostName) => {
    const spawned = spawnSync('ssh', [hostName, '-C', 'lsof -i -P -n -sTCP:LISTEN']);
    const output = '' + spawned.stdout;

    console.log(output);

    const rows = output.split('\n');
    const procInfo = [];
    for (var i = 1; i < rows.length; i++) {
        const fields = rows[i].split(/ +/);
        if (fields.length < 8) { continue }
        console.log(fields);
        const port = fields[8].split(':').pop();
        const entry = { "command": fields[0], "user": fields[2], "pid": fields[1], "port": port };
        procInfo.push(entry);
    }

    event.returnValue = procInfo;

});
