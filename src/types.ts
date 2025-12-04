export interface Conversation {
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, ConversationNode>;
  moderation_results: any[];
  current_node: string;
  plugin_ids: string[] | null;
  conversation_id: string;
  conversation_template_id: string | null;
  gizmo_id: string | null;
  is_archived: boolean;
  safe_urls: string[];
  default_model_slug: string;
}

export interface ConversationNode {
  id: string;
  message?: Message | null;
  parent?: string | null;
  children: string[];
}

export interface Message {
  id: string;
  author: {
    role: string;
    name?: string | null;
    metadata?: any;
  };
  create_time: number | null;
  update_time: number | null;
  content: MessageContent;
  status: string;
  end_turn: boolean | null;
  weight: number;
  metadata: MessageMetadata;
  recipient: string;
}

export interface MessageContent {
  content_type: string;
  parts?: any[];
  text?: string; // Legacy or simple text
}

export interface MessageMetadata {
  attachments?: Attachment[];
  content_references_by_file?: Record<string, any[]>; // file_id -> refs
  n7jupd_crefs_by_file?: Record<string, any[]> | any[]; // Obfuscated field
  n7jupd_crefs?: Record<string, any[]> | any[]; // Obfuscated field
  [key: string]: any;
}

export interface Attachment {
  id: string;
  name: string;
  mime_type: string;
  size?: number;
  size_bytes?: number;
  width?: number;
  height?: number;
  [key: string]: any;
}

export interface FileCandidate {
  file_id: string;
  conversation_id?: string;
  project_id?: string;
  message_id?: string;
  pointer?: string;
  source?: string;
  meta?: any;
  kind?: string;
  name?: string;
  mime_type?: string;
  size_bytes?: number;
  width?: number;
  height?: number;
  role?: string;
}

export interface Project {
  projectId: string;
  projectName: string;
  createdAt?: string;
  convs: { id: string; title: string }[];
}

export interface Task {
  id: string;
  projectId: string | null;
}

export interface BatchExportSummary {
  exported_at: string;
  total_conversations: number;
  root: { count: number; ids: string[] };
  projects: {
    projectId: string;
    projectName: string;
    createdAt: string;
    count: number;
  }[];
  attachments_map: any[];
  failed: {
    conversations: any[];
    attachments: any[];
  };
}

export interface DownloadResult {
  ok: number;
  total: number;
}
