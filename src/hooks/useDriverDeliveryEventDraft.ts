import { useRef, useState, type ChangeEvent } from 'react';
import { validateUploadFile } from '@/lib/uploadPolicy';
import type { ReceiptScanResult } from '@/lib/driver/receiptScan';
import { getDriverDeliveryEvent } from '@/components/driver/deliveries/driverDeliveryEvents';

export function useDriverDeliveryEventDraft() {
  const [receiverName, setReceiverName] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [receiptScan, setReceiptScan] = useState<ReceiptScanResult | null>(null);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [returnedItems, setReturnedItems] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');
  const [discountKind, setDiscountKind] = useState<'percent' | 'value'>('percent');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [boletoDueDate, setBoletoDueDate] = useState('');
  const [boletoNote, setBoletoNote] = useState('');
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setReceiverName('');
    setReceiverDoc('');
    setNotes('');
    setPhotos([]);
    setReceiptScan(null);
    photoPreviews.forEach((url) => URL.revokeObjectURL(url));
    setPhotoPreviews([]);
    setSignatureDataUrl(null);
    setReturnedItems({});
    setReturnReason('');
    setDiscountKind('percent');
    setDiscountAmount('');
    setDiscountReason('');
    setBoletoDueDate('');
    setBoletoNote('');
  };

  const selectPhotos = (
    event: ChangeEvent<HTMLInputElement>,
    eventKey: string | undefined,
    onInvalid: (message: string) => void,
  ) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    try {
      files.forEach((file) => validateUploadFile(file, 'image'));
    } catch (error) {
      onInvalid(error instanceof Error ? error.message : 'Selecione imagens válidas.');
      event.target.value = '';
      return;
    }
    const maxPhotos = getDriverDeliveryEvent(eventKey ?? '')?.requiresReceipt ? 4 : 5;
    const next = [...photos, ...files].slice(0, maxPhotos);
    setPhotos(next);
    photoPreviews.forEach((url) => URL.revokeObjectURL(url));
    setPhotoPreviews(next.map((file) => URL.createObjectURL(file)));
    event.target.value = '';
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoPreviews[index]);
    setPhotos((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
    setPhotoPreviews((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  };

  return {
    receiverName, setReceiverName,
    receiverDoc, setReceiverDoc,
    notes, setNotes,
    photos,
    receiptScan, setReceiptScan,
    photoPreviews,
    signatureDataUrl, setSignatureDataUrl,
    returnedItems, setReturnedItems,
    returnReason, setReturnReason,
    discountKind, setDiscountKind,
    discountAmount, setDiscountAmount,
    discountReason, setDiscountReason,
    boletoDueDate, setBoletoDueDate,
    boletoNote, setBoletoNote,
    cameraInputRef,
    galleryInputRef,
    reset,
    selectPhotos,
    removePhoto,
  };
}

export type DriverDeliveryEventDraft = ReturnType<typeof useDriverDeliveryEventDraft>;
