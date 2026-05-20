import { assessAgentAction } from './policy';

export function runAgentQualityEvals() {
  const cases = [
    {
      name: 'requires approval for refund replies',
      actual: assessAgentAction({
        action: 'reply',
        subject: 'Refund for invoice 1842',
        bodyText: 'Please refund this payment today.',
        confidence: 0.92
      }),
      expect: { requiresApproval: true, riskLevel: 'medium' }
    },
    {
      name: 'allows low-risk archive candidate',
      actual: assessAgentAction({
        action: 'archive',
        subject: 'FYI: weekly newsletter',
        bodyText: 'No action needed.',
        confidence: 0.95
      }),
      expect: { requiresApproval: false, riskLevel: 'low' }
    },
    {
      name: 'escalates legal work',
      actual: assessAgentAction({
        action: 'tool_call',
        subject: 'Contract review needed',
        bodyText: 'Legal needs this contract reviewed by Friday.',
        toolReadOnly: true,
        confidence: 0.88
      }),
      expect: { requiresApproval: true, riskLevel: 'high' }
    }
  ];
  const results = cases.map((testCase) => ({
    name: testCase.name,
    passed:
      testCase.actual.requiresApproval === testCase.expect.requiresApproval &&
      testCase.actual.riskLevel === testCase.expect.riskLevel,
    actual: testCase.actual,
    expect: testCase.expect
  }));
  return {
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results
  };
}
