# Awesome Port Forwarding

Work-in-progress UI for forwarding ports. Inspired by VSCode's Remote SSH port forwarding, but without needing a new IDE window for each remote machine.

<img src="https://i.imgur.com/7xIasX8.png" width=400>

**Features:**

* Connect to hosts given in `~/.ssh/config` file
* Favicons!

**TODO:**

- [x] Support password and other auth besides public key [if ssh-askpass works]
- [x] Open a terminal on the given remote
- [x] Ability to refresh the connections and close existing ones
- [x] Check when connections die [kinda]
- [x] Don't hang when something goes wrong 🙃
- [x] Mount a remote with sshfs
- [x] Show #gpus?
- [ ] Forward a port that is not listed
- [ ] Connect to hosts with a wildcard in ssh config

## Installing

It should work on MacOS and Linux with npm installed (eg. `brew install node` if you use homebrew)

```sh
git clone https://github.com/jamt9000/AwesomePortForwarding/
cd AwesomePortForwarding
npm install
./launch.sh # or `npm start` to run with debug output in the terminal
```

Requires `nc` and `ssh` (from OpenSSH) on the local machine and `lsof` or `netstat` on the remote machines.



Cat icon by <a href="http://www.freepik.com/" title="Freepik">Freepik</a> from <a href="https://www.flaticon.com/free-icon/cat_616596" title="Flaticon">www.flaticon.com</a>
