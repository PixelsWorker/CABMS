type JobForm = {id:string;title:string;code:string;created_at?:string};
export function getJobFormPage<T extends JobForm>(forms:readonly T[],search:string,requestedPage:number) {
 const query=search.trim().toLocaleLowerCase();
 const filtered=forms.filter(form=>!query || `${form.title} ${form.code}`.toLocaleLowerCase().includes(query));
 filtered.sort((a,b)=>(b.created_at || '').localeCompare(a.created_at || '') || a.id.localeCompare(b.id));
 const pages=Math.max(1,Math.ceil(filtered.length/10));
 const page=Math.min(Math.max(Number.isFinite(requestedPage)?Math.floor(requestedPage):1,1),pages);
 return {items:filtered.slice((page-1)*10,page*10),page,pages,total:filtered.length};
}
