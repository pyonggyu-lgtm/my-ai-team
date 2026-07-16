const request = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  it('200 응답을 반환한다', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('status/uptime/version 3개 필드를 포함한다', async () => {
    const res = await request(app).get('/health');
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.version).toBe('string');
  });

  it('Content-Type이 JSON이다', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
