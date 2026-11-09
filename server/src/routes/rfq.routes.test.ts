import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const handlers = vi.hoisted(() => ({
  createRFQ: vi.fn((_req: any, res: any) => res.sendStatus(201)),
  getRFQs: vi.fn((_req: any, res: any) => res.sendStatus(200)),
  getRFQById: vi.fn((_req: any, res: any) => res.sendStatus(200)),
  getRFQAssignees: vi.fn((_req: any, res: any) => res.json({ lookup: true })),
  updateRFQ: vi.fn((_req: any, res: any) => res.sendStatus(200)),
}));
vi.mock('../controllers/rfq.controller.js', () => handlers);
vi.mock('../middleware/auth.middleware.js', () => ({ authenticate: (req: any, res: any, next: () => void) => {
  const role = req.header('x-test-role');
  if (!role) return res.sendStatus(401);
  req.user = { userId: 'user-1', role }; next();
} }));
import routes from './rfq.routes.js';
const app = express(); app.use(routes);
beforeEach(() => vi.clearAllMocks());
describe('RFQ owner and status route permissions', () => {
  it('requires authentication for owner lookup and edits', async () => {
    expect((await request(app).get('/assignees')).status).toBe(401);
    expect((await request(app).patch('/rfq-1')).status).toBe(401);
    expect(handlers.getRFQAssignees).not.toHaveBeenCalled(); expect(handlers.updateRFQ).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'ESTIMATOR'])('allows %s owner lookup without matching the RFQ detail route', async role => {
    const response = await request(app).get('/assignees').set('x-test-role', role);
    expect(response.status).toBe(200); expect(response.body).toEqual({ lookup: true });
    expect(handlers.getRFQAssignees).toHaveBeenCalledOnce(); expect(handlers.getRFQById).not.toHaveBeenCalled();
  });
  it.each(['SALES_HEAD', 'PLANT_HEAD'])('denies %s owner lookup', async role => {
    expect((await request(app).get('/assignees').set('x-test-role', role)).status).toBe(403);
    expect(handlers.getRFQAssignees).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'ESTIMATOR', 'SALES_HEAD'])('allows %s through to field-level update authorization', async role => {
    expect((await request(app).patch('/rfq-1').set('x-test-role', role)).status).toBe(200);
    expect(handlers.updateRFQ).toHaveBeenCalledOnce();
  });
  it('denies Plant Head edits', async () => {
    expect((await request(app).patch('/rfq-1').set('x-test-role', 'PLANT_HEAD')).status).toBe(403);
    expect(handlers.updateRFQ).not.toHaveBeenCalled();
  });
});
