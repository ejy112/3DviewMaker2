#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Gets a freshly-cloned container to the point where `npm run lint`, `npm run dev`
# and browser verification all work without any manual setup.
set -euo pipefail

# Local machines already have their own working setup — only bootstrap the remote container.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm install (not ci) so the post-hook container snapshot can be reused across sessions.
npm install --no-audit --no-fund

# Playwright is preinstalled globally in this image along with its browsers
# (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers), but it is deliberately NOT a dependency of this
# project. Without a link, `import { chromium } from 'playwright'` fails to resolve from the repo
# root, and every `npm install` wipes a hand-made link — so re-create it here on every session.
GLOBAL_NODE_MODULES="$(npm root -g)"
if [ -d "$GLOBAL_NODE_MODULES/playwright" ]; then
  mkdir -p node_modules
  ln -sfn "$GLOBAL_NODE_MODULES/playwright" node_modules/playwright
  ln -sfn "$GLOBAL_NODE_MODULES/playwright-core" node_modules/playwright-core 2>/dev/null || true
fi
