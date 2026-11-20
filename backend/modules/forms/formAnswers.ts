/** Pure answer checks. A caller must verify signature/evidence records and bind them to an immutable answer snapshot. */
type Field = { key:string; type:string; required?:boolean; choices?:string[]; visible_when?:{field:string;equals:unknown}; validation?:{min?:number;max?:number;min_length?:number;max_length?:number;max_rows?:number;columns?:Field[]} };
type Verification = {verifiedSignatures?:string[]; verifiedEvidence?:string[]};
export function validateFormAnswers(fields: readonly Field[], input: unknown, verified: Verification = {}): string[] {
 if (!input || typeof input !== 'object' || Array.isArray(input)) return ['answers must be an object'];
 const answers = input as Record<string,unknown>, errors:string[] = [], keys = new Set(fields.map(f=>f.key));
 if (Object.keys(answers).some(k=>!keys.has(k))) errors.push('unknown answer key');
 for (const f of fields) {
  if (f.visible_when && answers[f.visible_when.field] !== f.visible_when.equals) continue;
  const value=answers[f.key];
  if (f.type==='SIGNATURE') { if (f.required && !verified.verifiedSignatures?.includes(f.key)) errors.push(`${f.key}: signature required`); continue; }
  if (f.type==='PHOTO' || f.type==='FILE') { if (f.required && !verified.verifiedEvidence?.includes(f.key)) errors.push(`${f.key}: evidence required`); continue; }
  const missing=value===undefined || value===null || value==='' || (Array.isArray(value) && !value.length);
  if (missing) { if(f.required) errors.push(`${f.key}: required`); continue; }
  let valid=false;
  switch(f.type) {
   case 'TEXT': case 'LONG_TEXT': case 'READONLY_AUTOFILL': valid=typeof value==='string' && value.length <= (f.validation?.max_length ?? 10000) && value.length >= (f.validation?.min_length ?? 0) && (!f.required || value.trim().length>0); break;
   case 'NUMBER': valid=typeof value==='number' && Number.isFinite(value) && (f.validation?.min===undefined || value>=f.validation.min) && (f.validation?.max===undefined || value<=f.validation.max); break;
   case 'DATE': valid=typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value; break;
   case 'DATETIME': valid=typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)); break;
   case 'DROPDOWN': case 'MULTIPLE_CHOICE': valid=typeof value==='string' && !!f.choices?.includes(value); break;
   case 'MULTISELECT': valid=Array.isArray(value) && value.length<=100 && value.every(v=>typeof v==='string' && f.choices?.includes(v)) && new Set(value).size===value.length; break;
   case 'CHECKBOX': valid=typeof value==='boolean' && (!f.required || value); break;
   case 'YES_NO_NA': valid=['YES','NO','NA'].includes(value as string); break;
   case 'PASS_FAIL': valid=['PASS','FAIL'].includes(value as string); break;
   case 'PASS_FAIL_NA': valid=['PASS','FAIL','NA'].includes(value as string); break;
   case 'REPEATABLE_TABLE': {
    const columns=f.validation?.columns, maxRows=f.validation?.max_rows;
    const allowed=new Set(['TEXT','LONG_TEXT','NUMBER','DATE','DATETIME','DROPDOWN','CHECKBOX','MULTIPLE_CHOICE','MULTISELECT','YES_NO_NA','PASS_FAIL','PASS_FAIL_NA']);
    valid=Array.isArray(value) && Number.isInteger(maxRows) && maxRows!>=1 && maxRows!<=100 && value.length<=maxRows! && Array.isArray(columns) && columns.length>0 && columns.length<=50 && columns.every(c=>!!c && allowed.has(c.type) && !c.visible_when) && new Set(columns.map(c=>c.key)).size===columns.length && value.every(row=>validateFormAnswers(columns,row).length===0);
    break;
   }
   default: valid=false;
  }
  if(!valid) errors.push(`${f.key}: invalid answer`);
 }
 return errors;
}
