const http = require('http');

const app = http.createServer((req, res) => res.end('Hello, world!'));

module.exports = app;
