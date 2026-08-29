import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAlertStore } from "@/hooks/useAlertStore";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { XCircle, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

export function GlobalAlert() {
  const {
    isOpen,
    title,
    description,
    type,
    hideAlert,
    onConfirm,
    onSecondaryConfirm,
    onCancel,
    confirmLabel,
    secondaryLabel,
    cancelLabel,
    input,
    inputValue,
    inputError,
    setInputValue,
    setInputError,
  } = useAlertStore();

  const icons = {
    error: <XCircle className="h-6 w-6 text-destructive" />,
    warning: <AlertTriangle className="h-6 w-6 text-warning" />,
    info: <Info className="h-6 w-6 text-blue-500" />,
    success: <CheckCircle2 className="h-6 w-6 text-emerald-500" />,
  };

  const handleConfirm = () => {
    const normalizedValue = inputValue.trim();
    if (input?.required && !normalizedValue) {
      setInputError(`${input.label} é obrigatória.`);
      return;
    }
    if (input?.minLength && normalizedValue.length < input.minLength) {
      setInputError(`${input.label} deve ter pelo menos ${input.minLength} caracteres.`);
      return;
    }
    if (onConfirm) onConfirm(input ? normalizedValue : undefined);
    hideAlert();
  };

  const handleSecondaryConfirm = () => {
    if (onSecondaryConfirm) onSecondaryConfirm();
    hideAlert();
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    hideAlert();
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <AlertDialogContent className="max-w-[500px]">
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
          {input && (
            <div className="space-y-2 pt-2 text-left">
              <Label htmlFor="global-alert-input">{input.label}</Label>
              <Textarea
                id="global-alert-input"
                autoFocus
                value={inputValue}
                placeholder={input.placeholder}
                aria-invalid={Boolean(inputError)}
                aria-describedby={inputError ? "global-alert-input-error" : undefined}
                onChange={(event) => setInputValue(event.target.value)}
              />
              {inputError && (
                <p id="global-alert-input-error" role="alert" className="text-sm text-destructive">
                  {inputError}
                </p>
              )}
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:flex-col sm:gap-2 sm:items-stretch">
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            {cancelLabel && (
              <AlertDialogCancel onClick={handleCancel} className="mt-0">
                {cancelLabel}
              </AlertDialogCancel>
            )}
            
            {secondaryLabel && (
              <AlertDialogAction
                onClick={handleSecondaryConfirm}
                className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
              >
                {secondaryLabel}
              </AlertDialogAction>
            )}

            <AlertDialogAction onClick={handleConfirm}>
              {confirmLabel || "OK"}
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
