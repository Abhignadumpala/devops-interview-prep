const express = require('express');

const { add, subtract, multiply, divide } = require('./services/calculator');

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Node.js CI/CD application is running',
    status: 'success',
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'nodejs-ci-demo',
  });
});

app.get('/api/add', (req, res) => {
  const a = Number(req.query.a);
  const b = Number(req.query.b);

  res.json({
    operation: 'addition',
    result: add(a, b),
  });
});

app.get('/api/subtract', (req, res) => {
  const a = Number(req.query.a);
  const b = Number(req.query.b);

  res.json({
    operation: 'subtraction',
    result: subtract(a, b),
  });
});

app.get('/api/multiply', (req, res) => {
  const a = Number(req.query.a);
  const b = Number(req.query.b);

  res.json({
    operation: 'multiplication',
    result: multiply(a, b),
  });
});

app.get('/api/divide', (req, res) => {
  const a = Number(req.query.a);
  const b = Number(req.query.b);

  try {
    const result = divide(a, b);

    res.json({
      operation: 'division',
      result,
    });
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
  });
});

module.exports = app;
