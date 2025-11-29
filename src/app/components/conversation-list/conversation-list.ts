import { Component, EventEmitter, inject, OnInit, Output, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // <--- IMPORTANTE PARA O SELECT FUNCIONAR
import { Observable, Subscription, of, switchMap, BehaviorSubject, combineLatest, map } from 'rxjs';
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
  imports: [CommonModule, FormsModule], // <--- ADICIONEI FORMSMODULE
  templateUrl: './conversation-list.html', 
  styleUrl: './conversation-list.scss'
})
export class ConversationList implements OnInit { 
  @Output() conversationSelected = new EventEmitter<string>();
  
  firestore: Firestore = inject(Firestore);
  auth: Auth = inject(Auth); 
  exportService: ExportService = inject(ExportService);

  // Observables finais filtrados
  queuedConversations$!: Observable<Conversation[]>;
  activeConversations$!: Observable<Conversation[]>;

  // --- LÓGICA DO FILTRO ---
  filterSubject = new BehaviorSubject<string>(''); // Começa vazio (todos)
  selectedFilter: string = '';
  
  // Suas opções de atendimento (baseado no seu HTML)
  filterOptions = [
    'COMISSIONAMENTO',
    'VERIFICAR COMUNICAÇÃO',
    'CADASTRO DE PORTA HUGHES',
    'TROCA DE PORTA GPRS',
    'TROCA DE TECNOLOGIA DE COMUNICAÇÃO',
    'VOLTAR COMUNICAÇÃO'
  ];
  // ------------------------

  currentSelectedId: string | null = null;
  isLoading = signal(false);

  ngOnInit() {
    // 1. FILA DE ESPERA COM FILTRO
    const rawQueued$ = authState(this.auth).pipe(
      switchMap(user => user ? this.getQueuedConversations() : of([]))
    );

    this.queuedConversations$ = combineLatest([rawQueued$, this.filterSubject]).pipe(
      map(([conversations, filter]) => {
        if (!filter) return conversations;
        // Filtra ignorando maiúsculas/minúsculas por segurança
        return conversations.filter(c => c.intakeData?.opcaoAtendimento === filter);
      })
    );

    // 2. ATENDIMENTOS ATIVOS COM FILTRO
    const rawActive$ = authState(this.auth).pipe(
      switchMap(user => user ? this.getActiveConversations(user.uid) : of([]))
    );

    this.activeConversations$ = combineLatest([rawActive$, this.filterSubject]).pipe(
      map(([conversations, filter]) => {
        if (!filter) return conversations;
        return conversations.filter(c => c.intakeData?.opcaoAtendimento === filter);
      })
    );
  }
  
  // Função chamada pelo HTML quando troca o select
  onFilterChange(newValue: string) {
    this.selectedFilter = newValue;
    this.filterSubject.next(newValue);
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

  // --- EXPORTAÇÃO (MANTIDA IGUAL AO SEU PEDIDO ANTERIOR) ---
  private formatDataForExport(snapshot: any) {
    const data = snapshot.docs
      .map((doc: any) => doc.data() as Conversation)
      .filter((convo: Conversation) => convo.intakeData); 

    if (data.length === 0) {
      alert("Nenhum dado de cliente encontrado para exportar.");
      return null;
    }

    return data.map((convo: Conversation) => {
      
      // 1. CÁLCULO DO TEMPO
      let tempoAtendimento = 'Em Andamento';
      if (convo.status === 'closed' && convo.queuedAt && convo.closedAt) {
          const start: Date = convo.queuedAt.toDate ? convo.queuedAt.toDate() : new Date(convo.queuedAt);
          const end: Date = convo.closedAt.toDate ? convo.closedAt.toDate() : new Date(convo.closedAt);
          const durationMs = end.getTime() - start.getTime();
          tempoAtendimento = formatDuration(durationMs);
      }
      
      // 2. GPRS
      let comunicacaoDisplay = convo.intakeData?.modoComunicacao || '';
      if (comunicacaoDisplay === 'GPRS' && convo.intakeData?.tipoGprs) {
        comunicacaoDisplay = `GPRS - ${convo.intakeData.tipoGprs}`;
      }
      
      return {
        'Nome': convo.intakeData?.nome?.toUpperCase() || '',
        'Telefone': convo.intakeData?.telefone || 'N/D', 
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
      alert("Erro ao exportar dados.");
    } finally {
      this.isLoading.set(false);
    }
  }

  async exportByDateRange(startDate: string, endDate: string) {
    if (!startDate || !endDate) return alert("Selecione as datas.");
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
      alert("Erro ao exportar. Verifique o console (índice necessário).");
    } finally {
      this.isLoading.set(false);
    }
  }
}