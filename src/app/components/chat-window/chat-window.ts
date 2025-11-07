import { Component, inject, Input, OnChanges, SimpleChanges, ViewChild, OnDestroy, ElementRef, AfterViewChecked, signal } from '@angular/core'; 
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Observable, of, Subscription } from 'rxjs'; 
// Importamos o IntakeData para usá-lo como tipo
import { Conversation, Message, IntakeData } from '../../models'; 
import { 
  Firestore, 
  collection, 
  collectionData, 
  query, 
  orderBy, 
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  onSnapshot, 
  DocumentData,
  Timestamp,
  Unsubscribe
} from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { take } from 'rxjs/operators';
import { PreformatPipe } from '../../utils/preformat-pipe';

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule, FormsModule, PreformatPipe], 
  templateUrl: './chat-window.html',
  styleUrl: './chat-window.scss'
})
export class ChatWindow implements OnChanges, OnDestroy, AfterViewChecked { 
  @Input() conversationId: string | null = null;
  @ViewChild('chatForm') chatForm!: NgForm;
  
  @ViewChild('messagesArea') private messagesAreaElement!: ElementRef;
  private shouldScrollToBottom = true;
  
  firestore: Firestore = inject(Firestore);
  auth: Auth = inject(Auth);
  
  messages$: Observable<Message[]> = of([]);
  currentAdminId: string | null = null;
  currentConversation: Conversation | null = null; 

  private authSub: Subscription | null = null;
  private convSub: Unsubscribe | null = null; 

  // --- NOVAS PROPRIEDADES PARA EDIÇÃO ---
  isEditing = signal(false);
  // 'editableData' é uma CÓPIA dos dados para o formulário
  editableData: IntakeData | null = null;
  // --- FIM DAS NOVAS PROPRIEDADES ---

  constructor() {
    this.authSub = authState(this.auth).pipe(take(1)).subscribe(user => {
      this.currentAdminId = user ? user.uid : null;
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['conversationId'] && this.conversationId) {
      if (this.convSub) this.convSub();
      
      this.loadMessages(this.conversationId);
      
      const convDocRef = doc(this.firestore, `conversations/${this.conversationId}`);
      this.convSub = onSnapshot(convDocRef, (docSnap) => {
        if (docSnap.exists()) {
          this.currentConversation = { id: docSnap.id, ...docSnap.data() } as Conversation;
          // Se o admin estava editando e os dados mudaram, cancele a edição
          if (this.isEditing() && docSnap.data()['intakeData'] !== this.editableData) {
            this.cancelEdit();
          }
        } else {
          this.currentConversation = null;
        }
      });
      
      this.shouldScrollToBottom = true; 
      this.isEditing.set(false); // Reseta o modo de edição ao trocar de chat

    } else if (!this.conversationId) {
      this.currentConversation = null;
      this.messages$ = of([]);
      if (this.convSub) this.convSub();
    }
  }
  
  ngOnDestroy() {
    this.authSub?.unsubscribe();
    if (this.convSub) this.convSub();
  }
  
  ngAfterViewChecked() {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  private scrollToBottom(): void {
    try {
      this.messagesAreaElement.nativeElement.scrollTop = this.messagesAreaElement.nativeElement.scrollHeight;
    } catch(err) { } 
  }

  loadMessages(convId: string) {
    const messagesCollection = collection(this.firestore, `conversations/${convId}/messages`);
    const q = query(messagesCollection, orderBy('timestamp'));
    this.messages$ = collectionData(q, { idField: 'id' }) as Observable<Message[]>;
  }

  async sendMessage(form: NgForm) {
    if (form.invalid || !this.conversationId || !this.currentAdminId) return;
    
    const messageText = form.value.message;
    const newMessage: Omit<Message, 'id'> = {
      text: messageText,
      senderId: this.currentAdminId,
      timestamp: serverTimestamp() as Timestamp
    };
    const messagesCollection = collection(this.firestore, `conversations/${this.conversationId}/messages`);
    await addDoc(messagesCollection, newMessage);
    const convDocRef = doc(this.firestore, `conversations/${this.conversationId}`);
    await updateDoc(convDocRef, {
      lastMessage: { text: messageText, timestamp: serverTimestamp() },
      status: 'active', 
      unreadByDashboard: false 
    });
    
    this.shouldScrollToBottom = true;
    this.chatForm.reset();
  }

  async endChat() {
    if (!this.conversationId || !this.currentAdminId) return;
    const endMessageText = "Atendimento encerrado pelo nosso agente.";
    const newMessage: Omit<Message, 'id'> = {
      text: endMessageText,
      senderId: this.currentAdminId,
      timestamp: serverTimestamp() as Timestamp
    };
    const messagesCollection = collection(this.firestore, `conversations/${this.conversationId}/messages`);
    await addDoc(messagesCollection, newMessage);
    const convDocRef = doc(this.firestore, `conversations/${this.conversationId}`);
    await updateDoc(convDocRef, {
      status: 'closed',
      attendedBy: null,  
      lastMessage: { text: endMessageText, timestamp: serverTimestamp() },
      unreadByDashboard: false
    });
    this.isEditing.set(false); // Cancela edição se o chat for encerrado
  }

  // --- NOVAS FUNÇÕES DE EDIÇÃO ---

  /** Entra ou sai do modo de edição */
  toggleEdit(): void {
    if (!this.currentConversation?.intakeData) return;

    if (this.isEditing()) {
      // Se estava editando e clicou "Cancelar"
      this.isEditing.set(false);
      this.editableData = null;
    } else {
      // Se estava visualizando e clicou "Editar"
      // Cria uma CÓPIA dos dados para edição
      this.editableData = { ...this.currentConversation.intakeData };
      this.isEditing.set(true);
    }
  }

  /** Função de "Cancelar" (caso o toggleEdit fique confuso) */
  cancelEdit(): void {
    this.isEditing.set(false);
    this.editableData = null;
  }

  /** Salva os dados do formulário de edição no Firestore */
  async saveIntakeData(): Promise<void> {
    if (!this.editableData || !this.conversationId) return;

    try {
      const convDocRef = doc(this.firestore, 'conversations', this.conversationId);
      
      // Atualiza tanto os dados do formulário quanto o 'userName' (caso o nome mude)
      await updateDoc(convDocRef, {
        intakeData: this.editableData,
        userName: this.editableData.nome // Atualiza o nome na lista do sidebar
      });
      
      // Sai do modo de edição
      this.isEditing.set(false);
      this.editableData = null;

    } catch (err) {
      console.error("Erro ao salvar os dados: ", err);
      alert("Não foi possível salvar as alterações.");
    }
  }
}