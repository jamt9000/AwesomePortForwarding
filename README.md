# Awesome Port Forwarding

Work-in-progress UI for forwarding ports. Inspired by VSCode's Remote SSH port forwarding, but without needing a new IDE window for each remote machine.

<img src="https://i.imgur.com/7xIasX8.png" width=400>

**Features:**

* Connect to hosts given in `~/.ssh/config` file
* Favicons!

**TODO:**

- [ ] Support password and other auth besides public key
- [ ] Open a terminal on the given remote
- [ ] Ability to refresh the connections and close existing ones
- [ ] Check when connections die
- [ ] Don't hang when something goes wrong 🙃

## Installing

```
git clone https://github.com/jamt9000/AwesomePortForwarding/
cd AwesomePortForwarding
npm install
./launch.sh
```

Requires `nc` on the local machine and `lsof` or `netstat` on the remote machines.

