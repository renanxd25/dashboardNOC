import { Component, EventEmitter, inject, OnInit, Output, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, Subscription, of, switchMap } from 'rxjs'; // RxJS imports
import { Conversation } from '../../models';
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
    // Stream da Fila
    this.queuedConversations$ = authState(this.auth).pipe(
      switchMap(user => {
        if (user) {
          return this.getQueuedConversations();
        } else {
          return of([]); 
        }
      })
    );

    // Stream dos Ativos
    this.activeConversations$ = authState(this.auth).pipe(
      switchMap(user => {
        if (user) {
          return this.getActiveConversations(user.uid);
        } else {
          return of([]); 
        }
      })
    );
  }
  
  // Função separada para buscar a fila
  private getQueuedConversations(): Observable<Conversation[]> {
    const convCollection = collection(this.firestore, 'conversations');
    const q_queue = query(convCollection, where('status', '==', 'queued'), orderBy('queuedAt'));
    return collectionData(q_queue, { idField: 'id' }) as Observable<Conversation[]>;
  }

  // Função separada para buscar os ativos
  private getActiveConversations(adminId: string): Observable<Conversation[]> {
    const convCollection = collection(this.firestore, 'conversations');
    const q_active = query(convCollection, where('status', '==', 'active'), where('attendedBy', '==', adminId), orderBy('lastMessage.timestamp', 'desc'));
    return collectionData(q_active, { idField: 'id' }) as Observable<Conversation[]>;
  }

  // Função 'selectConversation' atualizada
  async selectConversation(id: string, status: 'queued' | 'active') {
    const user = this.auth.currentUser;
    if (!user) {
      console.error("Não está logado. Não é possível aceitar o chat.");
      return; 
    }

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

  // --- FUNÇÃO CORRIGIDA ABAIXO ---

  /** Formata os dados brutos do Firestore para o Excel */
  private formatDataForExport(snapshot: any) {
    const data = snapshot.docs
      .map((doc: any) => doc.data() as Conversation)
      .filter((convo: Conversation) => convo.intakeData); 

    if (data.length === 0) {
      alert("Nenhum dado de cliente encontrado para exportar.");
      return null;
    }

    // --- CORREÇÃO AQUI ---
    // Adiciona .toUpperCase() em todos os campos de texto
    return data.map((convo: Conversation) => ({
      'Nome': convo.intakeData?.nome?.toUpperCase() || '',
      'Distribuidora': convo.intakeData?.distribuidora?.toUpperCase() || '',
      'Regional': convo.intakeData?.regional?.toUpperCase() || '',
      'Atendimento': convo.intakeData?.opcaoAtendimento?.toUpperCase() || '',
      'SE/AL': convo.intakeData?.siglaSEAL?.toUpperCase() || '',
      'Componente': convo.intakeData?.componente?.toUpperCase() || '',
      'Modelo Controle': convo.intakeData?.modeloControle?.toUpperCase() || '',
      'Comunicação': convo.intakeData?.modoComunicacao?.toUpperCase() || '',
      'IP': convo.intakeData?.ip || '', // IP não é alterado
      'Porta': convo.intakeData?.porta || '', // Porta não é alterada
      'Data Atendimento': convo.queuedAt?.toDate().toLocaleDateString('pt-BR') || 'Data não registrada',
      //'UserId': convo.userId || ''
    }));
    // --- FIM DA CORREÇÃO ---
  }

  /** Exporta TODOS os clientes */
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

  /** Exporta clientes por período */
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
      alert("Erro ao exportar dados. Você precisará criar um novo índice no Firestore para esta consulta. Veja o console F12 para o link.");
    } finally {
      this.isLoading.set(false);
    }
  }
}