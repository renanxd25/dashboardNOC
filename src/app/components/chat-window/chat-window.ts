import { Component, inject, Input, OnChanges, SimpleChanges, ViewChild, OnDestroy, ElementRef, AfterViewChecked, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Observable, of, Subscription } from 'rxjs';
import { Conversation, Message, IntakeData } from '../../models';
import { 
  Firestore, collection, collectionData, query, 
  orderBy, addDoc, serverTimestamp, doc, updateDoc,
  onSnapshot, Timestamp, Unsubscribe, getDocs
} from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { take } from 'rxjs/operators';
import { Storage, ref, deleteObject, uploadBytesResumable, getDownloadURL } from '@angular/fire/storage';
// Certifique-se que o caminho do pipe está correto no seu projeto
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
  storage: Storage = inject(Storage);
  
  messages$: Observable<Message[]> = of([]);
  currentAdminId: string | null = null;
  currentConversation: Conversation | null = null; 

  private authSub: Subscription | null = null;
  private convSub: Unsubscribe | null = null; 

  isEditing = signal(false);
  
  // Controle de visibilidade dos dados do cliente (Intake)
  isIntakeExpanded = signal(true); 

  editableData: IntakeData | null = null;

  isUploading = signal(false);
  uploadPercentage = signal(0);
  isRecording = signal(false);
  
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: any[] = [];

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
          
          // Se estiver editando e os dados mudarem no banco, cancela edição para evitar conflito
          if (this.isEditing() && docSnap.data()['intakeData'] !== this.editableData) {
            // Opcional: manter edição ou cancelar.
          }
        } else {
          this.currentConversation = null;
        }
      });

      this.shouldScrollToBottom = true; 
      this.isEditing.set(false); 
      this.isRecording.set(false);
      this.isUploading.set(false);
      
      // Abre os dados do cliente automaticamente ao trocar de conversa
      this.isIntakeExpanded.set(true); 

    } else if (!this.conversationId) {
      this.currentConversation = null;
      this.messages$ = of([]);
      if (this.convSub) this.convSub();
    }
  }
  
  ngOnDestroy() {
    this.authSub?.unsubscribe();
    if (this.convSub) this.convSub();
    this.stopRecording(); 
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

  // --- FUNÇÃO MODIFICADA: INICIAR ATENDIMENTO COM DADOS ---
  async startAttendance() {
    if (!this.conversationId || !this.currentAdminId) return;

    try {
      const convDocRef = doc(this.firestore, `conversations/${this.conversationId}`);
      const messagesCollection = collection(this.firestore, `conversations/${this.conversationId}/messages`);
      
      // 1. Prepara a mensagem automática
      let autoMessageText = `Oi ${this.currentConversation?.userName || 'Cliente'} seu atendimento vai ser iniciado..`;

      // 2. Se houver dados de intake, formata e adiciona à mensagem
      if (this.currentConversation?.intakeData) {
        const data = this.currentConversation.intakeData;
        
        // Formatação com quebra de linha. 
        // OBS: O pipe 'preformat' no HTML deve converter \n para <br>
        autoMessageText += `\n\nSegue abaixo a confirmação dos dados:\n`;
        autoMessageText += `Nome: ${data.nome}\n`;
        autoMessageText += `Telefone: ${data.telefone || 'N/D'}\n`;
        autoMessageText += `Distribuidora: ${data.distribuidora}\n`;
        autoMessageText += `Regional: ${data.regional}\n`;
        autoMessageText += `Atendimento: ${data.opcaoAtendimento}\n`;
        autoMessageText += `SE/AL: ${data.siglaSEAL}\n`;
        autoMessageText += `Componente: ${data.componente}\n`;
        autoMessageText += `Modelo Controle: ${data.modeloControle}\n`;
        
        let comm = data.modoComunicacao;
        if (comm === 'GPRS' && data.tipoGprs) {
          comm += ` - ${data.tipoGprs}`;
        }
        autoMessageText += `Comunicação: ${comm}\n`;
        
        autoMessageText += `IP: ${data.ip}\n`;
        autoMessageText += `Porta: ${data.porta}`;
      }

      // 3. Cria o objeto da mensagem
      const newMessage: Message = {
        text: autoMessageText,
        senderId: this.currentAdminId,
        timestamp: serverTimestamp() as Timestamp
      };

      // 4. Adiciona a mensagem na coleção
      await addDoc(messagesCollection, newMessage);

      // 5. Atualiza o status para active, define o atendente e atualiza a lastMessage
      await updateDoc(convDocRef, {
        status: 'active',
        attendedBy: this.currentAdminId,
        startedAt: serverTimestamp(),
        unreadByDashboard: false,
        lastMessage: { 
          text: "Atendimento iniciado (Dados enviados)", 
          timestamp: serverTimestamp() 
        }
      });
      
      this.shouldScrollToBottom = true;

    } catch (error) {
      console.error("Erro ao iniciar atendimento:", error);
      alert("Não foi possível iniciar o atendimento.");
    }
  }
  // ----------------------------------------

  async sendMessage(form: NgForm) {
    if (form.invalid || !this.conversationId || !this.currentAdminId) return;
    
    const messageText = form.value.message;
    const newMessage: Message = {
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

  async sendAutoClosingMessage() {
    if (!this.conversationId || !this.currentAdminId) return;

    const messageText = "O atendimento será encerrado, por favor, certifique que todas as midias necessarias para você tenham sido baixadas em seu dispositivo";

    const newMessage: Message = {
      text: messageText,
      senderId: this.currentAdminId,
      timestamp: serverTimestamp() as Timestamp
    };

    try {
      const messagesCollection = collection(this.firestore, `conversations/${this.conversationId}/messages`);
      await addDoc(messagesCollection, newMessage);

      const convDocRef = doc(this.firestore, `conversations/${this.conversationId}`);
      await updateDoc(convDocRef, {
        lastMessage: { text: messageText, timestamp: serverTimestamp() },
        status: 'active',
        unreadByDashboard: false
      });

      this.shouldScrollToBottom = true;
    } catch (error) {
      console.error("Erro ao enviar mensagem automática:", error);
      alert("Erro ao enviar aviso.");
    }
  }

  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (file && this.conversationId) {
      this.uploadToStorage(file, this.conversationId, file.name);
    }
    event.target.value = ''; 
  }

  uploadToStorage(fileOrBlob: File | Blob, conversationId: string, fileName: string) {
    this.isUploading.set(true);
    const filePath = `chat_media/${conversationId}/${Date.now()}_${fileName}`;
    const storageRef = ref(this.storage, filePath);
    const task = uploadBytesResumable(storageRef, fileOrBlob);

    task.on('state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        this.uploadPercentage.set(progress);
      },
      (error) => {
        console.error(error);
        this.isUploading.set(false);
        alert('Erro ao enviar arquivo.');
      },
      async () => {
        const downloadURL = await getDownloadURL(task.snapshot.ref);
        await this.sendMediaMessage(downloadURL, fileOrBlob.type, fileName, conversationId);
        this.isUploading.set(false);
      }
    );
  }

  async sendMediaMessage(url: string, mimeType: string, fileName: string, convoId: string) {
    if (!this.currentAdminId) return;

    let type: 'image' | 'video' | 'audio' = 'image';
    if (mimeType.startsWith('video')) type = 'video';
    if (mimeType.startsWith('audio')) type = 'audio';

    const msg: Message = {
      senderId: this.currentAdminId,
      timestamp: serverTimestamp() as Timestamp,
      mediaUrl: url,
      mediaType: type,
      fileName: fileName
    };

    await addDoc(collection(this.firestore, `conversations/${convoId}/messages`), msg);
    await updateDoc(doc(this.firestore, `conversations/${convoId}`), {
      lastMessage: { text: type === 'audio' ? '🎵 Áudio enviado pelo suporte' : '📎 Mídia enviada pelo suporte', timestamp: serverTimestamp() },
      status: 'active',
      unreadByDashboard: false
    });
    
    this.shouldScrollToBottom = true;
  }

  async toggleRecording() {
    if (this.isRecording()) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        if (this.conversationId) {
          this.uploadToStorage(audioBlob, this.conversationId, 'audio_suporte.webm');
        }
        stream.getTracks().forEach(track => track.stop());
      };

      this.mediaRecorder.start();
      this.isRecording.set(true);

    } catch (err) {
      console.error("Erro microfone:", err);
      alert("Permissão de microfone negada ou indisponível.");
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording()) {
      this.mediaRecorder.stop();
      this.isRecording.set(false);
    }
  }

  async endChat() {
    if (!this.conversationId || !this.currentAdminId) return;
    if (!confirm("Tem certeza? Isso apagará todas as mídias desta conversa permanentemente.")) return;

    try {
      const msgsCollection = collection(this.firestore, `conversations/${this.conversationId}/messages`);
      const snapshot = await getDocs(msgsCollection);

      const deletePromises: Promise<void>[] = [];
      snapshot.forEach(docSnap => {
        const msg = docSnap.data() as Message;
        if (msg.mediaUrl) {
          try {
            const fileRef = ref(this.storage, msg.mediaUrl);
            deletePromises.push(deleteObject(fileRef).catch(e => console.warn("Erro ao deletar:", e)));
          } catch(e) { console.error(e); }
        }
      });

      await Promise.all(deletePromises);

      const endMessageText = "Atendimento encerrado pelo nosso agente.";
      const newMessage: Message = {
        text: endMessageText,
        senderId: this.currentAdminId,
        timestamp: serverTimestamp() as Timestamp
      };
      await addDoc(msgsCollection, newMessage);

      const convDocRef = doc(this.firestore, `conversations/${this.conversationId}`);
      
      await updateDoc(convDocRef, {
        status: 'closed',
        attendedBy: null, 
        closedAt: serverTimestamp(), 
        lastMessage: { text: endMessageText, timestamp: serverTimestamp() },
        unreadByDashboard: false
      });

      this.isEditing.set(false); 

    } catch (error) {
      console.error("Erro ao encerrar:", error);
      alert("Houve um erro. Verifique o console.");
    }
  }

  toggleEdit(): void {
    if (!this.currentConversation?.intakeData) return;
    if (this.isEditing()) {
      this.isEditing.set(false);
      this.editableData = null;
    } else {
      this.editableData = { ...this.currentConversation.intakeData };
      this.isEditing.set(true);
      this.isIntakeExpanded.set(true); 
    }
  }

  cancelEdit(): void {
    this.isEditing.set(false);
    this.editableData = null;
  }

  toggleIntake() {
    this.isIntakeExpanded.update(value => !value);
  }

  async saveIntakeData(): Promise<void> {
    if (!this.editableData || !this.conversationId) return;
    try {
      const convDocRef = doc(this.firestore, 'conversations', this.conversationId);
      
      await updateDoc(convDocRef, {
        intakeData: this.editableData,
        userName: this.editableData.nome 
      });
      
      this.isEditing.set(false);
      this.editableData = null;
    } catch (err) {
      console.error("Erro ao salvar os dados: ", err);
      alert("Não foi possível salvar as alterações.");
    }
  }
}