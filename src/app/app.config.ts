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
  apiKey: "AIzaSyC_QqKzhJy0dTX9hrFeWRaXuKtNR4EEesQ",
  authDomain: "projetonikolas-61102.firebaseapp.com",
  projectId: "projetonikolas-61102",
  storageBucket: "projetonikolas-61102.firebasestorage.app",
  messagingSenderId: "256123764070",
  appId: "1:256123764070:web:f01fc4b8b55e4f5a941ca7",
  measurementId: "G-0MKD4B73B6"
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