import { error, json } from '@sveltejs/kit';
import {
  AutomationWorkflowSchema,
  createAutomationWorkflow,
  listAutomationWorkflows
} from '$lib/server/agent/workflows';

export function GET() {
  return json({ workflows: listAutomationWorkflows() });
}

export async function POST({ request }) {
  try {
    return json({ workflow: createAutomationWorkflow(AutomationWorkflowSchema.parse(await request.json())) }, { status: 201 });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Workflow creation failed');
  }
}
