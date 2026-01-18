import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // Necessário para os inputs de data (ngModel)
import { 
  Firestore, collection, collectionData, query, 
  orderBy 
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { Conversation } from '../../models';
import { Router, RouterModule } from '@angular/router';
import { Auth, signOut, authState } from '@angular/fire/auth';
import * as XLSX from 'xlsx';

// Seus componentes filhos
import { ConversationList } from '../conversation-list/conversation-list';
import { ChatWindow } from '../chat-window/chat-window';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, 
    RouterModule,
    FormsModule, // Importante para os filtros de data funcionarem
    ConversationList,
    ChatWindow
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class Dashboard implements OnInit {
  firestore: Firestore = inject(Firestore);
  auth: Auth = inject(Auth);
  router: Router = inject(Router);

  conversations$: Observable<Conversation[]>;
  allConversations: Conversation[] = []; 
  
  selectedConversationId: string | null = null;

  // Variáveis para os filtros de data do HTML
  startDate: string | null = null;
  endDate: string | null = null;

  constructor() {
    const conversationsCollection = collection(this.firestore, 'conversations');
    
    // Query principal: Traz todas as conversas ordenadas pela última mensagem
    const q = query(
      conversationsCollection,
      orderBy('lastMessage.timestamp', 'desc')
    );

    this.conversations$ = collectionData(q, { idField: 'id' }).pipe(
      map(convs => {
        const data = convs as Conversation[];
        this.allConversations = data; // Armazena em memória para usar na exportação do Excel
        return data;
      })
    );
  }

  ngOnInit() {
    // Verifica se o admin está logado
    authState(this.auth).subscribe(user => {
      if (!user) {
        this.router.navigate(['/login']);
      }
    });
  }

  // Função chamada quando clica em uma conversa na lista
  onConversationSelected(conversationId: string) {
    this.selectedConversationId = conversationId;
  }

  // Função de Logout
  async logout() {
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }

  // --- BOTÃO 1: EXPORTAR TUDO ---
  exportToExcel() {
    if (this.allConversations.length === 0) {
      alert("Sem dados para exportar.");
      return;
    }

    // Chama a função geradora passando todos os dados
    this.generateExcel(this.allConversations, 'Relatorio_Geral_Atendimentos');
  }

  // --- BOTÃO 2: EXPORTAR POR PERÍODO ---
  exportByPeriod() {
    if (!this.startDate || !this.endDate) {
      alert("Por favor, selecione as datas de início e fim.");
      return;
    }

    // Cria objetos Date ajustando o fuso/horário
    const start = new Date(this.startDate);
    start.setHours(0, 0, 0, 0); // Início do dia

    const end = new Date(this.endDate);
    end.setHours(23, 59, 59, 999); // Final do dia

    // Filtra o array local allConversations
    const filteredConversations = this.allConversations.filter(conv => {
      if (!conv.createdAt) return false;
      
      // Converte o Timestamp do Firestore para Date do JS
      const convDate = conv.createdAt.toDate ? conv.createdAt.toDate() : new Date(conv.createdAt);
      
      return convDate >= start && convDate <= end;
    });

    if (filteredConversations.length === 0) {
      alert("Nenhum atendimento encontrado neste período.");
      return;
    }

    // Chama a função geradora passando apenas os filtrados
    this.generateExcel(filteredConversations, `Relatorio_${this.startDate}_a_${this.endDate}`);
  }

  // --- FUNÇÃO CENTRAL QUE GERA O ARQUIVO (AQUI ESTÃO AS COLUNAS NOVAS) ---
  private generateExcel(data: Conversation[], fileNamePrefix: string) {
    console.log('teste')
    const dataToExport = data.map(conv => {
       console.log('teste', conv.intakeData)
      
      // LÓGICA 1: Formatar o GPRS (Ex: "GPRS - V2COM")
      let comunicacaoFormatada = conv.intakeData?.modoComunicacao || '';
      
      if (conv.intakeData?.modoComunicacao === 'GPRS' && conv.intakeData?.tipoGprs) {
        comunicacaoFormatada = `GPRS - ${conv.intakeData.tipoGprs}`;
      }

      // LÓGICA 2: Montar as colunas do Excel
      return {
        'Data Início': conv.createdAt?.toDate ? conv.createdAt.toDate().toLocaleString() : '',
        'Status': conv.status,
        
        // Dados Pessoais
        'Nome do Cliente': conv.intakeData?.nome || conv.userName || '',
        'Telefone': conv.intakeData?.telefone || '', // <--- CAMPO NOVO AQUI
       
        // Dados Técnicos
        'Distribuidora': conv.intakeData?.distribuidora || '',
        'Regional': conv.intakeData?.regional || '',
        'Tipo de Atendimento': conv.intakeData?.opcaoAtendimento || '',
        'Subestação': conv.intakeData?.subestacao || '',
        'Alimentador': conv.intakeData?.alimentador || '',
        'Componente': conv.intakeData?.componente || '',
        'Classe': conv.intakeData?.classeComponente || '',
        'Modelo': conv.intakeData?.modelo || '',
        
        // Comunicação formatada
        'Comunicação': comunicacaoFormatada, // <--- USA A VARIÁVEL TRATADA
        
        'Endereço IP': conv.intakeData?.ip || '',
        'Porta': conv.intakeData?.porta || '',
        
        // Chat
        'Última Mensagem': conv.lastMessage?.text || ''
      };
    });

    // Criação da planilha usando a biblioteca XLSX
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(dataToExport);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Relatorio');

    // Download do arquivo
    XLSX.writeFile(wb, `${fileNamePrefix}_${new Date().getTime()}.xlsx`);
  }
}