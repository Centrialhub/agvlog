export type DriverLocation = {
  latitude: number;
  longitude: number;
  accuracyM: number;
};

type GeolocationReader = Pick<Geolocation, 'getCurrentPosition'>;

const locationErrorMessage = (code: number) => {
  if (code === 1) return 'Permita o acesso à localização para registrar a chegada.';
  if (code === 2) return 'Não foi possível obter sua localização. Verifique o GPS e tente novamente.';
  if (code === 3) return 'O GPS demorou para responder. Vá para uma área aberta e tente novamente.';
  return 'Não foi possível validar sua localização.';
};

export const getCurrentDriverLocation = (
  geolocation: GeolocationReader | undefined = globalThis.navigator?.geolocation,
) => new Promise<DriverLocation>((resolve, reject) => {
  if (!geolocation) {
    reject(new Error('Este dispositivo não oferece localização para validar a chegada.'));
    return;
  }

  geolocation.getCurrentPosition(
    ({ coords }) => {
      const location = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyM: coords.accuracy,
      };

      if (!Object.values(location).every(Number.isFinite)) {
        reject(new Error('O GPS retornou uma localização inválida. Tente novamente.'));
        return;
      }

      resolve(location);
    },
    (error) => reject(new Error(locationErrorMessage(error.code))),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
  );
});
