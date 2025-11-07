import { Routes, CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import { map, take } from 'rxjs/operators';
import { Login } from './components/login/login';
import { Dashboard } from './components/dashboard/dashboard';

// Guarda de Rota simples (apenas cliente)
const authGuard: CanActivateFn = () => {
  const auth: Auth = inject(Auth);
  const router: Router = inject(Router);

  return authState(auth).pipe(
    take(1),
    map(user => {
      if (user) {
        return true; // Usuário logado, pode acessar
      }
      // Usuário não logado, redireciona para /login
      return router.parseUrl('/login');
    })
  );
};

export const routes: Routes = [
  { path: 'login', component: Login },
  {
    path: 'dashboard',
    component: Dashboard,
    canActivate: [authGuard] // Protegendo o Dashboard
  },
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: '/dashboard' } 
];