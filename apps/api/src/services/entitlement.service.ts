import { prisma } from '../prisma';

export interface PlanLimits {
  maxAgents: number;
  maxInboxes: number;
  maxWorkspaces: number;
  features: {
    advancedReporting: boolean;
    automationRules: boolean;
    customBranding: boolean;
  };
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  FREE: {
    maxAgents: 2,
    maxInboxes: 1,
    maxWorkspaces: 1,
    features: { advancedReporting: false, automationRules: false, customBranding: false },
  },
  TEAM: {
    maxAgents: 10,
    maxInboxes: 5,
    maxWorkspaces: 2,
    features: { advancedReporting: true, automationRules: true, customBranding: false },
  },
  GROWTH: {
    maxAgents: 25,
    maxInboxes: 10,
    maxWorkspaces: 5,
    features: { advancedReporting: true, automationRules: true, customBranding: true },
  },
  BUSINESS: {
    maxAgents: 100,
    maxInboxes: 50,
    maxWorkspaces: 20,
    features: { advancedReporting: true, automationRules: true, customBranding: true },
  },
  ENTERPRISE: {
    maxAgents: 1000000,
    maxInboxes: 1000000,
    maxWorkspaces: 1000000,
    features: { advancedReporting: true, automationRules: true, customBranding: true },
  },
};

export class EntitlementService {
  /**
   * Retrieves subscription tier and feature limits for an organization.
   */
  static async getPlanLimits(organizationId: string, tx?: any): Promise<{ plan: string; limits: PlanLimits }> {
    const client = tx || prisma;
    const org = await client.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });

    const plan = org?.plan?.toUpperCase() || 'GROWTH';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.GROWTH;
    return { plan, limits };
  }

  /**
   * Asserts whether an organization can add another agent.
   */
  static async canAddAgent(organizationId: string, tx?: any): Promise<{ allowed: boolean; current: number; max: number; plan: string }> {
    const client = tx || prisma;
    const { plan, limits } = await this.getPlanLimits(organizationId, client);
    const current = await client.user.count({
      where: { organizationId, status: { in: ['ACTIVE', 'INVITED'] } },
    });

    return {
      allowed: current < limits.maxAgents,
      current,
      max: limits.maxAgents,
      plan,
    };
  }

  /**
   * Asserts whether an organization can add another inbox channel.
   */
  static async canAddInbox(organizationId: string): Promise<{ allowed: boolean; current: number; max: number; plan: string }> {
    const { plan, limits } = await this.getPlanLimits(organizationId);
    const current = await prisma.inbox.count({
      where: { organizationId },
    });

    return {
      allowed: current < limits.maxInboxes,
      current,
      max: limits.maxInboxes,
      plan,
    };
  }
}
