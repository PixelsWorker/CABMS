export interface DemoEnquiry { id: string; workspace_id: string; customer_name: string; service: string; created_at: string; job_id: string | null }
export interface DemoJob { id: string; workspace_id: string; enquiry_id: string; title: string; created_at: string }
export interface CreateDemoEnquiry { customer_name: string; service: string }
