#!/bin/bash
# Launch without a controlling TTY
# This is useful if you want it to persist when the terminal closes
# and to convince SSH to ask for passwords with a popup box
# instead of in the terminal

# SSH is quite picky about when it considers itself to be detached
# (it is not enough for stdin to be not-a-tty, since it does some
#  magic to talk to the tty directly to get the password securely)
# https://unix.stackexchange.com/a/261737

# So we must use these tricks. setsid works on Linux but
# is not normally on macos, so we instead use open
# to re-launch the current script

#export PATH=/usr/local/Cellar/util-linux/2.36/bin/:$PATH

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $DIR

if [ "$PPID" -eq 1 ]; then
    echo "Child of init"
    npm start
else
    echo "Child of controlling terminal"
    if command -v setsid ; then
        echo "Using setsid"
        setsid npm start 0>&- 1>&- 2>&- &
    elif [ "$(uname)" == "Darwin" ]; then
        echo "Using open"
        open -a $PWD/launch.sh
    else
        echo "Failed to detach"
        npm start 
    fi
fi
