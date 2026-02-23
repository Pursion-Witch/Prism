const fs = require('fs');
const path = require('path');

const distServer = path.join(__dirname, 'dist/server.js');

if (fs.existsSync(distServer)) {
  require(distServer);
} else {
  require('ts-node/register');
  require('./src/server.ts');
}