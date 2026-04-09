#!/bin/bash
# AS500 tmux startup session
# Creates a named session with monitoring panels.
# Safe to run manually too - won't create a duplicate session.

SESSION="as500"

# Don't create if session already exists
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already exists. Attaching..."
  tmux attach -t "$SESSION"
  exit 0
fi

# Wait for Docker to be ready
until docker info >/dev/null 2>&1; do
  sleep 2
done

# Wait for containers to be up
until docker ps --format '{{.Names}}' | grep -q as500-app-1; do
  sleep 2
done

# Create session with first window: app logs (top-left)
tmux new-session -d -s "$SESSION" -x 220 -y 50 -n monitor

# Top-left: app logs
tmux send-keys -t "$SESSION:monitor.0" "docker logs -f as500-app-1" Enter

# Top-right: postgres logs
tmux split-window -t "$SESSION:monitor" -h
tmux send-keys -t "$SESSION:monitor.1" "docker logs -f as500-postgres-1" Enter

# Bottom-left: htop
tmux split-window -t "$SESSION:monitor.0" -v
tmux send-keys -t "$SESSION:monitor.2" "htop" Enter

# Bottom-right: backup log + shell
tmux split-window -t "$SESSION:monitor.1" -v
tmux send-keys -t "$SESSION:monitor.3" "tail -f /var/log/as500-backup.log" Enter

# Even out the pane sizes
tmux select-layout -t "$SESSION:monitor" tiled

# Add a second window as a plain shell
tmux new-window -t "$SESSION" -n shell
tmux send-keys -t "$SESSION:shell" "cd /var/www/AS500" Enter

# Start on the monitor window
tmux select-window -t "$SESSION:monitor"

echo "Session '$SESSION' created."
