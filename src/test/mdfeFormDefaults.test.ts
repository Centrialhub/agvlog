import { describe, expect, it } from 'vitest';
import { deriveMdfeDialogDefaults, stateCodeFromCityIbge } from '@/lib/fiscal/mdfeFormDefaults';

describe('MDF-e form defaults', () => {
  it('derives route and totals only from configured emitters and selected CT-es', () => {
    const result = deriveMdfeDialogDefaults(
      [
        {
          cargo_value: 120.5,
          cargo_weight: 10,
          recipient_city: 'Curitiba',
          recipient_city_ibge: '4106902',
          recipient_state: 'PR',
          vehicle_id: 'vehicle-1',
          driver_id: 'driver-1',
          driver_name: 'Motorista Selecionado',
          driver_cpf: '123.456.789-00',
        },
        {
          cargo_value: 79.5,
          cargo_weight: 5.25,
          recipient_city: 'Curitiba',
          recipient_city_ibge: '4106902',
          vehicle_id: 'vehicle-1',
          driver_id: 'driver-1',
          driver_name: 'Motorista Selecionado',
          driver_cpf: '123.456.789-00',
        },
      ],
      [{ id: 'emitter-1', active: true, is_default: true, city_code: '3550308', endereco: { municipio: 'São Paulo' } }],
      [{ id: 'vehicle-1', renavam: '12345678901' }],
    );

    expect(result).toMatchObject({
      emitterId: 'emitter-1',
      vehicleId: 'vehicle-1',
      vehicleRenavam: '12345678901',
      driverName: 'Motorista Selecionado',
      driverCpf: '12345678900',
      originCity: 'São Paulo',
      originIbge: '3550308',
      originUf: '35',
      destinationCity: 'Curitiba',
      destinationIbge: '4106902',
      destinationUf: '41',
      totalCargoValue: '200.00',
      totalCargoWeight: '15.250',
    });
  });

  it('does not guess a vehicle or driver when selected CT-es disagree', () => {
    const result = deriveMdfeDialogDefaults(
      [
        { vehicle_id: 'vehicle-1', driver_id: 'driver-1', driver_name: 'A', driver_cpf: '11111111111' },
        { vehicle_id: 'vehicle-2', driver_id: 'driver-2', driver_name: 'B', driver_cpf: '22222222222' },
      ],
      [],
      [],
    );

    expect(result.vehicleId).toBe('');
    expect(result.driverName).toBe('');
    expect(result.driverCpf).toBe('');
  });

  it('accepts only a seven-digit municipality code when deriving the state code', () => {
    expect(stateCodeFromCityIbge('31.433-02')).toBe('31');
    expect(stateCodeFromCityIbge('31')).toBe('');
  });
});
