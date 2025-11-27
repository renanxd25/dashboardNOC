import 'zone.js';
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getStorage, provideStorage } from '@angular/fire/storage';

const firebaseConfig = {
  // SUAS OUTRAS CREDENCIAIS...
  apiKey: "AIzaSyB4kNdj4echO_0PuXsP0CkjXP9pS0tmMh0", 
  authDomain: "projetonikolas.firebaseapp.com",
  projectId: "projetonikolas",
  
  // --- A CORREÇÃO É AQUI ---
  storageBucket: "projetonikolas.firebasestorage.app", 
  // -------------------------

  messagingSenderId: "1054631751765",
  appId: "1:1054631751765:web:f56671c042b3cf90a3a4dc",
  measurementId: "G-Y3K9ZZ3RTB"
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage())
  ]
};