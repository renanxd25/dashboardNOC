import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConversationList } from '../conversation-list/conversation-list';
import { ChatWindow } from '../chat-window/chat-window';
import { Auth, signOut } from '@angular/fire/auth';
import { Router } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ConversationList, ChatWindow],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class Dashboard {
  auth: Auth = inject(Auth);
  router: Router = inject(Router);

  selectedConversationId: string | null = null;

  onConversationSelected(conversationId: string) {
    this.selectedConversationId = conversationId;
  }

  async logout() {
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }
}