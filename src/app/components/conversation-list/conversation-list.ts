import { Component, EventEmitter, inject, OnInit, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, of, BehaviorSubject, combineLatest, map, switchMap } from 'rxjs';
import { Conversation } from '../../models';
import { 
  Firestore, 
  collection, 
  collectionData, 
  query, 
  orderBy,
  where,
  getDocs, 
  Timestamp
} from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
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
  imports: [CommonModule, FormsModule],
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
  filterSubject = new BehaviorSubject<string>(''); 
  selectedFilter: string = '';
  
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

  selectConversation(id: string, status: 'queued' | 'active') {
    this.currentSelectedId = id; 
    this.conversationSelected.emit(id);
  }

  // --- FUNÇÃO MODIFICADA: AGORA EXPORTA AS NOVAS COLUNAS DO POPUP ---
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
      let tempoAtendimento = 'Não calculado';

      // Se o atendimento não foi fechado ainda
      if (convo.status !== 'closed') {
        tempoAtendimento = 'Em Andamento';
      } 
      // Se foi fechado, tentamos calcular
      else if (convo.closedAt) {
          
          if (convo.startedAt) {
            const start: Date = convo.startedAt.toDate ? convo.startedAt.toDate() : new Date(convo.startedAt);
            const end: Date = convo.closedAt.toDate ? convo.closedAt.toDate() : new Date(convo.closedAt);
            
            const durationMs = end.getTime() - start.getTime();
            tempoAtendimento = formatDuration(durationMs);
          } else {
            tempoAtendimento = 'N/A (Sem registro de início)';
          }
      }
      
      // 2. GPRS
      let comunicacaoDisplay = convo.intakeData?.modoComunicacao || '';
      if (comunicacaoDisplay === 'GPRS' && convo.intakeData?.tipoGprs) {
        comunicacaoDisplay = `GPRS - ${convo.intakeData.tipoGprs}`;
      }

      // 3. RECUPERANDO OS DADOS DO POPUP (Feedback de Encerramento)
      // Usamos (convo as any) caso a interface Conversation ainda não tenha o campo tipado
      const feedback = (convo as any).closingFeedback || {}; 
      
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
        'Hora Início': convo.startedAt?.toDate().toLocaleTimeString('pt-BR') || '-',

        // --- NOVAS COLUNAS ADICIONADAS ---
        'Status Comunicação (Final)': feedback.statusComunicacao || '-',
        'Validação Assertiva': feedback.validacaoAssertiva || '-',
        'Obs. Problema': feedback.obsProblema || '-',
        'Obs. Solução': feedback.obsSolucao || '-'
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
      alert("Erro ao exportar. Verifique o console.");
    } finally {
      this.isLoading.set(false);
    }
  }
}