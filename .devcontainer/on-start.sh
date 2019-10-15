#!/bin/bash
# Start up dbus
sudo dbus-daemon --system &
dbus-daemon --session --address=unix:abstract=/tmp/dbus-session &

# Keep container running
sleep infinity
