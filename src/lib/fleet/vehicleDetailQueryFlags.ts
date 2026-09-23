export function vehicleDetailQueryFlags(activeTab: string, poiDialogOpen: boolean, hasFuel: boolean) {
  return {
    history: activeTab === 'timeline' || activeTab === 'trips' || activeTab === 'speed',
    trips: activeTab === 'trips',
    stops: activeTab === 'timeline' || activeTab === 'stops',
    overspeed: activeTab === 'speed',
    fuel: activeTab === 'fuel' && hasFuel,
    pois: activeTab === 'stops' && poiDialogOpen,
  };
}
