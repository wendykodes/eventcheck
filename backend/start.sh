#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20.20.2
export PATH="$NVM_DIR/versions/node/v20.20.2/bin:$PATH"
PORT=5175 npm run dev
