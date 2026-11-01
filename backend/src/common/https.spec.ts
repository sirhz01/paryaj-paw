import { Request, Response } from 'express';
import { forceHttps } from './https';

function run(req: Partial<Request>) {
  const res = { redirect: jest.fn(), status: jest.fn().mockReturnThis(), end: jest.fn() };
  const next = jest.fn();
  forceHttps(req as Request, res as unknown as Response, next);
  return { res, next };
}

describe('forceHttps', () => {
  it('redirige le HTTP vers HTTPS en 308 en gardant chemin et paramètres', () => {
    const { res, next } = run({ secure: false, path: '/api/v1/shop/config', originalUrl: '/api/v1/shop/config?a=1', headers: { host: 'paryaj.ht' } });
    expect(res.redirect).toHaveBeenCalledWith(308, 'https://paryaj.ht/api/v1/shop/config?a=1');
    expect(next).not.toHaveBeenCalled();
  });

  it('laisse passer le HTTPS', () => {
    const { res, next } = run({ secure: true, path: '/', originalUrl: '/', headers: { host: 'paryaj.ht' } });
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('laisse la sonde de santé en HTTP', () => {
    const { next } = run({ secure: false, path: '/api/v1/health', originalUrl: '/api/v1/health', headers: { host: 'x' } });
    expect(next).toHaveBeenCalled();
  });

  it('refuse une requête sans Host', () => {
    const { res, next } = run({ secure: false, path: '/', originalUrl: '/', headers: {} });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
