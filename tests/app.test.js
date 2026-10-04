const request = require('supertest');
const app = require('../src/app');

describe('API Tests', () => {
  test('GET / should return application status', async () => {
    const response = await request(app).get('/');

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('success');
  });

  test('GET /health should return UP', async () => {
    const response = await request(app).get('/health');

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('UP');
  });

  test('GET /api/add should return correct result', async () => {
    const response = await request(app).get('/api/add').query({ a: 20, b: 10 });

    expect(response.statusCode).toBe(200);
    expect(response.body.result).toBe(30);
  });

  test('GET /api/subtract should return correct result', async () => {
    const response = await request(app).get('/api/subtract').query({ a: 20, b: 10 });

    expect(response.statusCode).toBe(200);
    expect(response.body.result).toBe(10);
  });

  test('GET /api/multiply should return correct result', async () => {
    const response = await request(app).get('/api/multiply').query({ a: 20, b: 10 });

    expect(response.statusCode).toBe(200);
    expect(response.body.result).toBe(200);
  });

  test('GET /api/divide should return correct result', async () => {
    const response = await request(app).get('/api/divide').query({ a: 20, b: 10 });

    expect(response.statusCode).toBe(200);
    expect(response.body.result).toBe(2);
  });

  test('GET /api/divide should reject division by zero', async () => {
    const response = await request(app).get('/api/divide').query({ a: 20, b: 0 });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('Cannot divide by zero');
  });

  test('unknown route should return 404', async () => {
    const response = await request(app).get('/unknown');

    expect(response.statusCode).toBe(404);
    expect(response.body.error).toBe('Route not found');
  });
});
