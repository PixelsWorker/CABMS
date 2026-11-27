/** Validate untrusted form-builder input before persistence or review. */
const TYPES = new Set(['TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'DATETIME', 'DROPDOWN', 'CHECKBOX', 'MULTIPLE_CHOICE', 'MULTISELECT', 'YES_NO_NA', 'PASS_FAIL', 'PASS_FAIL_NA', 'REPEATABLE_TABLE', 'PHOTO', 'FILE', 'SIGNATURE', 'READONLY_AUTOFILL']);
const AUTOFILL = new Set(['job.id', 'job.title', 'customer.name', 'site.address', 'business.name', 'technician.name']);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bounded = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const TABLE_TYPES = new Set(['TEXT','LONG_TEXT','NUMBER','DATE','DATETIME','DROPDOWN','CHECKBOX','MULTIPLE_CHOICE','MULTISELECT','YES_NO_NA','PASS_FAIL','PASS_FAIL_NA']);

export function validateFormDefinition(input: unknown): string[] {
  const errors: string[] = [];
  if (!record(input) || !Array.isArray(input.sections) || input.sections.length > 50) return ['sections must be an array of at most 50 sections'];
  const keys = new Set<string>();
  const preceding = new Map<string, Record<string, unknown>>();
  let count = 0;
  for (const [sectionIndex, section] of input.sections.entries()) {
    if (!record(section) || !bounded(section.title, 160) || !Array.isArray(section.fields) || section.fields.length > 200) {
      errors.push(`invalid section ${sectionIndex + 1}`);
      continue;
    }
    if (section.description !== undefined && (typeof section.description !== 'string' || section.description.length > 4000)) errors.push(`invalid section description ${sectionIndex + 1}`);
    if (section.repeatable !== undefined && typeof section.repeatable !== 'boolean') errors.push(`invalid section repeatable flag ${sectionIndex + 1}`);
    for (const field of section.fields) {
      count++;
      if (!record(field)) { errors.push('invalid field'); continue; }
      if (!bounded(field.key, 80) || !/^[a-z][a-z0-9_]*$/.test(field.key as string) || keys.has(field.key as string)) errors.push('invalid or duplicate field key');
      else keys.add(field.key as string);
      if (!bounded(field.label, 200)) errors.push('invalid field label');
      if (typeof field.type !== 'string' || !TYPES.has(field.type)) errors.push('unsupported field type');
      if (field.required !== undefined && typeof field.required !== 'boolean') errors.push('invalid required flag');
      if (field.instructions !== undefined && (typeof field.instructions !== 'string' || field.instructions.length > 4000)) errors.push('invalid field instructions');
      if (field.autofill_source !== undefined && (typeof field.autofill_source !== 'string' || !AUTOFILL.has(field.autofill_source))) errors.push('unsupported auto-fill source');
      if (field.type === 'DROPDOWN' || field.type === 'MULTIPLE_CHOICE' || field.type === 'MULTISELECT') {
        if (!Array.isArray(field.choices) || !field.choices.length || field.choices.length > 100 || field.choices.some(c => !bounded(c, 200)) || new Set(field.choices).size !== field.choices.length) errors.push('invalid choices');
      } else if (field.choices !== undefined && (!Array.isArray(field.choices) || field.choices.length)) errors.push('choices are not supported for this field type');
      if (field.visible_when !== undefined) {
        const condition = field.visible_when;
        const source = record(condition) && typeof condition.field === 'string' ? preceding.get(condition.field) : undefined;
        const value = record(condition) ? condition.equals : undefined;
        const compatible = source && (source.type === 'CHECKBOX' ? typeof value === 'boolean' : source.type === 'NUMBER' ? typeof value === 'number' && Number.isFinite(value) : source.type === 'PASS_FAIL' ? ['PASS','FAIL'].includes(value as string) : source.type === 'PASS_FAIL_NA' ? ['PASS','FAIL','NA'].includes(value as string) : source.type === 'YES_NO_NA' ? ['YES','NO','NA'].includes(value as string) : ['DROPDOWN','MULTIPLE_CHOICE'].includes(String(source.type)) ? typeof value === 'string' && Array.isArray(source.choices) && source.choices.includes(value) : ['TEXT','LONG_TEXT','DATE','DATETIME'].includes(String(source.type)) && typeof value === 'string');
        if (!record(condition) || Object.keys(condition).some(k=>!['field','equals'].includes(k)) || !compatible) errors.push('invalid visibility condition');
      }
      if (typeof field.key === 'string') preceding.set(field.key, field);
      if (field.type === 'READONLY_AUTOFILL' && !field.autofill_source) errors.push('read-only auto-fill requires a source');
      if (field.type === 'REPEATABLE_TABLE' && field.validation === undefined) errors.push('repeatable table requires a column schema');
      if (field.validation !== undefined) {
        const v = field.validation;
        if (!record(v)) errors.push('invalid validation rules');
        else {
          if (field.type === 'REPEATABLE_TABLE') {
            const columns = v.columns;
            if (Object.keys(v).some(k=>!['max_rows','columns'].includes(k)) || !Number.isInteger(v.max_rows) || (v.max_rows as number) < 1 || (v.max_rows as number) > 100 || !Array.isArray(columns) || !columns.length || columns.length > 50 || columns.some(c=>!record(c) || typeof c.type !== 'string' || !TABLE_TYPES.has(c.type) || c.visible_when !== undefined || c.autofill_source !== undefined) || (Array.isArray(columns) && validateFormDefinition({sections:[{title:'Columns',fields:columns}]}).length > 0)) errors.push('invalid table columns or row limit');
          } else {
            const validKeys = field.type === 'NUMBER' ? ['min','max'] : ['TEXT','LONG_TEXT'].includes(String(field.type)) ? ['min_length','max_length'] : [];
            if (Object.keys(v).some(k=>!validKeys.includes(k)) || Object.values(v).some(n=>typeof n !== 'number' || !Number.isFinite(n)) || (typeof v.min === 'number' && typeof v.max === 'number' && v.min > v.max) || (typeof v.min_length === 'number' && (!Number.isInteger(v.min_length) || v.min_length < 0)) || (typeof v.max_length === 'number' && (!Number.isInteger(v.max_length) || v.max_length < 0 || v.max_length > 10000)) || (typeof v.min_length === 'number' && typeof v.max_length === 'number' && v.min_length > v.max_length)) errors.push('invalid validation rules');
          }
        }
      }
    }
  }
  if (count > 500) errors.push('too many fields');
  return errors;
}
