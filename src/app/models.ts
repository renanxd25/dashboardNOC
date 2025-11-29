export interface IntakeData {
  nome: string;
  telefone?: string; // Adicionado: Campo novo para o telefone do cliente
  distribuidora: string;
  regional: string;
  opcaoAtendimento: string;
  siglaSEAL: string;
  componente: string;
  modeloControle: string;
  modoComunicacao: string;
  tipoGprs?: string; // Adicionado: Campo novo para o tipo de GPRS (CAS, V2COM, HORUS)
  ip?: string;
  porta?: string;
}

export interface Message {
  text?: string;
  senderId: string;
  timestamp: any; // Pode ser Timestamp do Firestore ou Date
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio';
  fileName?: string; // Essencial: previne erro no template do chat
}

export interface Conversation {
  id?: string;
  userId: string;
  userName: string;
  status: 'loading' | 'pending_intake' | 'queued' | 'active' | 'closed';
  
  createdAt?: any; // Essencial: data de criação para o Excel
  queuedAt?: any;  // Essencial: data de entrada na fila
  closedAt?: any;
  
  lastMessage?: {
    text: string;
    timestamp: any;
  };
  
  intakeData?: IntakeData;
  
  unreadByDashboard?: boolean;
  attendedBy?: string;
}