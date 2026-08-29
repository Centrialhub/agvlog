import type { jsPDF } from 'jspdf';

type AutoTableAwareDocument = jsPDF & {
  lastAutoTable?: { finalY?: number };
};

/** Returns the last jspdf-autotable Y coordinate without leaking plugin casts. */
export function getAutoTableFinalY(doc: jsPDF, fallback = 0): number {
  const finalY = (doc as AutoTableAwareDocument).lastAutoTable?.finalY;
  return typeof finalY === 'number' && Number.isFinite(finalY) ? finalY : fallback;
}
