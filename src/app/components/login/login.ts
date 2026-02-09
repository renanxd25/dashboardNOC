import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class Login {
  
  private auth = inject(Auth);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  loading = false;
  error: string | null = null;

  // NOVO: Estado para controlar a visibilidade da senha
  showPassword = false;

  // NOVO: Método para alternar a visibilidade
  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  async onSubmit(form: NgForm) {
    if (form.invalid) {
      return;
    }

    this.loading = true;
    this.error = null;

    const { email, password } = form.value;

    try {
      await signInWithEmailAndPassword(this.auth, email, password);
      this.router.navigate(['/']); 
      
    } catch (err: any) {
      console.error('Erro Firebase:', err.code);

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

      this.cdr.detectChanges(); 

    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }
}