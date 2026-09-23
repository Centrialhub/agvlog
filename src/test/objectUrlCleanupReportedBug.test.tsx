import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDriverDeliveryEventDraft } from '@/hooks/useDriverDeliveryEventDraft';

describe('object URL cleanup', () => {
  afterEach(() => vi.restoreAllMocks());

  it('releases active delivery photo previews when the draft unmounts', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:delivery-photo');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useDriverDeliveryEventDraft());
    const file = new File(['photo'], 'receipt.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    act(() => result.current.selectPhotos({ target: input } as never, 'delivered', vi.fn()));
    expect(result.current.photoPreviews).toEqual(['blob:delivery-photo']);

    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:delivery-photo');
  });
});
