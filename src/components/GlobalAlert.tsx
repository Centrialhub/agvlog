import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAlertStore } from "@/hooks/useAlertStore";
import { XCircle, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

export function GlobalAlert() {
  const { isOpen, title, description, type, hideAlert } = useAlertStore();

  const icons = {
    error: <XCircle className="h-6 w-6 text-destructive" />,
    warning: <AlertTriangle className="h-6 w-6 text-warning" />,
    info: <Info className="h-6 w-6 text-blue-500" />,
    success: <CheckCircle2 className="h-6 w-6 text-emerald-500" />,
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && hideAlert()}>
      <AlertDialogContent className="max-w-[400px]">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            {icons[type]}
            <AlertDialogTitle className="text-lg leading-tight">{title}</AlertDialogTitle>
          </div>
          {description && (
            <AlertDialogDescription className="text-sm text-foreground/80 whitespace-pre-wrap">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={hideAlert} className="w-full sm:w-auto">
            OK
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
