import { useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Upload } from 'lucide-react';

interface UploadStepProps {
  onFiles: (files: FileList) => void;
}

export default function UploadStep({ onFiles }: UploadStepProps) {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
  }, [onFiles]);

  const handleClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.xml,.csv,.txt,.xlsx,.xls';
    input.onchange = e => {
      const files = (e.target as HTMLInputElement).files;
      if (files) onFiles(files);
    };
    input.click();
  };

  return (
    <Card>
      <CardContent className="py-12">
        <div
          className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          onClick={handleClick}
        >
          <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">Arraste arquivos ou clique para selecionar</h3>
          <p className="text-sm text-muted-foreground">
            XML (NF-e) • CSV • Excel (.xlsx) • Múltiplos arquivos permitidos
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
