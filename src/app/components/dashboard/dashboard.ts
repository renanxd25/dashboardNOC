import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; 
import { 
  Firestore, collection, collectionData, query, 
  orderBy 
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { Conversation } from '../../models';
import { Router, RouterModule } from '@angular/router';
import { Auth, signOut, authState } from '@angular/fire/auth';
import * as XLSX from 'xlsx';

import { ConversationList } from '../conversation-list/conversation-list';
import { ChatWindow } from '../chat-window/chat-window';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, 
    RouterModule,
    FormsModule,
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

  startDate: string | null = null;
  endDate: string | null = null;

  constructor() {
    const conversationsCollection = collection(this.firestore, 'conversations');
    
    const q = query(
      conversationsCollection,
      orderBy('lastMessage.timestamp', 'desc')
    );

    this.conversations$ = collectionData(q, { idField: 'id' }).pipe(
      map(convs => {
        const data = convs as Conversation[];
        this.allConversations = data; 
        return data;
      })
    );
  }

  ngOnInit() {
    authState(this.auth).subscribe(user => {
      if (!user) {
        this.router.navigate(['/login']);
      }
    });
  }

  onConversationSelected(conversationId: string) {
    this.selectedConversationId = conversationId;
  }

  async logout() {
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }

  exportToExcel() {
    if (this.allConversations.length === 0) {
      alert("Sem dados para exportar.");
      return;
    }

    this.generateExcel(this.allConversations, 'Relatorio_Geral_Atendimentos');
  }

  exportByPeriod() {
    if (!this.startDate || !this.endDate) {
      alert("Por favor, selecione as datas de início e fim.");
      return;
    }

    const start = new Date(this.startDate);
    start.setHours(0, 0, 0, 0); 

    const end = new Date(this.endDate);
    end.setHours(23, 59, 59, 999); 

    const filteredConversations = this.allConversations.filter(conv => {
      if (!conv.createdAt) return false;
      
      const convDate = conv.createdAt.toDate ? conv.createdAt.toDate() : new Date(conv.createdAt);
      
      return convDate >= start && convDate <= end;
    });

    if (filteredConversations.length === 0) {
      alert("Nenhum atendimento encontrado neste período.");
      return;
    }

    this.generateExcel(filteredConversations, `Relatorio_${this.startDate}_a_${this.endDate}`);
  }

  private generateExcel(data: Conversation[], fileNamePrefix: string) {
    const dataToExport: any[] = [];
  
    data.forEach((conv: any) => {
  
      const formatRecord = (record: any, isCurrent: boolean) => {
        let comunicacaoFormatada = record.intakeData?.modoComunicacao || '';
        if (record.intakeData?.modoComunicacao === 'GPRS' && record.intakeData?.tipoGprs) {
          comunicacaoFormatada = `GPRS - ${record.intakeData.tipoGprs}`;
        }
  
        // --- NOVA LÓGICA DE COMPARTILHAMENTO BLINDADA ---
        let arrayDeCompartilhamento: string[] = [];
        if (isCurrent) {
          arrayDeCompartilhamento = record.status === 'queued' ? [] : (record.sharedWith || []);
        } else {
          arrayDeCompartilhamento = record.sharedWithHistory || record.sharedWith || [];
        }
  
        const emailsCompartilhados = (Array.isArray(arrayDeCompartilhamento) && arrayDeCompartilhamento.length > 0) 
          ? arrayDeCompartilhamento.join(', ') 
          : 'Não compartilhado';
        // ------------------------------------------------

        return {
          'Data Início': record.startedAt?.toDate ? record.startedAt.toDate().toLocaleString() : (conv.createdAt?.toDate ? conv.createdAt.toDate().toLocaleString() : ''),
          'Status': isCurrent ? conv.status : 'HISTÓRICO',
          'Nome do Cliente': record.intakeData?.nome || conv.userName || '',
          'Telefone': record.intakeData?.telefone || '', 
          'Email Atendente': record.attendedByEmail || 'Não registrado',
          'Compartilhado Com': emailsCompartilhados,
          'Distribuidora': record.intakeData?.distribuidora || '',
          'Regional': record.intakeData?.regional || '',
          'Tipo de Atendimento': record.intakeData?.opcaoAtendimento || '',
          'Subestação': record.intakeData?.subestacao || '',
          'Alimentador': record.intakeData?.alimentador || '',
          'Componente': record.intakeData?.componente || '',
          'Classe': record.intakeData?.classeComponente || '',
          'Modelo': record.intakeData?.modelo || '',
          'Comunicação': comunicacaoFormatada, 
          'Endereço IP': record.intakeData?.ip || '',
          'Porta': record.intakeData?.porta || '',
          'Última Mensagem': isCurrent ? (conv.lastMessage?.text || '') : 'Atendimento finalizado'
        };
      };
  
      if (conv.history && Array.isArray(conv.history)) {
        conv.history.forEach((hist: any) => {
          dataToExport.push(formatRecord(hist, false));
        });
      }
  
      if (conv.status !== 'closed' || !conv.history || conv.history.length === 0) {
        dataToExport.push(formatRecord(conv, true));
      }
    });
  
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(dataToExport);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Relatorio');
  
    XLSX.writeFile(wb, `${fileNamePrefix}_${new Date().getTime()}.xlsx`);
  }
}