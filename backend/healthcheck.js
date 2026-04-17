const http = require('http');

const healthCheck = http.request({
  host: 'localhost',
  port: process.env.PORT || 8080,
  path: '/health',
  method: 'GET',
  timeout: 2000
}, (res) => {
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

healthCheck.on('error', () => {
  process.exit(1);
});

healthCheck.end();