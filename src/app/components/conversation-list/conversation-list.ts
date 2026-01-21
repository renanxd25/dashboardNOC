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

function formatDuration(ms: number): string {
  if (ms < 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

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

  queuedConversations$!: Observable<Conversation[]>;
  activeConversations$!: Observable<Conversation[]>;

  // Filtro de Serviço
  filterSubject = new BehaviorSubject<string>(''); 
  selectedFilter: string = '';

  // Filtro de Distribuidora
  distributorFilterSubject = new BehaviorSubject<string>('');
  selectedDistributor: string = '';
  
  filterOptions = [
    'VERIFICAR COMUNICAÇÃO',
    'TROCA DE PORTA GPRS',
    'CADASTRO DE PORTA HUGHES',
    'TROCA DE TECNOLOGIA DE COMUNICAÇÃO',
    'COMISSIONAMENTO',
    'VOLTAR COMUNICAÇÃO'
  ];

  distributorOptions = [
    'AL', 'AP', 'GO', 'MA', 'PA', 'PI', 'RS'
  ];

  servicePriorities: Record<string, number> = {
    'COMISSIONAMENTO': 5,
    'VERIFICAR COMUNICAÇÃO': 1,
    'CADASTRO DE PORTA HUGHES': 3,
    'TROCA DE PORTA GPRS': 2,
    'TROCA DE TECNOLOGIA DE COMUNICAÇÃO': 4,
    'VOLTAR COMUNICAÇÃO': 6
  };

  currentSelectedId: string | null = null;
  isLoading = signal(false);

  ngOnInit() {
    // Busca a fila bruta
    const rawQueued$ = authState(this.auth).pipe(
      switchMap(user => user ? this.getQueuedConversations() : of([]))
    );

    this.queuedConversations$ = combineLatest([
      rawQueued$, 
      this.filterSubject, 
      this.distributorFilterSubject
    ]).pipe(
      map(([conversations, serviceFilter, distFilter]) => {
        return conversations.filter(c => {
          const matchService = serviceFilter ? c.intakeData?.opcaoAtendimento === serviceFilter : true;
          const matchDist = distFilter ? c.intakeData?.distribuidora === distFilter : true;
          return matchService && matchDist;
        });
      })
    );

    // Busca conversas ativas (TODAS)
    const rawActive$ = authState(this.auth).pipe(
      switchMap(user => user ? this.getActiveConversations() : of([]))
    );

    this.activeConversations$ = combineLatest([
      rawActive$, 
      this.filterSubject,
      this.distributorFilterSubject
    ]).pipe(
      map(([conversations, serviceFilter, distFilter]) => {
        return conversations.filter(c => {
          const matchService = serviceFilter ? c.intakeData?.opcaoAtendimento === serviceFilter : true;
          const matchDist = distFilter ? c.intakeData?.distribuidora === distFilter : true;
          return matchService && matchDist;
        });
      })
    );
  }
  
  onFilterChange(newValue: string) {
    this.selectedFilter = newValue;
    this.filterSubject.next(newValue);
  }

  onDistributorChange(newValue: string) {
    this.selectedDistributor = newValue;
    this.distributorFilterSubject.next(newValue);
  }

  getFilterLabel(option: string): string {
    if (option === 'TROCA DE PORTA GPRS') {
      return 'TROCA DE PORTA';
    }
    return option;
  }

  getAbbreviatedService(service: string | undefined): string {
    if (!service) return '';

    switch (service) {
      case 'VERIFICAR COMUNICAÇÃO': return 'VERIF. COM.';
      case 'CADASTRO DE PORTA HUGHES': return 'PORTA HUG.';
      case 'TROCA DE TECNOLOGIA DE COMUNICAÇÃO': return 'TROCA TEC.';
      case 'VOLTAR COMUNICAÇÃO': return 'VOLTAR COM.';
      case 'TROCA DE PORTA GPRS': return 'TROCA PORTA';
      case 'COMISSIONAMENTO': return 'COMISSION.';
      default: return service;
    }
  }

  private getQueuedConversations(): Observable<Conversation[]> {
    const convCollection = collection(this.firestore, 'conversations');
    const q_queue = query(convCollection, where('status', '==', 'queued'), orderBy('queuedAt'));
    return collectionData(q_queue, { idField: 'id' }) as Observable<Conversation[]>;
  }

  private getActiveConversations(): Observable<Conversation[]> {
    const convCollection = collection(this.firestore, 'conversations');
    const q_active = query(
      convCollection, 
      where('status', '==', 'active'), 
      orderBy('lastMessage.timestamp', 'desc')
    );
    return collectionData(q_active, { idField: 'id' }) as Observable<Conversation[]>;
  }

  selectConversation(id: string, status: 'queued' | 'active') {
    this.currentSelectedId = id; 
    this.conversationSelected.emit(id);
  }

  private formatDataForExport(snapshot: any) {
    const data = snapshot.docs
      .map((doc: any) => doc.data() as Conversation)
      .filter((convo: Conversation) => convo.intakeData); 

    if (data.length === 0) {
      alert("Nenhum dado de cliente encontrado para exportar.");
      return null;
    }

    return data.map((convo: Conversation) => {
      let tempoAtendimento = 'Não calculado';
      let horaFinalizacaoFormatada = '-'; // Variável para armazenar a hora formatada

      if (convo.status !== 'closed') {
        tempoAtendimento = 'Em Andamento';
      } 
      else if (convo.closedAt) {
          if (convo.startedAt) {
            const start: Date = convo.startedAt.toDate ? convo.startedAt.toDate() : new Date(convo.startedAt);
            const end: Date = convo.closedAt.toDate ? convo.closedAt.toDate() : new Date(convo.closedAt);
            
            const durationMs = end.getTime() - start.getTime();
            tempoAtendimento = formatDuration(durationMs);
            
            // Formatando a hora de finalização
            horaFinalizacaoFormatada = end.toLocaleTimeString('pt-BR');
          } else {
            tempoAtendimento = 'N/A (Sem registro de início)';
            // Tenta formatar a hora final mesmo sem hora de início, se existir closedAt
            const end: Date = convo.closedAt.toDate ? convo.closedAt.toDate() : new Date(convo.closedAt);
            horaFinalizacaoFormatada = end.toLocaleTimeString('pt-BR');
          }
      }
      
      let comunicacaoDisplay = convo.intakeData?.modoComunicacao || '';
      if (comunicacaoDisplay === 'GPRS' && convo.intakeData?.tipoGprs) {
        comunicacaoDisplay = `GPRS - ${convo.intakeData.tipoGprs}`;
      }

      const feedback = (convo as any).closingFeedback || {}; 
      const emailAtendente = (convo as any).attendedByEmail || 'Não registrado';
      
      return {
        'Nome': convo.intakeData?.nome?.toUpperCase() || '',
        'Telefone': convo.intakeData?.telefone || 'N/D', 
        'Email Atendente': emailAtendente,
        'Distribuidora': convo.intakeData?.distribuidora?.toUpperCase() || '',
        'Regional': convo.intakeData?.regional?.toUpperCase() || '',
        'Atendimento': convo.intakeData?.opcaoAtendimento?.toUpperCase() || '',
        'Subestação': convo.intakeData?.subestacao?.toUpperCase() || '',
        'Alimentador': convo.intakeData?.alimentador?.toUpperCase() || '',
        'Componente': convo.intakeData?.componente?.toUpperCase() || '',
        'Classe': convo.intakeData?.classeComponente?.toUpperCase() || '',
        'Modelo': convo.intakeData?.modelo?.toUpperCase() || '',
        'Comunicação': comunicacaoDisplay.toUpperCase(), 
        'IP': convo.intakeData?.ip || '', 
        'Porta': convo.intakeData?.porta || '', 
        'Data Atendimento': convo.queuedAt?.toDate().toLocaleDateString('pt-BR') || 'Data não registrada',
        'Hora Início': convo.startedAt?.toDate().toLocaleTimeString('pt-BR') || '-',
        'Hora Finalização': horaFinalizacaoFormatada, // <<< NOVA COLUNA AQUI
        'Tempo Atendimento': tempoAtendimento,
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

  getAvatarInitials(email: string | undefined): string {
    if (!email) return '';
    return email.substring(0, 2).toUpperCase();
  }

  getAvatarColor(email: string | undefined): string {
    if (!email) return '#95a5a6';
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
      hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
      const value = (hash >> (i * 8)) & 0xFF;
      const safeValue = Math.max(40, Math.min(180, value)); 
      color += ('00' + safeValue.toString(16)).substr(-2);
    }
    return color;
  }
}