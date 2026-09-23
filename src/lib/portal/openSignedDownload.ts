export async function openSignedDownload(
  resolveUrl: () => Promise<string>,
  openWindow: typeof window.open = window.open.bind(window),
): Promise<void> {
  const popup = openWindow('about:blank', '_blank');
  if (!popup) {
    throw new Error('O navegador bloqueou a nova aba. Permita pop-ups para baixar o canhoto.');
  }
  popup.opener = null;

  try {
    const url = await resolveUrl();
    popup.location.replace(url);
  } catch (error) {
    popup.close();
    throw error;
  }
}
