import { exportFile, type ExportFormat, type Exportable, type ExportedFile } from './export.ts';
export function downloadFile(preview: Exportable, format: ExportFormat) { saveFile(exportFile(preview, format)); }
export function saveFile(file: ExportedFile) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
  const link = document.createElement('a'); link.href = url; link.download = file.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
