import { Request, Response } from "express";
import { RFQStatus, QuotationStatus } from "@prisma/client";
import prisma from "../lib/prisma.js";

export const getDashboardSummary = async (
  _req: Request,
  res: Response
) => {
  try {
    const closedRFQStatuses = [RFQStatus.WON, RFQStatus.LOST];

    const [
      totalRFQs,
      rfqStatusCounts,
      totalQuotations,
      quotationStatusCounts,
      pendingApprovals,
      recentActivity,
      upcomingDeadlines,
      recentRFQs,
    ] = await Promise.all([
      prisma.rFQ.count(),

      prisma.rFQ.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),

      prisma.quotation.count(),

      prisma.quotation.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),

      prisma.approval.count({
        where: { status: "PENDING" },
      }),

      prisma.auditLog.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          action: true,
          entityType: true,
          createdAt: true,
          actor: {
            select: { name: true },
          },
        },
      }),

      prisma.rFQ.findMany({
        where: {
          dueDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          status: { notIn: closedRFQStatuses },
        },
        take: 6,
        orderBy: { dueDate: "asc" },
        include: {
          customer: {
            select: { name: true },
          },
          assignedTo: {
            select: { name: true },
          },
          parts: {
            select: { name: true },
          },
        },
      }),

      prisma.rFQ.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          customer: {
            select: { name: true },
          },
          assignedTo: {
            select: { name: true },
          },
          parts: {
            select: { name: true, materialGrade: true },
          },
        },
      }),
    ]);

    const rfqCounts = Object.fromEntries(
      rfqStatusCounts.map((item) => [
        item.status,
        item._count._all,
      ])
    );

    const quotationCounts = Object.fromEntries(
      quotationStatusCounts.map((item) => [
        item.status,
        item._count._all,
      ])
    );

    const activeRFQs =
      totalRFQs -
      (rfqCounts.WON || 0) -
      (rfqCounts.LOST || 0);

    const activeQuotationStatuses: QuotationStatus[] = [
      QuotationStatus.DRAFT,
      QuotationStatus.PENDING_APPROVAL,
      QuotationStatus.APPROVED,
      QuotationStatus.SENT,
    ];

    const activeQuotations = activeQuotationStatuses.reduce(
      (total, status) => total + (quotationCounts[status] || 0),
      0
    );

    return res.status(200).json({
      success: true,
      data: {
        metrics: {
          totalRFQs,
          activeRFQs,
          totalQuotations,
          activeQuotations,
          pendingApprovals,
          wonRFQs: rfqCounts.WON || 0,
        },
        rfqStatusCounts: rfqCounts,
        quotationStatusCounts: quotationCounts,
        recentActivity,
        upcomingDeadlines,
        recentRFQs,
      },
    });
  } catch (error) {
    console.error("Dashboard summary error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve dashboard summary",
    });
  }
};
