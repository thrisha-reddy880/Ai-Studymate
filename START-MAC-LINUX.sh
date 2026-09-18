#!/usr/bin/env bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install Node.js, then run this file again."
  exit 1
fi
if [ ! -d node_modules ]; then npm install || exit 1; fi
npm start
