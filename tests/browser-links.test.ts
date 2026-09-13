import { describe, it, expect } from 'vitest';
import { reportLinkOptions } from '../src/lib/server/browser-links';

describe('report email links', () => {
  it('prioritizes the stable DoorDash dashboard and labels report actions', () => {
    const options = reportLinkOptions(
      ['https://tracksg.doordash.com/logo', 'https://tracksg.doordash.com/report'],
      '<a href="https://tracksg.doordash.com/logo"><img></a><a href="https://tracksg.doordash.com/report"><b>Download report</b></a>',
      'DoorDash <no-reply@doordash.com>'
    );
    expect(options[0].url).toBe('https://www.doordash.com/merchant/reports');
    expect(options[1].label).toBe('Download report');
  });
  it('does not infer a provider from its name in an unrelated sender', () => {
    expect(
      reportLinkOptions(['https://doordash.com/'], '', 'doordash.com <no-reply@evil.test>')[0].url
    ).toBe('https://doordash.com/');
  });
});
