#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20.20.2
export PATH="$NVM_DIR/versions/node/v20.20.2/bin:$PATH"
cd "$(dirname "$0")"
rm -rf node_modules package-lock.json
npm install
