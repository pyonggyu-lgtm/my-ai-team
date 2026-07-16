const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: require('../package.json').version,
  });
});

module.exports = app;
