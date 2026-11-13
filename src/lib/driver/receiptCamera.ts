import type { ReceiptCorners } from './receiptScan';

/** The video and its overlay must share one sensor-coordinate rectangle. */
export function receiptCameraLayout(width: number, height: number) {
  const ratio = width > 0 && height > 0 ? width / height : 4 / 3;
  return { aspectRatio: String(ratio), width: `min(100%, ${60 * ratio}vh)` };
}

/** Keep a small border outside detected paper, rather than cutting into it. */
export function paddedReceiptCorners(corners: ReceiptCorners): ReceiptCorners {
  const move = (point: {x:number;y:number}, dx:number, dy:number) => ({
    x: point.x + dx * Math.min(.012, Math.max(0, (dx < 0 ? point.x : 1-point.x) - .016)),
    y: point.y + dy * Math.min(.012, Math.max(0, (dy < 0 ? point.y : 1-point.y) - .016)),
  });
  return {topLeft:move(corners.topLeft,-1,-1),topRight:move(corners.topRight,1,-1),
    bottomRight:move(corners.bottomRight,1,1),bottomLeft:move(corners.bottomLeft,-1,1)};
}

export const RECEIPT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio:false, video:{facingMode:{ideal:'environment'},width:{ideal:3840},height:{ideal:2880}},
};
