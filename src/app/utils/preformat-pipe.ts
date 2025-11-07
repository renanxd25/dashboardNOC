import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'preformat',
  standalone: true  // Adicione esta linha
})
export class PreformatPipe implements PipeTransform {

  // A lógica correta vai aqui
  transform(value: string | undefined | null): string {
    if (!value) {
      return ''; // Retorna uma string vazia, NUNCA null
    }

    // Esta é a lógica que converte quebras de linha em <br>
    return value
      .replace(/\n/g, '<br>')
      .replace(/  /g, '&nbsp; ');
  }

}