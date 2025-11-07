import { Component, inject } from '@angular/core';
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
  auth: Auth = inject(Auth);
  router: Router = inject(Router);

  // --- CORREÇÃO AQUI ---
  // Adiciona as propriedades que faltavam
  loading = false;
  error: string | null = null;
  // --- FIM DA CORREÇÃO ---

  async onSubmit(form: NgForm) {
    if (form.invalid) {
      return;
    }

    // --- CORREÇÃO AQUI ---
    // Atualiza as propriedades durante o login
    this.loading = true;
    this.error = null;
    // --- FIM DA CORREÇÃO ---

    const { email, password } = form.value;
    try {
      await signInWithEmailAndPassword(this.auth, email, password);
      this.router.navigate(['/']); // Navega para o dashboard
    } catch (err: any) {
      this.error = "Falha no login. Verifique seu e-mail ou senha.";
      console.error(err);
    } finally {
      // --- CORREÇÃO AQUI ---
      this.loading = false; // Para o loading
      // --- FIM DA CORREÇÃO ---
    }
  }
}