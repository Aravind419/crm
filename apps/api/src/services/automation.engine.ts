import { prisma } from '../prisma';
import { runInTenantContext } from '../tenancy/tenant-context';
import { broadcastToOrg, broadcastToConversation } from './socket.service';

export interface AutomationCondition {
  match?: 'all' | 'any';
  keywords?: string[];
  senderEmailContains?: string;
}

export interface AutomationAction {
  assignTeamId?: string;
  assignAgentId?: string;
  setPriority?: string;
  addTags?: string[];
  autoReplyContent?: string;
}

export async function evaluateAutomationRules(
  organizationId: string,
  event: 'conversation.created',
  payload: {
    conversationId: string;
    messageContent: string;
    customerEmail?: string;
  }
): Promise<void> {
  if (!organizationId) return;

  try {
    await runInTenantContext(organizationId, async (tx) => {
      const rules = await tx.automationRule.findMany({
        where: {
          organizationId,
          isActive: true,
          triggerEvent: event,
        },
      });

      for (const rule of rules) {
        let conditions: AutomationCondition = {};
        let actions: AutomationAction = {};

        try {
          conditions = typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : (rule.conditions as any || {});
          actions = typeof rule.actions === 'string' ? JSON.parse(rule.actions) : (rule.actions as any || {});
        } catch (err) {
          continue;
        }

        let matches = false;

        // Check keywords
        if (conditions.keywords && conditions.keywords.length > 0) {
          const lowerText = payload.messageContent.toLowerCase();
          const found = conditions.keywords.some((kw) => lowerText.includes(kw.toLowerCase()));
          if (found) matches = true;
        }

        if (matches) {
          console.log(`[Automation] Rule triggered: "${rule.name}" for Conversation ${payload.conversationId}`);

          const updateData: any = {};
          if (actions.assignTeamId) updateData.teamId = actions.assignTeamId;
          if (actions.assignAgentId) updateData.assigneeId = actions.assignAgentId;
          if (actions.setPriority) updateData.priority = actions.setPriority;

          if (Object.keys(updateData).length > 0) {
            const updatedConv = await tx.conversation.update({
              where: { id: payload.conversationId },
              data: updateData,
              include: {
                customer: true,
                assignee: true,
                team: true,
              },
            });

            broadcastToOrg(organizationId, 'conversation:updated', updatedConv);
          }

          // Auto-reply action if configured
          if (actions.autoReplyContent) {
            const autoMsg = await tx.message.create({
              data: {
                organizationId,
                conversationId: payload.conversationId,
                senderType: 'SYSTEM',
                senderName: 'SupportOS Bot',
                messageType: 'PUBLIC_REPLY',
                content: actions.autoReplyContent,
              },
            });

            broadcastToConversation(payload.conversationId, 'message:created', autoMsg);
            broadcastToOrg(organizationId, 'message:created', autoMsg);
          }

          // Log audit event
          await tx.auditEvent.create({
            data: {
              organizationId,
              action: 'AUTOMATION_EXECUTED',
              entityType: 'Conversation',
              entityId: payload.conversationId,
              metadata: JSON.stringify({
                ruleId: rule.id,
                ruleName: rule.name,
                actionsApplied: actions,
              }),
            },
          }).catch(() => {});
        }
      }
    }, { actorType: 'WORKER' });
  } catch (err) {
    console.error('[Automation Engine Error]:', err);
  }
}
