import { describe, expect, it } from 'vitest';
import { ARTIST_FIELDS, changedValues, LEAD_FIELDS } from './leadFields';

describe('changedValues (Show all panel)', () => {
  const before = { full_name: 'Jane Doe', email: null, company_staff: 12, status: 'to_do', company_type: 'label' };

  it('returns only edited, editable fields, parsed', () => {
    const out = changedValues(LEAD_FIELDS, before, {
      full_name: 'Jane Doe',
      email: ' Jane@Label.com ',
      company_staff: '1,200',
      status: 'won', // workflow field: ignored
    });
    expect(out).toEqual({ email: 'jane@label.com', company_staff: 1200 });
  });

  it('empty input clears a field; bad input throws', () => {
    expect(changedValues(LEAD_FIELDS, before, { company_staff: '' })).toEqual({ company_staff: null });
    expect(() => changedValues(LEAD_FIELDS, before, { company_staff: '12k' })).toThrow();
    expect(() => changedValues(LEAD_FIELDS, before, { email: 'nope' })).toThrow();
    expect(() => changedValues(LEAD_FIELDS, before, { company_type: 'major' })).toThrow();
  });

  it('normalizes LinkedIn URLs and keeps artist names required', () => {
    const out = changedValues(LEAD_FIELDS, { linkedin_url: null }, { linkedin_url: 'https://www.linkedin.com/in/Jane-Doe/' });
    expect(out.linkedin_url).toMatch(/^https:\/\/www\.linkedin\.com\/in\/jane-doe$/);
    expect(() => changedValues(ARTIST_FIELDS, { name: 'X' }, { name: ' ' })).toThrow();
  });
});
