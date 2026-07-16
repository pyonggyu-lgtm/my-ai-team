const request = require('supertest');
const app = require('../src/app');

describe('GET /ping', () => {
  it('200 응답을 반환한다', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
  });

  it('body가 {"message":"pong"}이다', async () => {
    const res = await request(app).get('/ping');
    expect(res.body).toEqual({ message: 'pong' });
  });

  it('Content-Type이 JSON이다', async () => {
    const res = await request(app).get('/ping');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
