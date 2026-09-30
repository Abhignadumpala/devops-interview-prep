const http = require('http');

function add(a, b) {
  return a + b;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  http
    .createServer((req, res) => res.end('Hello, world!'))
    .listen(port, () => console.log(`Server running on port ${port}`));
}

module.exports = { add };
