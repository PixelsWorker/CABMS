type ConditionalField = {key:string;visible_when?:{field:string;equals:unknown}|null};

/** Published conditions may reference only preceding fields. Hidden controllers never activate dependants. */
export function applicableFormAnswers<Field extends ConditionalField>(fields:readonly Field[], input:unknown) {
  const raw=input && typeof input==='object' && !Array.isArray(input)?input as Record<string,unknown>:{};
  const answers:Record<string,unknown>=Object.create(null);
  const applicable:Field[]=[];
  for(const field of fields){
    const condition=field.visible_when;
    if(condition && (!Object.hasOwn(answers,condition.field)||answers[condition.field]!==condition.equals))continue;
    applicable.push(field);
    if(Object.hasOwn(raw,field.key))answers[field.key]=raw[field.key];
  }
  return {applicable,answers:{...answers}};
}
