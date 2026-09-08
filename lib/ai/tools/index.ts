import "server-only";

import type { Tool } from "@openai/agents-core";

import type { AgentRunContext } from "@/lib/ai/context";

import {
  adjustProductStockTool,
  createProductTool,
  deleteProductTool,
  findProductTool,
  listProductsTool,
  lowStockTool,
  setProductStockTool,
  updateProductTool,
} from "@/lib/ai/tools/product-tools";
import {
  createCustomerTool,
  deleteCustomerTool,
  findCustomerTool,
  getCustomerOrdersTool,
  listCustomersTool,
  updateCustomerTool,
} from "@/lib/ai/tools/customer-tools";
import {
  createOrderTool,
  findOrderTool,
  listOrdersTool,
  recentSalesTool,
  salesSummaryTool,
  topSellingProductsTool,
  updateOrderStatusTool,
} from "@/lib/ai/tools/order-tools";
import {
  createExpenseTool,
  deleteExpenseTool,
  expenseSummaryTool,
  listExpensesTool,
  updateExpenseTool,
} from "@/lib/ai/tools/expense-tools";
import { businessOverviewTool } from "@/lib/ai/tools/overview-tools";
import { generateProductCaptionTool } from "@/lib/ai/tools/marketing-tools";
import { createAdCampaignTool } from "@/lib/ai/tools/ad-campaign-tools";
import {
  getBusinessInfoTool,
  updateBusinessProfileTool,
} from "@/lib/ai/tools/business-tools";
import {
  getAutomationModeTool,
  publishSocialPostTool,
  findApprovalActionTool,
  executeApprovedActionTool,
} from "@/lib/ai/tools/approval-tools";

/**
 * The complete controlled tool surface of the AI Business Manager. Every
 * entry maps to a REAL application capability backed by the business service
 * layer + Supabase RLS. Nothing here is simulated; destructive entries are
 * gated behind explicit user confirmation inside the tools themselves.
 */
export const businessTools: Tool<AgentRunContext>[] = [
  // Products & inventory
  listProductsTool,
  findProductTool,
  lowStockTool,
  createProductTool,
  updateProductTool,
  setProductStockTool,
  adjustProductStockTool,
  deleteProductTool,
  // Customers
  listCustomersTool,
  findCustomerTool,
  getCustomerOrdersTool,
  createCustomerTool,
  updateCustomerTool,
  deleteCustomerTool,
  // Orders & sales
  listOrdersTool,
  findOrderTool,
  createOrderTool,
  updateOrderStatusTool,
  salesSummaryTool,
  recentSalesTool,
  topSellingProductsTool,
  // Expenses
  listExpensesTool,
  createExpenseTool,
  updateExpenseTool,
  deleteExpenseTool,
  expenseSummaryTool,
  // Whole-business view
  businessOverviewTool,
  // Marketing
  generateProductCaptionTool,
  createAdCampaignTool,
  // Business settings (same capabilities as the Settings page)
  getBusinessInfoTool,
  updateBusinessProfileTool,
  // Phase 4 approval-aware marketing
  getAutomationModeTool,
  publishSocialPostTool,
  findApprovalActionTool,
  executeApprovedActionTool,
];
