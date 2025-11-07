import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx'; // Importa a biblioteca

// Define o tipo de dados que esperamos para o Excel
type ExcelData = {
  Nome: string;
  CPF: string;
  Setor: string;
  Cidade: string;
  DataAtendimento: string;
  UserId: string;
}

@Injectable({
  providedIn: 'root'
})
export class ExportService {

  constructor() { }

  public exportToExcel(data: ExcelData[], fileName: string): void {
    // 1. Cria uma "Worksheet" (planilha) a partir dos nossos dados JSON
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(data);

    // 2. Cria um "Workbook" (o arquivo Excel)
    const wb: XLSX.WorkBook = XLSX.utils.book_new();

    // 3. Adiciona a planilha ao arquivo com o nome "Clientes"
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');

    // 4. Salva o arquivo e força o download no navegador
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  }
}