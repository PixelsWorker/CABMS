export type FormLibraryScope = 'ACTIVE' | 'ARCHIVED' | 'ALL';
type CatalogRow = { id:string; title:string; code:string; category:string; status:string; created_at?:string; updated_at?:string; pending_status?:string|null; published_revision_id?:string|null };
export function formLibraryStatus(row: CatalogRow): string {
 return row.status === 'ARCHIVED' ? 'ARCHIVED' : row.pending_status || (row.published_revision_id ? 'PUBLISHED' : 'DRAFT');
}
export function getFormLibraryPage<T extends CatalogRow>(rows:readonly T[], options:{scope:FormLibraryScope;page:number;search?:string;category?:string;status?:string}) {
 const query = (options.search || '').trim().toLocaleLowerCase();
 const filtered = rows.filter(row => (options.scope === 'ALL' || (options.scope === 'ARCHIVED' ? row.status === 'ARCHIVED' : row.status !== 'ARCHIVED')) && (!query || `${row.title} ${row.code}`.toLocaleLowerCase().includes(query)) && (!options.category || row.category === options.category) && (!options.status || formLibraryStatus(row) === options.status));
 filtered.sort((a,b) => (b.created_at || b.updated_at || '').localeCompare(a.created_at || a.updated_at || '') || a.id.localeCompare(b.id));
 const pages = Math.max(1,Math.ceil(filtered.length / 10));
 const requested = Number.isFinite(options.page) ? Math.floor(options.page) : 1;
 const page = Math.min(Math.max(requested,1),pages);
 return {items:filtered.slice((page-1)*10,page*10),total:filtered.length,pages,page};
}
