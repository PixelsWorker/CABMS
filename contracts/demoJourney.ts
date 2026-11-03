export interface DemoEnquiry { id: string; workspace_id: string; customer_name: string; service: string; created_at: string; job_id: string | null }
export interface DemoJob { id: string; workspace_id: string; enquiry_id: string; title: string; created_at: string }
export interface CreateDemoEnquiry { customer_name: string; service: string }

export interface DemoJobStep { id: string; job_id: string; workspace_id: string; step_key: string; label: string; required: number; state: 'pending' | 'done' | 'skipped' | 'n/a'; updated_at: string }
