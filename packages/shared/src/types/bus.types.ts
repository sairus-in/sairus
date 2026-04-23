export interface Bus {
  id: string;
  registrationNumber: string; // e.g., TN-22-BY-1234
  name: string; // e.g., "Bus 12"
  capacity: number;
  currentDriverId: string | null;
  currentRouteId: string | null;
  isActive: boolean;
  deviceId?: string; // For Traccar integration
  createdAt: string;
  updatedAt: string;
}