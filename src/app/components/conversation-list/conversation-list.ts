import { Component, EventEmitter, inject, OnInit, Output, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, Subscription, of, switchMap } from 'rxjs';
import { Conversation, IntakeData } from '../../models';
import { 
  Firestore, 
  collection, 
  collectionData, 
  query, 
  orderBy,
  where,
  doc, 	  
  updateDoc,
  getDocs, 
  Timestamp
} from '@angular/fire/firestore';
import { Auth, authState, User } from '@angular/fire/auth';
import { ExportService } from '../../services/export'; 


// --- FUNÇÃO AUXILIAR PARA FORMATAR O TEMPO ---
function formatDuration(ms: number): string {
    if (ms < 0) return '00:00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (num: number) => num.toString().padStart(2, '0');

    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
// ---------------------------------------------


@Component({
  selector: 'app-conversation-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './conversation-list.html', 
  styleUrl: './conversation-list.scss'
})
export class ConversationList implements OnInit { 
  @Output() conversationSelected = new EventEmitter<string>();
  
  firestore: Firestore = inject(Firestore);
  auth: Auth = inject(Auth); 
  exportService: ExportService = inject(ExportService);

  queuedConversations$!: Observable<Conversation[]>;
  activeConversations$!: Observable<Conversation[]>;

  currentSelectedId: string | null = null;
  isLoading = signal(false);

  ngOnInit() {
    this.queuedConversations$ = authState(this.auth).pipe(
      switchMap(user => user ? this.getQueuedConversations() : of([]))
    );

    this.activeConversations$ = authState(this.auth).pipe(
      switchMap(user => user ? this.getActiveConversations(user.uid) : of([]))
    );
  }
  
  private getQueuedConversations(): Observable<Conversation[]> {
    const convCollection = collection(this.firestore, 'conversations');
    const q_queue = query(convCollection, where('status', '==', 'queued'), orderBy('queuedAt'));
    return collectionData(q_queue, { idField: 'id' }) as Observable<Conversation[]>;
  }

  private getActiveConversations(adminId: string): Observable<Conversation[]> {
    const convCollection = collection(this.firestore, 'conversations');
    const q_active = query(convCollection, where('status', '==', 'active'), where('attendedBy', '==', adminId), orderBy('lastMessage.timestamp', 'desc'));
    return collectionData(q_active, { idField: 'id' }) as Observable<Conversation[]>;
  }

  async selectConversation(id: string, status: 'queued' | 'active') {
    const user = this.auth.currentUser;
    if (!user) return console.error("Não está logado. Não é possível aceitar o chat.");

    this.currentSelectedId = id; 
    
    if (status === 'queued') {
      const convDocRef = doc(this.firestore, 'conversations', id);
      await updateDoc(convDocRef, {
        status: 'active', 
        attendedBy: user.uid, 
        unreadByDashboard: false
      });
    }
    this.conversationSelected.emit(id);
  }

  // --- FUNÇÃO DE EXPORTAÇÃO CORRIGIDA (CÁLCULO DO TEMPO) ---
  private formatDataForExport(snapshot: any) {
    const data = snapshot.docs
      .map((doc: any) => doc.data() as Conversation)
      .filter((convo: Conversation) => convo.intakeData); 

    if (data.length === 0) {
      alert("Nenhum dado de cliente encontrado para exportar.");
      return null;
    }

    return data.map((convo: Conversation) => {
      
      // 1. CÁLCULO DO TEMPO DE ATENDIMENTO
      let tempoAtendimento = 'Em Andamento';
      
      // Só calcula se o chat foi fechado e se as datas existem
      if (convo.status === 'closed' && convo.queuedAt && convo.closedAt) {
          
          // Converte Timestamps (do Firestore) para objetos Date (do JavaScript)
          const start: Date = convo.queuedAt.toDate ? convo.queuedAt.toDate() : new Date(convo.queuedAt);
          const end: Date = convo.closedAt.toDate ? convo.closedAt.toDate() : new Date(convo.closedAt);
          
          const durationMs = end.getTime() - start.getTime();
          tempoAtendimento = formatDuration(durationMs);
      }
      
      // 2. Lógica de GPRS (Concatenar Tipo)
      let comunicacaoDisplay = convo.intakeData?.modoComunicacao || '';
      if (comunicacaoDisplay === 'GPRS' && convo.intakeData?.tipoGprs) {
        comunicacaoDisplay = `GPRS - ${convo.intakeData.tipoGprs}`;
      }
      
      return {
        'Nome': convo.intakeData?.nome?.toUpperCase() || '',
        'Telefone': convo.intakeData?.telefone || 'N/D', 
        
        // NOVA COLUNA: Tempo de Atendimento
        'Tempo Atendimento': tempoAtendimento, 
        
        'Distribuidora': convo.intakeData?.distribuidora?.toUpperCase() || '',
        'Regional': convo.intakeData?.regional?.toUpperCase() || '',
        'Atendimento': convo.intakeData?.opcaoAtendimento?.toUpperCase() || '',
        'SE/AL': convo.intakeData?.siglaSEAL?.toUpperCase() || '',
        'Componente': convo.intakeData?.componente?.toUpperCase() || '',
        'Modelo Controle': convo.intakeData?.modeloControle?.toUpperCase() || '',
        'Comunicação': comunicacaoDisplay.toUpperCase(), 
        'IP': convo.intakeData?.ip || '', 
        'Porta': convo.intakeData?.porta || '', 
        'Data Atendimento': convo.queuedAt?.toDate().toLocaleDateString('pt-BR') || 'Data não registrada',
      };
    });
  }

  /** Exporta TODOS os clientes (Botão "Exportar Todos") */
  async exportAll() {
    if (this.isLoading()) return;
    this.isLoading.set(true);
    try {
      const convCollection = collection(this.firestore, 'conversations');
      const snapshot = await getDocs(convCollection);
      const dataToExport = this.formatDataForExport(snapshot);
      if (dataToExport) {
        this.exportService.exportToExcel(dataToExport, 'todos_os_clientes');
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao exportar dados. Verifique o console.");
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Exporta clientes por período (Botão "Exportar por Período") */
  async exportByDateRange(startDate: string, endDate: string) {
    if (!startDate || !endDate) {
      alert("Por favor, selecione a data de início e a data de fim.");
      return;
    }
    if (this.isLoading()) return;
    this.isLoading.set(true);
    try {
      const startTS = Timestamp.fromDate(new Date(startDate + "T00:00:00"));
      const endTS = Timestamp.fromDate(new Date(endDate + "T23:59:59"));
      
      const q = query(
        collection(this.firestore, 'conversations'),
        where('queuedAt', '>=', startTS),
        where('queuedAt', '<=', endTS)
      );
      
      const snapshot = await getDocs(q);
      const dataToExport = this.formatDataForExport(snapshot);
      
      if (dataToExport) {
        const fileName = `clientes_de_${startDate}_a_${endDate}`;
        this.exportService.exportToExcel(dataToExport, fileName);
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao exportar dados. Você precisará criar um índice no Firestore para esta consulta (queuedAt >=/<=).");
    } finally {
      this.isLoading.set(false);
    }
  }
}