import { Component, inject, Input, OnChanges, SimpleChanges, ViewChild, OnDestroy, ElementRef, AfterViewChecked, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Observable, of, Subscription } from 'rxjs';
import { Conversation, Message, IntakeData } from '../../models';
import { 
  Firestore, collection, collectionData, query, 
  orderBy, addDoc, serverTimestamp, doc, updateDoc,
  onSnapshot, Timestamp, Unsubscribe, getDocs,
  where, 
  getCountFromServer,
  arrayUnion 
} from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { take } from 'rxjs/operators';
import { Storage, ref, deleteObject, uploadBytesResumable, getDownloadURL } from '@angular/fire/storage';
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
  currentAdminEmail: string | null = null; // NOVO: Guarda e-mail do admin logado
  currentConversation: Conversation | any = null; 

  private authSub: Subscription | null = null;
  private convSub: Unsubscribe | null = null; 

  isEditing = signal(false);
  isIntakeExpanded = signal(true); 
  editableData: IntakeData | null = null;

  isUploading = signal(false);
  uploadPercentage = signal(0);
  isRecording = signal(false);
  
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: any[] = [];

  showClosingModal = signal(false);
  isClosing = signal(false);
  
  // NOVO: Controle do Modal de Compartilhamento
  showShareModal = signal(false);
  emailToShare: string = '';

  closingData = {
    statusComunicacao: 'SIM',
    validacaoAssertiva: 'SIM',
    obsProblema: '',
    obsSolucao: ''
  };

  modelsByClass: { [key: string]: string[] } = {
    'CHAVE TELECOMANDA': ['BONOMI', 'IMS'],
    'RELIGADOR': ['ARTECHE', 'COOPER', 'G&W', 'NOJA', 'SCHNEIDER', 'SIEMENS', 'TAVRIDA'],
    'SENSOR': ['MT', 'KOALA']
  };

  relaysByRecloserModel: { [key: string]: string[] } = {
    'ARTECHE': ['ADATECH', 'SEL 351R', 'SEL 7511', 'SEL 751A', 'SEL 751A STD'],
    'COOPER': ['FORM 6', 'LBS', 'SEL 651R', 'SEL 7511'],
    'G&W': ['SEL 7511'],
    'NOJA': ['RC 10'],
    'SCHNEIDER': ['ADVC', 'ADVC 2', 'ADVC 3', 'PTCC'],
    'SIEMENS': ['7SC80'],
    'TAVRIDA': ['RC 5', 'SEL 751A (CREATE)', 'SEL 751A (ECIL)']
  };

  regionalsByState: { [key: string]: string[] } = {
    'AL': ['CENTRO', 'LESTE', 'OESTE'],
    'AP': ['AP'],
    'GO': ['ANÁPOLIS', 'FORMOSA', 'GOIÂNIA', 'IPORÁ', 'LUZILÂNDIA', 'METROPOLITANA', 'MONTE BELOS', 'MORRINHOS', 'RIO VERDE', 'URUAÇU'],
    'MA': ['CENTRO', 'LESTE', 'NOROESTE', 'NORTE', 'SUL'],
    'PA': ['CENTRO', 'LESTE', 'NORDESTE', 'NOROESTE', 'NORTE', 'OESTE', 'SUL'],
    'PI': ['CENTRO-SUL', 'METROPOLITANA', 'NORTE', 'SUL'],
    'RS': ['CAMPANHA', 'CARBONIFERA', 'CENTRO', 'LITORAL NORTE', 'LITORAL SUL', 'METROPOLITANA', 'NORDESTE', 'NORTE', 'PORTO ALEGRE', 'SUL']
  };

  constructor() {
    this.authSub = authState(this.auth).pipe(take(1)).subscribe(user => {
      this.currentAdminId = user ? user.uid : null;
      this.currentAdminEmail = user ? user.email : null; // NOVO: Captura o email
    });
  }

  // --- ALTERADO GETTER: VERIFICA SE O USUÁRIO É O DONO OU SE FOI COMPARTILHADO ---
  get isOwner(): boolean {
    if (!this.currentConversation || !this.currentAdminId) return false;
    // Se o chat está ativo
    if (this.currentConversation.status === 'active') {
        // Verifica se é o dono principal
        const isMainOwner = this.currentConversation.attendedBy === this.currentAdminId;
        
        // Verifica se está na lista de compartilhados
        const isShared = this.currentConversation.sharedWith && 
                         this.currentAdminEmail && 
                         this.currentConversation.sharedWith.includes(this.currentAdminEmail);

        return isMainOwner || !!isShared;
    }
    return false;
  }

  // NOVO: Helper para saber se é um chat compartilhado comigo
  get isSharedWithMe(): boolean {
    if (!this.currentConversation || !this.currentAdminEmail) return false;
    return this.currentConversation.sharedWith && 
           this.currentConversation.sharedWith.includes(this.currentAdminEmail);
  }

  get distribuidorasKeys() {
    return Object.keys(this.regionalsByState).sort();
  }

  get classesOptions() {
    return Object.keys(this.modelsByClass).sort();
  }

  get currentModelsOptions() {
    if (!this.editableData?.classeComponente) return [];
    return this.modelsByClass[this.editableData.classeComponente] || [];
  }

  get currentRelaysOptions() {
    if (this.editableData?.classeComponente !== 'RELIGADOR' || !this.editableData?.modelo) return [];
    return this.relaysByRecloserModel[this.editableData.modelo] || [];
  }

  formatPhone(event: any) {
    let v = event.target.value.replace(/\D/g, "");
    v = v.replace(/^(\d\d)(\d)/g, "($1) $2");
    v = v.replace(/(\d{5})(\d)/, "$1-$2");
    event.target.value = v.substring(0, 15);
    if(this.editableData) this.editableData.telefone = event.target.value;
  }

  formatAlphaNumeric(event: any) {
    let v = event.target.value.toUpperCase();
    v = v.replace(/[^A-Z0-9- ]/g, ""); 
    event.target.value = v;
    if(this.editableData) this.editableData.componente = v;
  }

  formatMax8AlphaNumeric(event: any) {
    let v = event.target.value.toUpperCase();
    v = v.replace(/[^A-Z0-9- ]/g, "");
    if (v.length > 8) v = v.substring(0, 8);
    event.target.value = v;
    const name = event.target.name;
    if (this.editableData) {
        if (name === 'edit-subestacao') this.editableData.subestacao = v;
        if (name === 'edit-alimentador') this.editableData.alimentador = v;
    }
  }

  formatIP(event: any) {
    let v = event.target.value.replace(/[^0-9.]/g, "");
    v = v.replace(/\.{2,}/g, ".");
    event.target.value = v;
    if(this.editableData) this.editableData.ip = v;
  }

  formatOnlyNumbers(event: any) {
    let v = event.target.value.replace(/\D/g, "");
    event.target.value = v;
    if(this.editableData) this.editableData.porta = v;
  }

  onClasseChange() {
    if(this.editableData) {
      this.editableData.modelo = '';
      this.editableData.rele = '';
    }
  }

  onModeloChange() {
    if(this.editableData) {
      this.editableData.rele = '';
    }
  }

  onOpcaoChange() {
    if(!this.editableData) return;
    if (this.editableData.opcaoAtendimento === 'CADASTRO DE PORTA HUGHES') {
      this.editableData.modoComunicacao = 'SATELITAL'; 
    }
  }

  onGprsChange(tipo: string) {
    if(!this.editableData) return;
    if (tipo === 'CAS') this.editableData.ip = '10.1.1.58';
    else if (tipo === 'V2COM') this.editableData.ip = '10.74.150.20';
    else if (tipo === 'HORUS') this.editableData.ip = '10.82.149.2';
    else this.editableData.ip = '';
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['conversationId'] && this.conversationId) {
      if (this.convSub) this.convSub();
      this.loadMessages(this.conversationId);
      const convDocRef = doc(this.firestore, `conversations/${this.conversationId}`);
      
      this.convSub = onSnapshot(convDocRef, (docSnap) => {
        if (docSnap.exists()) {
          this.currentConversation = { id: docSnap.id, ...docSnap.data() } as Conversation;
        } else {
          this.currentConversation = null;
        }
      });

      this.shouldScrollToBottom = true; 
      this.isEditing.set(false); 
      this.isRecording.set(false);
      this.isUploading.set(false);
      this.isIntakeExpanded.set(true); 
      this.showClosingModal.set(false);
      this.showShareModal.set(false); // NOVO

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

  async startAttendance() {
    if (!this.conversationId || !this.currentAdminId) return;

    // Proteção extra: Se já tem dono e não sou eu
    if (this.currentConversation?.attendedBy && this.currentConversation.attendedBy !== this.currentAdminId) {
        alert("Este atendimento já está sendo realizado por outro atendente.");
        return;
    }

    try {
      const activeChatsQuery = query(
        collection(this.firestore, 'conversations'),
        where('status', '==', 'active'),
        where('attendedBy', '==', this.currentAdminId)
      );

      const snapshot = await getCountFromServer(activeChatsQuery);
      const activeCount = snapshot.data().count;

      if (activeCount >= 3) {
        alert(`⚠️ LIMITE ATINGIDO\n\nVocê já possui ${activeCount} atendimentos em andamento.\nFinalize um atendimento antes de iniciar um novo.`);
        return; 
      }
    } catch (err) {
      console.error("Erro ao verificar limite de atendimentos:", err);
      alert("Erro ao validar limite de atendimentos. Verifique sua conexão.");
      return;
    }

    try {
      const convDocRef = doc(this.firestore, `conversations/${this.conversationId}`);
      const messagesCollection = collection(this.firestore, `conversations/${this.conversationId}/messages`);
      
      const currentUser = this.auth.currentUser;
      const adminEmail = currentUser?.email || 'email-nao-detectado';

      let autoMessageText = `Oi ${this.currentConversation?.userName || 'Cliente'} seu atendimento vai ser iniciado..`;

      if (this.currentConversation?.intakeData) {
        const data = this.currentConversation.intakeData;
        autoMessageText += `\n\nSegue abaixo a confirmação dos dados:\n`;
        autoMessageText += `Nome: ${data.nome}\n`;
        autoMessageText += `Telefone: ${data.telefone || 'N/D'}\n`;
        autoMessageText += `Distribuidora: ${data.distribuidora}\n`;
        autoMessageText += `Regional: ${data.regional}\n`;
        autoMessageText += `Classe: ${data.classeComponente}\n`;
        autoMessageText += `Modelo: ${data?.modelo || data.modeloControle}\n`;
        if (data.rele !== 'null' && data.rele !== null) {
            autoMessageText += `Relé: ${data.rele } \n`;
        }
        autoMessageText += `SE/AL: ${data?.subestacao || ''} - ${data?.alimentador || ''} \n`; 
        autoMessageText += `Componente: ${data.componente}\n`;
        let comm = data.modoComunicacao;
        if (comm === 'GPRS' && data.tipoGprs) {
          comm += ` - ${data.tipoGprs}`;
        }
        autoMessageText += `Comunicação: ${comm}\n`;
        autoMessageText += `IP: ${data.ip}\n`;
        autoMessageText += `Porta: ${data.porta}\n`;
        autoMessageText += `Atendimento: ${data.opcaoAtendimento}\n`;

      }

      const newMessage: Message = {
        text: autoMessageText,
        senderId: this.currentAdminId,
        timestamp: serverTimestamp() as Timestamp
      };

      await addDoc(messagesCollection, newMessage);

      await updateDoc(convDocRef, {
        status: 'active',
        attendedBy: this.currentAdminId,
        attendedByEmail: adminEmail, 
        startedAt: serverTimestamp(),
        unreadByDashboard: false,
        warningSent: false, 
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

    const messageText = "O atendimento será encerrado, por favor, certifique que todas as mídias necessárias para você tenham sido baixadas em seu dispositivo.";

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
        unreadByDashboard: false,
        warningSent: true 
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

  openClosingModal() {
    this.closingData = {
      statusComunicacao: 'SIM',
      validacaoAssertiva: 'SIM',
      obsProblema: '',
      obsSolucao: ''
    };
    this.showClosingModal.set(true);
  }

  closeClosingModal() {
    this.showClosingModal.set(false);
  }

  // --- NOVAS FUNÇÕES: COMPARTILHAR ATENDIMENTO ---
  openShareModal() {
    this.emailToShare = '';
    this.showShareModal.set(true);
  }

  closeShareModal() {
    this.showShareModal.set(false);
    this.emailToShare = '';
  }

  async confirmShare() {
    if (!this.conversationId || !this.emailToShare) return;

    try {
      const convDocRef = doc(this.firestore, `conversations/${this.conversationId}`);
      
      // Adiciona o email ao array sharedWith usando arrayUnion (evita duplicatas)
      await updateDoc(convDocRef, {
        sharedWith: arrayUnion(this.emailToShare)
      });

      // Feedback visual (Opcional: Mandar uma mensagem no chat avisando)
      const messagesCollection = collection(this.firestore, `conversations/${this.conversationId}/messages`);
      const msg: Message = {
        text: `🔒 Atendimento compartilhado com: ${this.emailToShare}`,
        senderId: this.currentAdminId || 'system',
        timestamp: serverTimestamp() as Timestamp
      };
      await addDoc(messagesCollection, msg);

      alert(`Atendimento compartilhado com sucesso com ${this.emailToShare}`);
      this.closeShareModal();

    } catch (error) {
      console.error("Erro ao compartilhar:", error);
      alert("Erro ao compartilhar atendimento. Verifique se o e-mail é válido.");
    }
  }
  // ----------------------------------------------

  async confirmEndChat() {
    if (!this.conversationId || !this.currentAdminId) return;
    
    this.isClosing.set(true);

    try {
      const msgsCollection = collection(this.firestore, `conversations/${this.conversationId}/messages`);
      const snapshot = await getDocs(msgsCollection);

      // NOTA: Recomendo remover essa parte de deleção se for manter histórico
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
        unreadByDashboard: false,
        
        closingFeedback: {
          statusComunicacao: this.closingData.statusComunicacao,
          validacaoAssertiva: this.closingData.validacaoAssertiva,
          obsProblema: this.closingData.obsProblema || 'Não informado',
          obsSolucao: this.closingData.obsSolucao || 'Não informado'
        }
      });

      this.isEditing.set(false); 
      this.showClosingModal.set(false);

    } catch (error) {
      console.error("Erro ao encerrar:", error);
      alert("Houve um erro ao encerrar o atendimento.");
    } finally {
      this.isClosing.set(false);
    }
  }

  toggleEdit(): void {
    if (!this.currentConversation?.intakeData) return;
    // ALTERAÇÃO: Apenas permitir edição se for dono
    if (!this.isOwner) return;

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