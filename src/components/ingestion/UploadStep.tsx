import { useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Camera, Loader2, ScanLine, Upload } from 'lucide-react';

interface UploadStepProps {
  onFiles: (files: FileList) => void;
  onOrtFiles: (files: FileList) => void;
  ortProcessing?: boolean;
}

export default function UploadStep({ onFiles, onOrtFiles, ortProcessing }: UploadStepProps) {
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

  const handleOrtFile = (capture: boolean) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !capture;
    input.accept = 'image/*,.pdf';
    if (capture) input.setAttribute('capture', 'environment');
    input.onchange = e => {
      const files = (e.target as HTMLInputElement).files;
      if (files) onOrtFiles(files);
    };
    input.click();
  };

  return (
    <Card>
      <CardContent className="py-12">
        <Tabs defaultValue="files" className="space-y-4">
          <TabsList className="grid w-full max-w-md grid-cols-2 mx-auto">
            <TabsTrigger value="files">XML / planilhas</TabsTrigger>
            <TabsTrigger value="ort">Scan NF-e / ORT</TabsTrigger>
          </TabsList>

          <TabsContent value="files">
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
          </TabsContent>

          <TabsContent value="ort">
            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-10 text-center">
              {ortProcessing ? (
                <div className="py-8 text-muted-foreground">
                  <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
                  <h3 className="text-lg font-medium mb-2 text-foreground">Lendo NF-e / ORT...</h3>
                  <p className="text-sm">Extraindo os dados sem alterar a identidade fiscal do documento.</p>
                </div>
              ) : (
                <>
                  <ScanLine className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">Capturar NF-e ou ORT</h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    Use uma foto ou PDF legível. Campos não reconhecidos ficam pendentes para revisão; o sistema não completa dados fiscais por suposição.
                  </p>
                  <div className="flex flex-wrap justify-center gap-3">
                    <Button type="button" onClick={() => handleOrtFile(true)} className="gap-2">
                      <Camera className="h-4 w-4" /> Tirar foto
                    </Button>
                    <Button type="button" variant="outline" onClick={() => handleOrtFile(false)} className="gap-2">
                      <Upload className="h-4 w-4" /> Enviar scan
                    </Button>
                  </div>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
