# Awesome Port Forwarding

Work-in-progress UI for forwarding ports. Inspired by VSCode's Remote SSH port forwarding, but without needing a new IDE window for each remote machine.

<img src="https://i.imgur.com/7xIasX8.png" width=400>

**Features:**

* Connect to hosts given in `~/.ssh/config` file
* Favicons!

**TODO:**

- [x] Support password and other auth besides public key [if ssh-askpass works]
- [ ] Open a terminal on the given remote
- [ ] Ability to refresh the connections and close existing ones
- [x] Check when connections die [kinda]
- [ ] Don't hang when something goes wrong 🙃
- [ ] Mount a remote with sshfs

## Installing

It should work on MacOS and Linux with npm installed (eg. `brew install node` if you use homebrew)

```
git clone https://github.com/jamt9000/AwesomePortForwarding/
cd AwesomePortForwarding
npm install
./launch.sh
```

Requires `nc` and `ssh` (from OpenSSH) on the local machine and `lsof` or `netstat` on the remote machines.

