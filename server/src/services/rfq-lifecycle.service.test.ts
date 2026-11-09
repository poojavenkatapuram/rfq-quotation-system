import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma, RFQStatus } from '@prisma/client';
import { assertRFQOpen, getLockedRFQ, nextRFQUpdatedAt, syncRFQLifecycle } from './rfq-lifecycle.service.js';

const updatedAt = new Date('2026-11-09T00:00:00Z');
const rfq = (status: RFQStatus = 'RECEIVED') => ({ id: 'rfq-1', status, updatedAt });
const raw = vi.fn();
const findUnique = vi.fn();
const findMany = vi.fn();
const updateMany = vi.fn();
const audit = vi.fn();
const tx = { $executeRaw: raw, rFQ: { findUnique, updateMany }, quotation: { findMany }, auditLog: { create: audit } } as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.resetAllMocks(); raw.mockResolvedValue(1); findUnique.mockResolvedValue(rfq());
  findMany.mockResolvedValue([]); updateMany.mockResolvedValue({ count: 1 }); audit.mockResolvedValue({});
});

describe('RFQ lifecycle aggregation', () => {
  it.each([
    ['RECEIVED', [], 'ESTIMATING'],
    ['RECEIVED', ['DRAFT'], 'ESTIMATING'],
    ['ESTIMATING', ['PENDING_APPROVAL'], 'PENDING_APPROVAL'],
    ['PENDING_APPROVAL', ['APPROVED'], 'ESTIMATING'],
    ['PENDING_APPROVAL', ['REJECTED', 'PENDING_APPROVAL'], 'PENDING_APPROVAL'],
    ['PENDING_APPROVAL', ['APPROVED', 'PENDING_APPROVAL'], 'PENDING_APPROVAL'],
    ['ESTIMATING', ['APPROVED', 'SENT'], 'QUOTATION_SENT'],
    ['QUOTATION_SENT', ['PENDING_APPROVAL'], 'QUOTATION_SENT'],
  ])('%s with quotations %j becomes %s', async (previous, quotes, next) => {
    findMany.mockResolvedValue((quotes as string[]).map(status => ({ status })));
    const result = await syncRFQLifecycle(tx, rfq(previous as RFQStatus), 'actor');
    expect(result.status).toBe(next);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'rfq-1', status: previous, updatedAt }, data: { status: next, updatedAt: expect.any(Date) } });
    expect(result.updatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
    expect(audit).toHaveBeenCalledTimes(previous === next ? 0 : 1);
  });
  it.each(['WON', 'LOST'] as const)('does not reopen %s or write quotations/audit', async status => {
    expect(() => assertRFQOpen({ status })).toThrow('closed');
    await expect(syncRFQLifecycle(tx, rfq(status), 'actor')).rejects.toThrow('closed');
    expect(findMany).not.toHaveBeenCalled(); expect(updateMany).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled();
  });
  it('rejects a stale compare-and-set without writing an audit', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(syncRFQLifecycle(tx, rfq(), 'actor')).rejects.toMatchObject({ status: 409 });
    expect(audit).not.toHaveBeenCalled();
  });
  it('propagates audit failure so the surrounding transaction rolls back', async () => {
    audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(syncRFQLifecycle(tx, rfq(), 'actor')).rejects.toThrow('audit unavailable');
  });
  it('takes the RFQ transaction lock before reading current state', async () => {
    await getLockedRFQ(tx, 'rfq-1');
    expect(raw.mock.invocationCallOrder[0]).toBeLessThan(findUnique.mock.invocationCallOrder[0]!);
    expect(raw.mock.calls[0]![1]).toBe('rfq:rfq-1');
  });
  it('returns 404 after locking a missing RFQ', async () => {
    findUnique.mockResolvedValue(null);
    await expect(getLockedRFQ(tx, 'missing')).rejects.toMatchObject({ status: 404 });
  });
  it('increments tokens even if the clock has not advanced', () => {
    const future = new Date(Date.now() + 60_000);
    expect(nextRFQUpdatedAt(future).getTime()).toBe(future.getTime() + 1);
  });
});
