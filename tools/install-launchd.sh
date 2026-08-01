#!/bin/bash
#
# Generates the launchd plist from THIS checkout and loads it.
#
# The old plist hardcoded one machine's home directory and Homebrew prefix, so
# a fresh clone installed a job that pointed at a path which did not exist -
# and launchd reports that by doing nothing at all. This resolves both at
# install time instead.
#
#   Usage:  bash tools/install-launchd.sh
#
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$PROJECT/launchd/com.claude-usage-poller.plist.template"
LABEL="com.claude-usage-poller"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
OLD_LABEL="com.ivan.claude-usage-poller"

# launchd needs an absolute interpreter path; $PATH is near-empty under it.
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "error: node not found on PATH. Install Node, or edit NODE in this script." >&2
  exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
  echo "error: template missing at $TEMPLATE" >&2
  exit 1
fi

# The checkout path may contain spaces or & - substitute in awk, not sed, so we
# do not have to reason about escaping the replacement text.
mkdir -p "$HOME/Library/LaunchAgents"
awk -v node="$NODE" -v project="$PROJECT" '
  { gsub(/__NODE__/, node); gsub(/__PROJECT__/, project); print }
' "$TEMPLATE" > "$TARGET"

# Retire the old per-user label if a previous install left it running.
# Capture first rather than piping into `grep -q`: grep exits at the first
# match, launchctl takes SIGPIPE, and under `set -o pipefail` the whole
# condition then reads as false - so the old job silently survived.
LOADED="$(launchctl list || true)"
if printf '%s' "$LOADED" | grep -q "$OLD_LABEL"; then
  echo "Unloading previous job ($OLD_LABEL)…"
  launchctl unload "$HOME/Library/LaunchAgents/$OLD_LABEL.plist" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$OLD_LABEL.plist"
fi

launchctl unload "$TARGET" 2>/dev/null || true
launchctl load "$TARGET"

echo "Installed $TARGET"
echo "  node:    $NODE"
echo "  project: $PROJECT"
echo
echo "Now set this line at the top of widget/claude-usage.jsx:"
echo
echo "  const PROJECT = \"$PROJECT\";"
echo
echo "Check it ran:  tail -n 20 \"$PROJECT/poller.log\""
