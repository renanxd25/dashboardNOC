import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html', // Verifique se o nome do arquivo está correto
  styleUrl: './login.scss'     // Verifique se o nome do arquivo está correto
})
export class Login { // Renomeei para LoginComponent (boa prática)
  
  // Injeção de dependências
  private auth = inject(Auth);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef); // CRUCIAL: Injeta o detector de mudanças

  loading = false;
  error: string | null = null;

  async onSubmit(form: NgForm) {
    if (form.invalid) {
      return;
    }

    this.loading = true;
    this.error = null;

    const { email, password } = form.value;

    try {
      await signInWithEmailAndPassword(this.auth, email, password);
      // Se der certo, navega
      this.router.navigate(['/']); 
      
    } catch (err: any) {
      console.error('Erro Firebase:', err.code);

      // Tratamento específico para feedback rápido
      switch(err.code) {
        case 'auth/invalid-credential':
        case 'auth/user-not-found':
        case 'auth/wrong-password':
            this.error = "E-mail ou senha incorretos.";
            break;
        case 'auth/too-many-requests':
            this.error = "Muitas tentativas. Aguarde um momento.";
            break;
        case 'auth/network-request-failed':
            this.error = "Verifique sua conexão com a internet.";
            break;
        default:
            this.error = "Erro ao fazer login. Tente novamente.";
      }

      // CRUCIAL: Força a atualização da tela IMEDIATAMENTE após definir o erro
      this.cdr.detectChanges(); 

    } finally {
      this.loading = false;
      // Garante que o estado de loading seja atualizado na tela
      this.cdr.detectChanges();
    }
  }
}